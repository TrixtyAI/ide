use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(unix)]
use std::env;
#[cfg(unix)]
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;
use uuid::Uuid;
use log::{info, warn};

#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

const CLIENT_ID: &str = "1499852888850301038";

#[derive(Debug, Clone, Copy)]
#[repr(u32)]
pub enum OpCode {
    Handshake = 0,
    Frame = 1,
    // Close = 2,
    // Ping = 3,
    // Pong = 4,
}

pub struct DiscordRpc {
    client_id: String,
    stream: Option<IpcStream>,
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
            stream: None,
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        if self.stream.is_some() {
            return Ok(());
        }

        #[cfg(windows)]
        {
            for i in 0..10 {
                let pipe_path = format!(r"\\.\pipe\discord-ipc-{}", i);
                match ClientOptions::new().open(&pipe_path) {
                    Ok(client) => {
                        let mut stream = IpcStream::Windows(client);
                        if self.handshake(&mut stream).await.is_ok() {
                            self.stream = Some(stream);
                            info!("[Discord] Connected to pipe {}", i);
                            return Ok(());
                        }
                    }
                    Err(_) => continue,
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
                        if self.handshake(&mut stream).await.is_ok() {
                            self.stream = Some(stream);
                            info!("[Discord] Connected to socket {:?}", socket_path);
                            return Ok(());
                        }
                    }
                }
            }
        }

        Err("Could not connect to Discord".to_string())
    }

    async fn handshake(&self, stream: &mut IpcStream) -> Result<(), String> {
        let payload = json!({
            "v": 1,
            "client_id": self.client_id
        }).to_string();

        stream.send(OpCode::Handshake, &payload).await?;
        let (opcode, response) = stream.recv().await?;
        info!("[Discord] Handshake response: opcode={}, payload={}", opcode, response);
        // We could validate response here, but usually success means we're good
        Ok(())
    }

    pub async fn set_activity(&mut self, activity: Activity) -> Result<(), String> {
        if self.stream.is_none() {
            if let Err(e) = self.connect().await {
                return Err(e);
            }
        }

        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": std::process::id(),
                "activity": activity
            },
            "nonce": Uuid::new_v4().to_string()
        }).to_string();

        info!("[Discord] Sending activity: {}", payload);

        if let Some(stream) = &mut self.stream {
            if let Err(e) = stream.send(OpCode::Frame, &payload).await {
                self.stream = None; // Reset on failure
                return Err(format!("Failed to send activity: {}", e));
            }
            
            // Read response
            match stream.recv().await {
                Ok((opcode, response)) => {
                    info!("[Discord] Activity response: opcode={}, payload={}", opcode, response);
                }
                Err(e) => {
                    warn!("[Discord] Failed to read activity response: {}", e);
                    self.stream = None; // Reset on failure
                }
            }
        }

        Ok(())
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
