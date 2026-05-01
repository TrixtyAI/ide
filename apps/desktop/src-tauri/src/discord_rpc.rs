use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;
use uuid::Uuid;
use log::{info, warn, error};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

const CLIENT_ID: &str = "1499852888850301038";

#[derive(Debug, Clone, Copy)]
#[repr(u32)]
pub enum OpCode {
    Handshake = 0,
    Frame = 1,
}

pub enum RpcMessage {
    UpdateActivity(Option<Activity>),
    AcceptJoin(String),
    RejectJoin(String),
}

pub struct DiscordRpc {
    client_id: String,
    tx: Option<mpsc::UnboundedSender<RpcMessage>>,
}

enum IpcStream {
    #[cfg(windows)]
    Windows(tokio::net::windows::named_pipe::NamedPipeClient),
    #[cfg(unix)]
    Unix(UnixStream),
}

impl IpcStream {
    async fn send(&mut self, opcode: OpCode, payload: &str) -> Result<(), String> {
        let mut header = [0u8; 8];
        header[0..4].copy_from_slice(&(opcode as u32).to_le_bytes());
        header[4..8].copy_from_slice(&(payload.len() as u32).to_le_bytes());

        match self {
            #[cfg(windows)]
            IpcStream::Windows(s) => {
                s.write_all(&header).await.map_err(|e| e.to_string())?;
                s.write_all(payload.as_bytes()).await.map_err(|e| e.to_string())?;
            }
            #[cfg(unix)]
            IpcStream::Unix(s) => {
                s.write_all(&header).await.map_err(|e| e.to_string())?;
                s.write_all(payload.as_bytes()).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    async fn recv(&mut self) -> Result<(u32, String), String> {
        let mut header = [0u8; 8];
        match self {
            #[cfg(windows)]
            IpcStream::Windows(s) => {
                s.read_exact(&mut header).await.map_err(|e| e.to_string())?;
            }
            #[cfg(unix)]
            IpcStream::Unix(s) => {
                s.read_exact(&mut header).await.map_err(|e| e.to_string())?;
            }
        }

        let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);

        let mut payload = vec![0u8; length as usize];
        match self {
            #[cfg(windows)]
            IpcStream::Windows(s) => {
                s.read_exact(&mut payload).await.map_err(|e| e.to_string())?;
            }
            #[cfg(unix)]
            IpcStream::Unix(s) => {
                s.read_exact(&mut payload).await.map_err(|e| e.to_string())?;
            }
        }

        Ok((opcode, String::from_utf8_lossy(&payload).into_owned()))
    }
}

impl DiscordRpc {
    pub fn new() -> Self {
        Self {
            client_id: CLIENT_ID.to_string(),
            tx: None,
        }
    }

    pub fn start(&mut self, app_handle: AppHandle) {
        if self.tx.is_some() {
            return;
        }

        let (tx, mut rx) = mpsc::unbounded_channel::<RpcMessage>();
        self.tx = Some(tx);
        let client_id = self.client_id.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                match Self::try_connect(&client_id).await {
                    Ok(mut stream) => {
                        info!("[Discord] Connected and handshaked.");
                        
                        let _ = Self::do_subscribe(&mut stream, "ACTIVITY_JOIN").await;
                        let _ = Self::do_subscribe(&mut stream, "ACTIVITY_SPECTATE").await;
                        let _ = Self::do_subscribe(&mut stream, "ACTIVITY_JOIN_REQUEST").await;

                        loop {
                            tokio::select! {
                                Some(msg) = rx.recv() => {
                                    let payload = match msg {
                                        RpcMessage::UpdateActivity(activity) => json!({
                                            "cmd": "SET_ACTIVITY",
                                            "args": { "pid": std::process::id(), "activity": activity },
                                            "nonce": Uuid::new_v4().to_string()
                                        }).to_string(),
                                        RpcMessage::AcceptJoin(user_id) => json!({
                                            "cmd": "SEND_ACTIVITY_JOIN_INVITE",
                                            "args": { "user_id": user_id },
                                            "nonce": Uuid::new_v4().to_string()
                                        }).to_string(),
                                        RpcMessage::RejectJoin(user_id) => json!({
                                            "cmd": "CLOSE_ACTIVITY_JOIN_REQUEST",
                                            "args": { "user_id": user_id },
                                            "nonce": Uuid::new_v4().to_string()
                                        }).to_string(),
                                    };
                                    
                                    if let Err(e) = stream.send(OpCode::Frame, &payload).await {
                                        error!("[Discord] Send failed: {}", e);
                                        break;
                                    }
                                }
                                res = stream.recv() => {
                                    match res {
                                        Ok((_opcode, payload)) => {
                                            if let Ok(v) = serde_json::from_str::<Value>(&payload) {
                                                if let Some(evt) = v["evt"].as_str() {
                                                    match evt {
                                                        "ACTIVITY_JOIN" | "ACTIVITY_SPECTATE" | "ACTIVITY_JOIN_REQUEST" => {
                                                            let _ = app_handle.emit("discord-rpc-event", v);
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            error!("[Discord] Receive failed: {}", e);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("[Discord] Connection failed: {}. Retrying in 10s...", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    }
                }
            }
        });
    }

    async fn try_connect(client_id: &str) -> Result<IpcStream, String> {
        #[cfg(windows)]
        {
            for i in 0..10 {
                let pipe_path = format!(r"\\.\pipe\discord-ipc-{}", i);
                if let Ok(client) = ClientOptions::new().open(&pipe_path) {
                    let mut stream = IpcStream::Windows(client);
                    if Self::do_handshake(&mut stream, client_id).await.is_ok() {
                        return Ok(stream);
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            let tmp_dirs = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"];
            let mut paths = Vec::new();
            for var in tmp_dirs {
                if let Ok(val) = env::var(var) {
                    paths.push(PathBuf::from(val));
                }
            }
            paths.push(PathBuf::from("/tmp"));

            for path in paths {
                for i in 0..10 {
                    let socket_path = path.join(format!("discord-ipc-{}", i));
                    if let Ok(s) = UnixStream::connect(&socket_path).await {
                        let mut stream = IpcStream::Unix(s);
                        if Self::do_handshake(&mut stream, client_id).await.is_ok() {
                            return Ok(stream);
                        }
                    }
                }
            }
        }

        Err("Could not find Discord IPC".to_string())
    }

    async fn do_handshake(stream: &mut IpcStream, client_id: &str) -> Result<(), String> {
        let payload = json!({ "v": 1, "client_id": client_id }).to_string();
        stream.send(OpCode::Handshake, &payload).await?;
        let (_opcode, _response) = stream.recv().await?;
        Ok(())
    }

    async fn do_subscribe(stream: &mut IpcStream, evt: &str) -> Result<(), String> {
        let payload = json!({
            "cmd": "SUBSCRIBE",
            "evt": evt,
            "nonce": Uuid::new_v4().to_string()
        }).to_string();
        stream.send(OpCode::Frame, &payload).await?;
        Ok(())
    }

    pub fn set_activity(&self, activity: Option<Activity>) -> Result<(), String> {
        if let Some(tx) = &self.tx {
            tx.send(RpcMessage::UpdateActivity(activity)).map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("RPC not started".to_string())
        }
    }

    pub fn accept_join_request(&self, user_id: String) -> Result<(), String> {
        if let Some(tx) = &self.tx {
            tx.send(RpcMessage::AcceptJoin(user_id)).map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("RPC not started".to_string())
        }
    }

    pub fn reject_join_request(&self, user_id: String) -> Result<(), String> {
        if let Some(tx) = &self.tx {
            tx.send(RpcMessage::RejectJoin(user_id)).map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("RPC not started".to_string())
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Activity {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamps: Option<Timestamps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<Assets>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party: Option<Party>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Secrets>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Party {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<[u32; 2]>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Secrets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spectate: Option<String>,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Timestamps {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Assets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_text: Option<String>,
}
