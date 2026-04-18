use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

/// Creates a [`Command`] that will NOT show a console window on Windows.
#[inline]
fn silent_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub struct TunnelInstance {
    pub _port: u16,
    pub url: String,
    pub child: std::process::Child,
}

pub struct TunnelState {
    pub instances: Mutex<HashMap<u16, Arc<TunnelInstance>>>,
}

#[tauri::command]
pub fn get_active_ports() -> Result<Vec<u16>, String> {
    let mut ports = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // -a: all connections, -n: numerical addr, -o: owning PID, -p tcp: only TCP
        let output = silent_command("netstat")
            .args(["-ano", "-p", "tcp"])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            // We want LISTENING ports that are bound to local/any address
            if line.contains("LISTENING") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let addr = parts[1];
                    // Example: 0.0.0.0:3000 or [::]:3000
                    if let Some(port_str) = addr.split(':').last() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            // Noise Reduction: Exclude well-known system ports (< 1024)
                            // and ensure it's bound locally (0.0.0.0, 127.0.0.1, [::], [::1])
                            let is_local = addr.starts_with("0.0.0.0")
                                || addr.starts_with("127.0.0.1")
                                || addr.starts_with("[::]")
                                || addr.starts_with("localhost");

                            if port >= 1024 && is_local && !ports.contains(&port) {
                                ports.push(port);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // lsof -iTCP -sTCP:LISTEN -P -n
        let output = silent_command("lsof")
            .args(["-iTCP", "-sTCP:LISTEN", "-P", "-n"])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().skip(1) {
            // Skip header
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Typically last part or second to last is the address
            for part in parts {
                if part.contains(':') {
                    if let Some(port_str) = part.split(':').last() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            if port >= 1024 && !ports.contains(&port) {
                                ports.push(port);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort for a cleaner UI
    ports.sort();
    Ok(ports)
}

#[tauri::command]
pub async fn start_tunnel<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, TunnelState>,
    port: u16,
) -> Result<String, String> {
    // Check if tunnel already exists
    {
        let instances = state.instances.lock().unwrap();
        if let Some(inst) = instances.get(&port) {
            return Ok(inst.url.clone());
        }
    }

    // Use local localtunnel installation
    // The working directory for the command will be the project root
    let mut child = if cfg!(target_os = "windows") {
        silent_command("cmd")
            .args(["/C", "pnpm", "lt", "--port", &port.to_string()])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?
    } else {
        silent_command("pnpm")
            .args(["lt", "--port", &port.to_string()])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?
    };

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut url = String::new();

    // Read the first few lines to find the URL
    // localtunnel typically outputs: "your url is: https://..."
    let mut line = String::new();
    for _ in 0..10 {
        line.clear();
        if reader.read_line(&mut line).is_err() || line.is_empty() {
            break;
        }
        if line.contains("your url is:") {
            url = line.replace("your url is:", "").trim().to_string();
            break;
        }
    }

    if url.is_empty() {
        let _ = child.kill();
        return Err("Failed to get tunnel URL from localtunnel".to_string());
    }

    // Success! Store the instance
    let inst = Arc::new(TunnelInstance {
        _port: port,
        url: url.clone(),
        child,
    });

    state.instances.lock().unwrap().insert(port, inst);

    // Emit event with the new URL
    let _ = app.emit("tunnel-ready", (port, url.clone()));

    Ok(url)
}

#[tauri::command]
pub fn stop_tunnel(state: tauri::State<'_, TunnelState>, port: u16) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if let Some(mut inst) = instances.remove(&port) {
        // We need to take ownership to kill the child
        if let Some(inst_mut) = Arc::get_mut(&mut inst) {
            let _ = inst_mut.child.kill();
        }
    }
    Ok(())
}
