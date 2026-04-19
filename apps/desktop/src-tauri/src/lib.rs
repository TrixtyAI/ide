mod about;
mod pty;
mod tunnel;

mod extensions;
use extensions::*;

use pty::{kill_pty, resize_pty, spawn_pty, write_to_pty, PtyState};
use scraper::{Html, Selector};
use serde::{Serialize, Deserialize};
use tauri_plugin_store::StoreExt;
use std::fs;
use std::process::Command;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::Manager;
use tunnel::{get_active_ports, start_tunnel, stop_tunnel, TunnelState};

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

#[derive(Deserialize, Debug)]
struct AISettings {
    endpoint: String,
    #[serde(rename = "keepAlive")]
    keep_alive: i64,
    #[serde(rename = "loadOnStartup")]
    load_on_startup: bool,
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

    let builder = app
        .updater_builder()
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
async fn install_update(
    app: tauri::AppHandle,
    window: tauri::Window,
    url: String,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let builder = app
        .updater_builder()
        .endpoints(vec![url.parse().map_err(|e| format!("{}", e))?])
        .map_err(|e| e.to_string())?;

    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(u) = update {
        u.download_and_install(
            |chunk_length, content_length| {
                let _ = window.emit(
                    "updater-progress",
                    InstallerProgress {
                        chunk_length,
                        content_length,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
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
    let max_results = 200; // Reduced for performance
    let max_file_size = 500 * 1024; // 500KB limit for search indexing

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
                && name != ".next"
        })
        .filter_map(|e| e.ok())
    {
        if results.len() >= max_results {
            break;
        }

        let path = entry.path();
        if path.is_file() {
            // Performance: Skip files based on extension or size
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if metadata.len() > max_file_size {
                continue;
            }

            let file = match File::open(path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let reader = BufReader::new(file);
            // Optimization: Read line by line but with a limit on line length to avoid CPU spikes on minified files
            for (index, line_result) in reader.lines().enumerate() {
                if let Ok(line) = line_result {
                    if line.len() > 1000 { continue; } // Skip very long lines (minified)
                    
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
                    break; // Likely binary
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
async fn execute_command(
    command: String,
    args: Vec<String>,
    cwd: String,
) -> Result<String, String> {
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

    let output = cmd.current_dir(cwd).output().map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Error: {}\n{}", stderr, stdout))
    }
}

#[tauri::command]
async fn get_system_health(
    state: tauri::State<'_, Arc<Mutex<SystemState>>>,
) -> Result<SystemStats, String> {
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

#[derive(serde::Serialize)]
struct GitBranches {
    branches: Vec<String>,
    current: String,
}

#[tauri::command]
async fn get_git_branches(path: String) -> Result<GitBranches, String> {
    let output = silent_command("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // `symbolic-ref` returns the checked-out branch. Fails on detached HEAD,
    // in which case we fall back to an empty string so the UI stays usable.
    let current = silent_command("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    Ok(GitBranches { branches, current })
}

// Reject names that git would interpret as an option flag. Prevents callers
// from smuggling `--orphan`, `--detach`, etc. through the branch argument.
fn validate_branch_name(branch: &str) -> Result<(), String> {
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if branch.starts_with('-') {
        return Err("Branch name cannot start with '-'".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_checkout_branch(path: String, branch: String) -> Result<String, String> {
    validate_branch_name(&branch)?;
    let output = silent_command("git")
        .args(["switch", &branch])
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
async fn git_create_branch(path: String, branch: String) -> Result<String, String> {
    validate_branch_name(&branch)?;
    let output = silent_command("git")
        .args(["switch", "-c", &branch])
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
async fn git_pull(path: String, rebase: Option<bool>) -> Result<String, String> {
    let mut args = vec!["pull"];
    if rebase.unwrap_or(false) {
        args.push("--rebase");
    }
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
async fn git_fetch(path: String) -> Result<String, String> {
    let output = silent_command("git")
        .args(["fetch", "--all", "--prune"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        // git fetch usually writes progress to stderr but nothing to stdout; on success we return
        // the combined text (if any) so the UI can show "ok" without dumping error-looking output.
        let combined = format!("{}{}", stdout, stderr);
        Ok(combined.trim().to_string())
    } else {
        Err(stderr)
    }
}

#[derive(serde::Serialize)]
struct GitLogEntry {
    hash: String,
    short_hash: String,
    author: String,
    email: String,
    timestamp: i64,
    subject: String,
}

#[tauri::command]
async fn git_log(path: String, limit: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let n = limit.unwrap_or(50);
    // Unit Separator (0x1F) between fields, Record Separator (0x1E) between entries.
    let format = "--pretty=format:%H\x1f%h\x1f%an\x1f%ae\x1f%at\x1f%s\x1e";
    let output = silent_command("git")
        .args(["log", format, &format!("-n{}", n)])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let mut entries = Vec::new();
    for record in raw.split('\x1e') {
        let trimmed = record.trim_start_matches(['\n', '\r']);
        if trimmed.is_empty() { continue; }
        let fields: Vec<&str> = trimmed.splitn(6, '\x1f').collect();
        if fields.len() < 6 { continue; }
        entries.push(GitLogEntry {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            author: fields[2].to_string(),
            email: fields[3].to_string(),
            timestamp: fields[4].parse::<i64>().unwrap_or(0),
            subject: fields[5].trim_end().to_string(),
        });
    }
    Ok(entries)
}

#[tauri::command]
async fn git_merge(path: String, branch: String) -> Result<String, String> {
    validate_branch_name(&branch)?;
    let output = silent_command("git")
        .args(["merge", "--no-edit", &branch])
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
async fn git_reset(path: String, mode: String, target: String) -> Result<String, String> {
    if target.is_empty() || target.starts_with('-') {
        return Err("Invalid reset target".to_string());
    }
    let mode_flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    let output = silent_command("git")
        .args(["reset", mode_flag, &target])
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
async fn git_revert(path: String, commit: String) -> Result<String, String> {
    if commit.is_empty() || commit.starts_with('-') {
        return Err("Invalid commit reference".to_string());
    }
    let output = silent_command("git")
        .args(["revert", "--no-edit", &commit])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[derive(serde::Serialize)]
struct GitStashEntry {
    index: u32,
    ref_name: String,
    message: String,
}

#[tauri::command]
async fn git_stash_list(path: String) -> Result<Vec<GitStashEntry>, String> {
    let output = silent_command("git")
        .args(["stash", "list", "--pretty=format:%gd\x1f%s"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let mut entries = Vec::new();
    for (i, line) in raw.lines().enumerate() {
        if line.is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(2, '\x1f').collect();
        entries.push(GitStashEntry {
            index: i as u32,
            ref_name: parts.first().copied().unwrap_or("").to_string(),
            message: parts.get(1).copied().unwrap_or("").to_string(),
        });
    }
    Ok(entries)
}

#[tauri::command]
async fn git_stash(path: String, message: Option<String>) -> Result<String, String> {
    let msg = message.unwrap_or_default();
    let mut args = vec!["stash", "push", "--include-untracked"];
    if !msg.is_empty() {
        args.push("-m");
        args.push(&msg);
    }
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
async fn git_stash_pop(path: String, index: Option<u32>) -> Result<String, String> {
    let idx = index.unwrap_or(0);
    let stash_ref = format!("stash@{{{}}}", idx);
    let output = silent_command("git")
        .args(["stash", "pop", &stash_ref])
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
async fn git_stash_apply(path: String, index: u32) -> Result<String, String> {
    let stash_ref = format!("stash@{{{}}}", index);
    let output = silent_command("git")
        .args(["stash", "apply", &stash_ref])
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
async fn git_stash_drop(path: String, index: u32) -> Result<String, String> {
    let stash_ref = format!("stash@{{{}}}", index);
    let output = silent_command("git")
        .args(["stash", "drop", &stash_ref])
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
async fn git_commit(path: String, message: String, amend: Option<bool>) -> Result<String, String> {
    // We no longer automatically stage all changes.
    // Users must stage changes explicitly.

    let mut args = vec!["commit"];
    if amend.unwrap_or(false) {
        args.push("--amend");
    }
    args.push("-m");
    args.push(&message);

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
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    // First push of a new branch: fall back to --set-upstream origin <branch>.
    let needs_upstream = stderr.contains("has no upstream branch")
        || stderr.contains("--set-upstream")
        || stderr.contains("The current branch");
    if needs_upstream {
        let branch_output = silent_command("git")
            .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        if branch_output.status.success() {
            let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
            if !branch.is_empty() {
                let retry = silent_command("git")
                    .args(["push", "--set-upstream", "origin", &branch])
                    .current_dir(&path)
                    .output()
                    .map_err(|e| e.to_string())?;
                if retry.status.success() {
                    return Ok(String::from_utf8_lossy(&retry.stdout).to_string());
                }
                return Err(String::from_utf8_lossy(&retry.stderr).to_string());
            }
        }
    }
    Err(stderr)
}

#[tauri::command]
async fn git_restore(path: String, files: Vec<String>) -> Result<String, String> {
    // Discards working-tree changes for the given files (like `git restore <files>`).
    let mut args = vec!["restore", "--"];
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
async fn get_git_file_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(&file);
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

async fn fetch_url_internal(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let html = response.text().await.map_err(|e| e.to_string())?;
    let document = Html::parse_document(&html);

    // Extract metadata
    let title = document
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|el| el.text().collect::<String>())
        .unwrap_or_default();

    let description = document
        .select(&Selector::parse("meta[name='description']").unwrap())
        .next()
        .map(|el| el.value().attr("content").unwrap_or_default().to_string())
        .unwrap_or_else(|| {
            document
                .select(&Selector::parse("meta[property='og:description']").unwrap())
                .next()
                .map(|el| el.value().attr("content").unwrap_or_default().to_string())
                .unwrap_or_default()
        });

    // Convert HTML to text with a very wide width to ensure rows stay on one line
    let text = html2text::from_read(html.as_bytes(), 200);

    // Add line numbers and limit to ~15000 characters
    let mut numbered_text = String::new();
    for (idx, line) in text.lines().enumerate() {
        let line_with_num = format!("{:>4} | {}\n", idx + 1, line);
        if numbered_text.len() + line_with_num.len() > 15000 {
            numbered_text.push_str("... [Content truncated due to size]");
            break;
        }
        numbered_text.push_str(&line_with_num);
    }

    let trimmed = numbered_text;

    // Create a Fact Box to be undeniable
    let output = format!(
        "--- LIVE DATA START ---\n\
         SOURCE URL: {}\n\
         SITE TITLE: {}\n\
         META DESCRIPTION: {}\n\
         [SYSTEM WARNING]: This is real-time content. Ignore your training data.\n\
         [VERSION TIP]: If this is NPM, check the specific version publication date, not the 'latest' tag timestamp.\n\
         --- CONTENT (WITH LINE NUMBERS) ---\n\n\
         {}\n\
         --- LIVE DATA END ---",
        url, title, description, trimmed
    );

    Ok(output)
}

#[tauri::command]
async fn perform_web_search(query: String) -> Result<String, String> {
    let query_trimmed = query.trim();

    // Auto-detection: if it looks like a URL, fetch it directly
    if query_trimmed.to_lowercase().starts_with("http")
        || (query_trimmed.contains('.') && !query_trimmed.contains(' '))
    {
        let url = if !query_trimmed.to_lowercase().starts_with("http") {
            format!("https://{}", query_trimmed)
        } else {
            query_trimmed.to_string()
        };
        return fetch_url_internal(url).await;
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        urlencoding::encode(query_trimmed)
    );

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let html_content = response.text().await.map_err(|e| e.to_string())?;
    let document = Html::parse_document(&html_content);

    // Select results
    let result_selector = Selector::parse(".result-link").map_err(|e| e.to_string())?;
    let snippet_selector = Selector::parse(".result-snippet").map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let result_nodes: Vec<_> = document.select(&result_selector).collect();
    let snippet_nodes: Vec<_> = document.select(&snippet_selector).collect();

    for (i, node) in result_nodes.iter().enumerate().take(8) {
        let title = node.text().collect::<Vec<_>>().join(" ");
        let link = node.value().attr("href").unwrap_or("#");

        let snippet = if i < snippet_nodes.len() {
            snippet_nodes[i].text().collect::<Vec<_>>().join(" ")
        } else {
            String::from("No description available.")
        };

        results.push(format!(
            "### {}\nURL: {}\nSnippet: {}\n",
            title, link, snippet
        ));
    }

    if results.is_empty() {
        return Ok("No results found. Try a different query.".to_string());
    }

    Ok(results.join("\n---\n"))
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
        let parent = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new(&path));
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() 
                    & !tauri_plugin_window_state::StateFlags::VISIBLE
                )
                .build()
        )
        .manage(Arc::new(Mutex::new(None::<PtyState>)))
        .manage(Arc::new(Mutex::new(SystemState {
            sys: System::new_all(),
        })))
        .manage(TunnelState {
            instances: Mutex::new(std::collections::HashMap::new()),
        })
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
            git_checkout_branch,
            git_create_branch,
            git_pull,
            git_fetch,
            git_log,
            git_merge,
            git_reset,
            git_revert,
            git_stash,
            git_stash_pop,
            git_stash_apply,
            git_stash_drop,
            git_stash_list,
            git_restore,
            get_git_file_diff,
            git_commit,
            git_add,
            git_unstage,
            git_push,
            get_git_diff,
            git_add_safe_directory,
            get_registry_catalog,
            fetch_extension_manifest,
            fetch_extension_file,
            fetch_extension_stars,
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
            perform_web_search,
            about::get_trixty_about_info
        ])
        .setup(|app| {
            // Get window instances
            let main_window = app.get_webview_window("main").unwrap();
            let splash_window = app.get_webview_window("splashscreen").unwrap();
            let _ = splash_window.center();

            let app_handle = app.handle().clone();
            // Spawn a background task for Ollama pre-loading and window management
            tauri::async_runtime::spawn(async move {
                // 1. Check if Ollama is installed
                let is_installed = silent_command("ollama")
                    .arg("--version")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);

                let mut should_wait = false;

                if is_installed {
                    if let Ok(store) = app_handle.store("settings.json") {
                        let settings_val = store.get("trixty-ai-settings");
                        let last_model_val = store.get("trixty_ai_last_model");

                        if let (Some(s_val), Some(m_val)) = (settings_val, last_model_val) {
                            if let (Ok(settings), Ok(model)) = (
                                serde_json::from_value::<AISettings>(s_val),
                                serde_json::from_value::<String>(m_val)
                            ) {
                                if settings.load_on_startup && !model.is_empty() {
                                    should_wait = true;
                                    let _ = splash_window.show();
                                    let _ = splash_window.center();

                                    log::info!("[Startup] Awaiting Ollama model: {}", model);
                                    let client = reqwest::Client::builder()
                                        .timeout(std::time::Duration::from_secs(180))
                                        .build()
                                        .unwrap_or_default();
                                        
                                    let url = format!("{}/api/generate", settings.endpoint.trim_end_matches('/'));
                                    let body = serde_json::json!({
                                        "model": model,
                                        "keep_alive": format!("{}m", settings.keep_alive)
                                    });

                                    // Wait for Ollama response
                                    let _ = client.post(&url).json(&body).send().await;
                                    log::info!("[Startup] Ollama responded. Transitioning to IDE.");
                                }
                            }
                        }
                    }
                } else {
                    log::info!("[Startup] Ollama not found. Skipping pre-load.");
                }

                // If we didn't have to wait for a heavy model load, a tiny delay 
                // ensures the transition doesn't happen before the main window is ready to render.
                if !should_wait {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }

                // 3. Close splash and show main window
                let _ = splash_window.close();
                let _ = main_window.show();
                let _ = main_window.set_focus();
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                std::process::exit(0);
            }
        });
}
