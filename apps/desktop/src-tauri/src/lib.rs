mod pty;
mod tunnel;
mod about;

mod extensions;
use extensions::*;

use pty::{resize_pty, spawn_pty, write_to_pty, kill_pty, PtyState};
use tunnel::{get_active_ports, start_tunnel, stop_tunnel, TunnelState};
use serde::Serialize;
use std::fs;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use std::process::Command;

/// Creates a [`Command`] that will NOT show a console window on Windows.
/// On other platforms this is equivalent to `Command::new(program)`.
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


#[derive(serde::Serialize)]
struct SystemStats {
    cpu_usage: f32,
    memory_usage: f64, // percentage
}

// === Custom Updater Implementation to Support Prereleases ===
#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    body: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct InstallerProgress {
    chunk_length: usize,
    content_length: Option<u64>,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, url: String) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    
    let builder = app.updater_builder()
        .endpoints(vec![url.parse().map_err(|e| format!("{}", e))?])
        .map_err(|e| e.to_string())?;

    let updater = builder.build().map_err(|e| e.to_string())?;
    
    // Gracefully handle check errors (e.g. 404 when no release exists yet)
    let update = match updater.check().await {
        Ok(update) => update,
        Err(_) => return Ok(None),
    };

    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        body: u.body,
    }))
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, window: tauri::Window, url: String) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    use tauri::Emitter;
    
    let builder = app.updater_builder()
        .endpoints(vec![url.parse().map_err(|e| format!("{}", e))?])
        .map_err(|e| e.to_string())?;

    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(u) = update {
        u.download_and_install(
            |chunk_length, content_length| {
                let _ = window.emit("updater-progress", InstallerProgress {
                    chunk_length,
                    content_length,
                });
            },
            || {}
        ).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No update found at the provided URL".to_string())
    }
}
// ============================================================

struct SystemState {
    sys: System,
}

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            Some(FileEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                is_dir: metadata.is_dir(),
            })
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct SearchResult {
    file_path: String,
    file_name: String,
    line_number: usize,
    content: String,
}

#[tauri::command]
async fn search_in_project(query: String, root_path: String) -> Result<Vec<SearchResult>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    use walkdir::WalkDir;

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    let max_results = 500;

    for entry in WalkDir::new(&root_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != "node_modules"
                && name != ".git"
                && name != "target"
                && name != ".next"
                && name != "dist"
        })
        .filter_map(|e| e.ok())
    {
        if results.len() >= max_results {
            break;
        }

        let path = entry.path();
        if path.is_file() {
            let file = match File::open(path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let reader = BufReader::new(file);
            for (index, line_result) in reader.lines().enumerate() {
                if let Ok(line) = line_result {
                    if line.to_lowercase().contains(&query_lower) {
                        results.push(SearchResult {
                            file_path: path.to_string_lossy().to_string(),
                            file_name: path.file_name().unwrap().to_string_lossy().to_string(),
                            line_number: index + 1,
                            content: line.trim().to_string(),
                        });
                        if results.len() >= max_results {
                            break;
                        }
                    }
                } else {
                    break; // Skip binary files
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
async fn execute_command(command: String, args: Vec<String>, cwd: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = silent_command("cmd");
        c.arg("/C").arg(&command).args(&args);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = silent_command(&command);
        c.args(&args);
        c
    };

    let output = cmd.current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Error: {}\n{}", stderr, stdout))
    }
}

#[tauri::command]
async fn get_system_health(state: tauri::State<'_, Arc<Mutex<SystemState>>>) -> Result<SystemStats, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    
    // Refresh only what we need for performance
    state.sys.refresh_cpu_all();
    state.sys.refresh_memory();

    let cpu_usage = state.sys.global_cpu_usage(); 
    
    let total_mem = state.sys.total_memory() as f64;
    let used_mem = state.sys.used_memory() as f64;
    let memory_usage = (used_mem / total_mem) * 100.0;

    Ok(SystemStats {
        cpu_usage,
        memory_usage,
    })
}

#[tauri::command]
async fn git_init(path: String) -> Result<String, String> {
    let output = silent_command("git")
        .arg("init")
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn get_git_status(path: String) -> Result<String, String> {
    let output = silent_command("git")
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_git_branches(path: String) -> Result<Vec<String>, String> {
    let output = silent_command("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    let branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(branches)
}

#[tauri::command]
async fn git_commit(path: String, message: String) -> Result<String, String> {
    // We no longer automatically stage all changes.
    // Users must stage changes explicitly.

    let output = silent_command("git")
        .args(["commit", "-m", &message])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn git_add(path: String, files: Vec<String>) -> Result<String, String> {
    let mut args = vec!["add"];
    args.push("--");
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);

    let output = silent_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn git_unstage(path: String, files: Vec<String>) -> Result<String, String> {
    let mut args = vec!["restore", "--staged"];
    args.push("--");
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);

    let output = silent_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn git_push(path: String) -> Result<String, String> {
    let output = silent_command("git")
        .arg("push")
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn get_git_diff(path: String) -> Result<String, String> {
    // Get diff of staged changes
    let output = silent_command("git")
        .args(["diff", "--staged"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_recursive_file_list(root_path: String) -> Result<Vec<String>, String> {
    use walkdir::WalkDir;
    let mut files = Vec::new();
    let root = std::path::Path::new(&root_path);

    for entry in WalkDir::new(&root_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != "node_modules"
                && name != ".git"
                && name != "target"
                && name != ".next"
                && name != "dist"
                && name != "build"
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(rel_path) = entry.path().strip_prefix(root) {
                files.push(rel_path.to_string_lossy().to_string());
            }
        }
    }
    Ok(files)
}

#[tauri::command]
async fn git_add_safe_directory(path: String) -> Result<String, String> {
    let output = silent_command("git")
        .args(["config", "--global", "--add", "safe.directory", &path])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok("OK".to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProxyResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn ollama_proxy(
    method: String,
    url: String,
    body: Option<serde_json::Value>,
) -> Result<ProxyResponse, String> {
    let client = reqwest::Client::new();
    let mut request = match method.as_str() {
        "POST" => client.post(&url),
        "GET" => client.get(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let response_body = response.text().await.map_err(|e| e.to_string())?;

    Ok(ProxyResponse {
        status,
        body: response_body,
    })
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        silent_command("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        silent_command("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new(&path));
        silent_command("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Arc::new(Mutex::new(None::<PtyState>)))
        .manage(Arc::new(Mutex::new(SystemState { sys: System::new_all() })))
        .manage(TunnelState { instances: Mutex::new(std::collections::HashMap::new()) })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file,
            write_file,
            check_update,
            install_update,
            spawn_pty,
            write_to_pty,
            resize_pty,
            kill_pty,
            search_in_project,
            git_init,
            get_git_status,
            get_git_branches,
            git_commit,
            git_add,
            git_unstage,
            git_push,
            get_git_diff,
            git_add_safe_directory,
            get_registry_catalog,
            fetch_extension_manifest,
            fetch_extension_file,
            install_extension,
            uninstall_extension,
            update_extension,
            get_installed_extensions,
            is_extension_active,
            toggle_extension_state,
            read_extension_script,
            get_recursive_file_list,
            execute_command,
            get_system_health,
            ollama_proxy,
            create_directory,
            reveal_path,
            delete_path,
            get_active_ports,
            start_tunnel,
            stop_tunnel,
            about::get_trixty_about_info
        ])
        .setup(|_app| {
            if cfg!(debug_assertions) {
                // Logging or other setup
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
