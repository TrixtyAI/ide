use log::error;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Runtime};

pub struct PtyState {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
}

#[tauri::command]
pub fn spawn_pty<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, Arc<Mutex<Option<PtyState>>>>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    // If session exists, it will be replaced (dropping old resources kills the previous PTY)

    let pty_system = native_pty_system();

    let mut cmd = if cfg!(windows) {
        // Try pwsh (PowerShell 7+) first, fall back to powershell.exe
        let shell = if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            "pwsh.exe"
        } else {
            "powershell.exe"
        };
        let mut c = CommandBuilder::new(shell);
        c.arg("-NoLogo"); // Suppress the copyright banner
        c.arg("-NoExit"); // Keep running
        c
    } else {
        let mut c = CommandBuilder::new("bash");
        c.arg("-l"); // Login shell to load .bash_profile
        c
    };

    // Set working directory: use provided cwd, fallback to home
    if let Some(dir) = cwd {
        if std::path::Path::new(&dir).is_dir() {
            cmd.cwd(&dir);
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
    } else if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            let err = e.to_string();
            error!("Failed to open PTY: {}", err);
            err
        })?;

    let _child = pair.slave.spawn_command(cmd).map_err(|e| {
        let err = e.to_string();
        error!("Failed to spawn shell command in PTY: {}", err);
        err
    })?;

    // Drop slave to avoid leaks
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| {
        let err = e.to_string();
        error!("Failed to clone PTY reader: {}", err);
        err
    })?;
    let writer = pair.master.take_writer().map_err(|e| {
        let err = e.to_string();
        error!("Failed to take PTY writer: {}", err);
        err
    })?;

    let pty_state = PtyState {
        writer: Arc::new(Mutex::new(writer)),
        master: pair.master,
    };

    *state.lock().map_err(|e| {
        let err = e.to_string();
        error!("PTY state lock failed: {}", err);
        err
    })? = Some(pty_state);

    // Spawn a thread to read from the PTY and emit to the frontend
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app.emit("pty-output", data);
                }
                Err(e) => {
                    error!("PTY reader error: {}", e);
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_to_pty(
    data: String,
    state: tauri::State<'_, Arc<Mutex<Option<PtyState>>>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(s) = guard.as_ref() {
        let mut writer = s.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    rows: u16,
    cols: u16,
    state: tauri::State<'_, Arc<Mutex<Option<PtyState>>>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(s) = guard.as_ref() {
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Kills the currently active PTY session (if any).
/// Dropping the PtyState closes the master PTY handle which signals the shell to exit.
#[tauri::command]
pub fn kill_pty(state: tauri::State<'_, Arc<Mutex<Option<PtyState>>>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    *guard = None; // Drops PtyState — closes master PTY and terminates child
    Ok(())
}
