//! Native filesystem watcher backed by the `notify` crate.
//!
//! The explorer previously relied on manual refresh + a 5s git poll to notice
//! external changes (git pull, build artifacts, edits from another editor).
//! This module exposes a per-workspace watcher that emits typed `fs-changed`
//! events to the frontend so the UI can refresh only affected nodes.
//!
//! Scope for this PR is the Rust-side infrastructure:
//! - `watch_path` installs a recursive watcher on the given root.
//! - `unwatch_all` disposes the current watcher (tearing down OS handles).
//! - Events are filtered against an always-ignore set (`node_modules`,
//!   `.git`, `target`, `.next`, etc.) plus a caller-supplied exclude list,
//!   and deduplicated per path on a 200 ms window so a single save burst does
//!   not flood the bridge.
//!
//! Frontend consumption (AppContext subscription, tree refresh) is left for a
//! follow-up PR so the transport layer can ship on its own.

use log::warn;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// Path components that are always excluded. These are high-churn directories
/// that would otherwise bury useful signal in noise (thousands of events per
/// `npm install`, `cargo build`, etc.).
const ALWAYS_IGNORE: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    ".next",
    "dist",
    "build",
    ".turbo",
    ".cache",
];

/// Window during which a repeat event for the same path is suppressed. Picked
/// to match the issue's "~200 ms" guidance: long enough to collapse the burst
/// that accompanies a single save (on some editors each save generates
/// create → remove → rename → modify in rapid succession), short enough to
/// stay imperceptible in the UI.
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangeEvent {
    pub path: String,
    pub kind: FsChangeKind,
}

/// Tauri-managed state: holds the active watcher and its root. Dropped (and
/// therefore shut down) when `watch_path` is called again or when
/// `unwatch_all` runs. The `last_emitted` map is shared with the notify
/// callback for per-path debouncing.
pub struct FsWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_root: Option<PathBuf>,
    last_emitted: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl FsWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_root: None,
            last_emitted: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for FsWatcherState {
    fn default() -> Self {
        Self::new()
    }
}

fn should_ignore(path: &Path, extra_excludes: &[String]) -> bool {
    for component in path.components() {
        let s = component.as_os_str().to_string_lossy();
        if ALWAYS_IGNORE.iter().any(|e| s == *e) {
            return true;
        }
        if extra_excludes.iter().any(|e| s == *e) {
            return true;
        }
    }
    false
}

fn classify(kind: &EventKind) -> FsChangeKind {
    match kind {
        EventKind::Create(_) => FsChangeKind::Created,
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => FsChangeKind::Renamed,
        EventKind::Modify(_) => FsChangeKind::Modified,
        EventKind::Remove(_) => FsChangeKind::Removed,
        _ => FsChangeKind::Other,
    }
}

/// Starts watching `path` recursively and emits `fs-changed` events to the
/// frontend for every change under it. Calling this while another watcher is
/// active replaces it (cheap, no double-emit).
#[tauri::command]
pub fn watch_path(
    path: String,
    excludes: Vec<String>,
    app: AppHandle,
    state: State<'_, Arc<Mutex<FsWatcherState>>>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Share the debounce map with the callback. `Arc<Mutex<_>>` is already
    // what the state holds, so cloning the handle is cheap and keeps the
    // callback's capture well-typed.
    let last_emitted = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.last_emitted.clone()
    };
    let app_handle = app.clone();

    let mut watcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
            Ok(event) => {
                let kind = classify(&event.kind);
                for changed_path in event.paths {
                    if should_ignore(&changed_path, &excludes) {
                        continue;
                    }

                    // Per-path debounce. Drop the event if the same path was
                    // emitted within `DEBOUNCE_WINDOW`; otherwise stamp it
                    // and forward. The lock is held briefly so the callback
                    // stays responsive under bursty load.
                    let now = Instant::now();
                    let should_emit = {
                        let mut map = match last_emitted.lock() {
                            Ok(m) => m,
                            Err(_) => return,
                        };
                        match map.get(&changed_path) {
                            Some(prev) if now.duration_since(*prev) < DEBOUNCE_WINDOW => false,
                            _ => {
                                map.insert(changed_path.clone(), now);
                                true
                            }
                        }
                    };

                    if !should_emit {
                        continue;
                    }

                    let payload = FsChangeEvent {
                        path: changed_path.to_string_lossy().into_owned(),
                        kind,
                    };
                    let _ = app_handle.emit("fs-changed", payload);
                }
            }
            Err(e) => {
                warn!("fs watcher error: {}", e);
            }
        })
        .map_err(|e| e.to_string())?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    // Dropping the previous watcher tears down its OS handles.
    guard.watcher = Some(watcher);
    guard.watched_root = Some(root);
    // Reset the debounce map so stale entries from a prior workspace do not
    // suppress early events for the new one.
    if let Ok(mut map) = guard.last_emitted.lock() {
        map.clear();
    }

    Ok(())
}

/// Tears down the active watcher, if any. Idempotent.
#[tauri::command]
pub fn unwatch_all(state: State<'_, Arc<Mutex<FsWatcherState>>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.watcher = None;
    guard.watched_root = None;
    if let Ok(mut map) = guard.last_emitted.lock() {
        map.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_always_blocked_components() {
        let p = PathBuf::from("/repo/node_modules/foo/bar.js");
        assert!(should_ignore(&p, &[]));
    }

    #[test]
    fn ignores_user_exclusions() {
        let p = PathBuf::from("/repo/custom_out/bundle.js");
        assert!(should_ignore(&p, &["custom_out".to_string()]));
    }

    #[test]
    fn allows_normal_source_paths() {
        let p = PathBuf::from("/repo/src/main.rs");
        assert!(!should_ignore(&p, &[]));
    }

    #[test]
    fn classify_maps_variants() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
        assert!(matches!(
            classify(&EventKind::Create(CreateKind::File)),
            FsChangeKind::Created
        ));
        assert!(matches!(
            classify(&EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content
            ))),
            FsChangeKind::Modified
        ));
        assert!(matches!(
            classify(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))),
            FsChangeKind::Renamed
        ));
        assert!(matches!(
            classify(&EventKind::Remove(RemoveKind::File)),
            FsChangeKind::Removed
        ));
    }
}
