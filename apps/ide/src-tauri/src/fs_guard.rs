//! Workspace-root containment for the generic filesystem commands.
//!
//! `read_file`, `write_file`, `read_directory`, `create_directory` and
//! `delete_path` accept an absolute path from the renderer. Without a
//! containment check, a compromised extension or a prompt-injected AI tool
//! call can feed them `C:\Windows\System32\...` or `/etc/shadow` and the
//! command happily reads/writes there. Other surfaces (extension ids, git
//! URLs, `reveal_path`) already have validators; this module generalises the
//! check to the plain fs commands.
//!
//! The guard works in two steps:
//!
//! 1. `set_workspace_root` records the canonicalised path of the currently
//!    open folder in shared state. It is called from the frontend every time
//!    the user picks a new workspace (or clears it via `resetApp`).
//! 2. `resolve_within_workspace` canonicalises the caller-supplied path —
//!    walking to the nearest existing ancestor when the target doesn't exist
//!    yet (e.g. the destination of a `write_file` creating a new file) — and
//!    asserts the result is a descendant of the stored root.
//!
//! Symlink escapes are defeated because `canonicalize` resolves links, so a
//! symlink at `<workspace>/link → /etc` produces `/etc` and fails the
//! `starts_with` containment check. `..` traversal is defeated two ways: when
//! the target exists the OS already folds the `..` during canonicalisation,
//! and when it doesn't exist we refuse any `..` components in the trailing
//! non-existing suffix (otherwise `PathBuf::starts_with`, which is textual,
//! would let `workspace/../etc/passwd` satisfy the prefix check).

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::error::redact_user_paths;

/// Shared state type registered with `tauri::Builder::manage`. The inner
/// option holds the canonicalised path of the active workspace, or `None`
/// before the user has opened a folder.
pub type WorkspaceState = Arc<Mutex<Option<PathBuf>>>;

pub fn new_workspace_state() -> WorkspaceState {
    Arc::new(Mutex::new(None))
}

/// Records the workspace root in shared state. Pass `None` to clear (called
/// on folder close / app reset). The path is canonicalised eagerly so every
/// subsequent containment check compares against the same resolved form
/// (including on Windows where `canonicalize` emits verbatim `\\?\C:\…`
/// prefixes).
#[tauri::command]
pub fn set_workspace_root(
    path: Option<String>,
    state: tauri::State<'_, WorkspaceState>,
) -> Result<(), String> {
    let canonical = match path {
        Some(p) => Some(PathBuf::from(&p).canonicalize().map_err(|e| {
            redact_user_paths(&format!(
                "Failed to canonicalize workspace root {}: {}",
                p, e
            ))
        })?),
        None => None,
    };
    let mut guard = state
        .lock()
        .map_err(|e| format!("Workspace state lock failed: {}", e))?;
    *guard = canonical;
    Ok(())
}

/// Resolves `path` to an absolute, canonical form and asserts it lives inside
/// the currently-set workspace root. Returns the canonical path so callers
/// can hand it to `fs::*` instead of the raw input — a small defence in
/// depth against future regressions that forget to substitute the resolved
/// value.
pub fn resolve_within_workspace(path: &str, state: &WorkspaceState) -> Result<PathBuf, String> {
    let root = {
        let guard = state
            .lock()
            .map_err(|e| format!("Workspace state lock failed: {}", e))?;
        guard
            .as_ref()
            .ok_or_else(|| {
                "No workspace is open; this operation requires an active folder".to_string()
            })?
            .clone()
    };
    let resolved = resolve_against_existing_ancestor(Path::new(path))?;
    if !resolved.starts_with(&root) {
        return Err(redact_user_paths(&format!(
            "Path {} is outside the workspace",
            path
        )));
    }
    Ok(resolved)
}

/// Canonicalises as much of `path` as already exists on disk and re-appends
/// the non-existing trailing components verbatim. Used so `write_file` and
/// `create_directory` can run the containment check even when their target
/// is a new path.
///
/// The trailing suffix is restricted to `Component::Normal` entries. Any
/// `Component::ParentDir` (`..`) in the non-existing tail is rejected: the
/// resulting `PathBuf` would otherwise retain a literal `..`, and
/// `PathBuf::starts_with` is a component-wise textual match — so
/// `<canonical-root>/../outside` would pass containment. By the time we get
/// to the tail the OS has already resolved `..` through every existing
/// ancestor, so a surviving `..` is unambiguously a traversal attempt
/// against a not-yet-existing prefix and has no legitimate use.
fn resolve_against_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path.canonicalize().map_err(|e| {
            redact_user_paths(&format!("Failed to canonicalize {}: {}", path.display(), e))
        });
    }

    let mut tail: Vec<OsString> = Vec::new();
    let mut cursor = path.to_path_buf();
    loop {
        if cursor.exists() {
            break;
        }
        let last = cursor.components().next_back().ok_or_else(|| {
            redact_user_paths(&format!(
                "Cannot resolve {}: no existing ancestor on disk",
                path.display()
            ))
        })?;
        match last {
            Component::Normal(name) => tail.push(name.to_owned()),
            Component::CurDir => { /* `.` contributes nothing */ }
            Component::ParentDir => {
                return Err(redact_user_paths(&format!(
                    "Path {} traverses above an existing ancestor",
                    path.display()
                )));
            }
            // Prefix / RootDir always `exists()` on their own platform, so
            // we shouldn't reach this arm. Treat as a rejection rather than
            // silently allowing unexpected component kinds.
            _ => {
                return Err(redact_user_paths(&format!(
                    "Path {} contains an unsupported component",
                    path.display()
                )));
            }
        }
        if !cursor.pop() {
            return Err(redact_user_paths(&format!(
                "Cannot resolve {}: no existing ancestor on disk",
                path.display()
            )));
        }
    }

    let mut resolved = cursor.canonicalize().map_err(|e| {
        redact_user_paths(&format!(
            "Failed to canonicalize ancestor of {}: {}",
            path.display(),
            e
        ))
    })?;
    for name in tail.iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Builds a state pointing at `root` and returns both so tests can reuse
    /// the temp dir for file creation. The root is canonicalised first,
    /// matching what `set_workspace_root` does in production.
    fn state_with_root(root: &Path) -> WorkspaceState {
        let canonical = root.canonicalize().expect("canonicalize temp root");
        Arc::new(Mutex::new(Some(canonical)))
    }

    #[test]
    fn rejects_when_no_workspace_is_set() {
        let state: WorkspaceState = new_workspace_state();
        let err = resolve_within_workspace("/tmp/whatever", &state).unwrap_err();
        assert!(err.contains("No workspace is open"), "got: {err}");
    }

    #[test]
    fn accepts_existing_file_inside_workspace() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("inside.txt");
        fs::write(&file, "hello").unwrap();

        let state = state_with_root(dir.path());
        let resolved =
            resolve_within_workspace(file.to_str().unwrap(), &state).expect("inside path allowed");
        assert!(resolved.ends_with("inside.txt"));
    }

    #[test]
    fn accepts_nested_new_file_inside_workspace() {
        // `write_file` creating a brand-new file under a new subdirectory
        // must pass even though the leaf doesn't exist yet.
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("new_dir").join("new_file.txt");

        let state = state_with_root(dir.path());
        let resolved = resolve_within_workspace(target.to_str().unwrap(), &state)
            .expect("new nested file allowed");
        assert!(resolved.ends_with("new_file.txt"));
    }

    #[test]
    fn rejects_absolute_path_outside_workspace() {
        let inside = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = outside.path().join("secret.txt");
        fs::write(&escape, "nope").unwrap();

        let state = state_with_root(inside.path());
        let err = resolve_within_workspace(escape.to_str().unwrap(), &state).unwrap_err();
        assert!(err.contains("outside the workspace"), "got: {err}");
    }

    #[test]
    fn rejects_parent_dir_escape_via_existing_ancestor() {
        // Existing path that resolves outside the workspace via `..`. The OS
        // folds the `..` during `canonicalize`, so the containment check
        // catches it without needing the tail-rejection branch.
        let inside = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = outside.path().join("secret.txt");
        fs::write(&escape, "nope").unwrap();

        // Build an escape path rooted at `inside` with enough `..`s to reach
        // `outside`. We canonicalize the two temp dirs first so we can count
        // components on a stable form (macOS wraps tmp paths in /private/…).
        let inside_canon = inside.path().canonicalize().unwrap();
        let outside_canon = outside.path().canonicalize().unwrap();
        let depth = inside_canon.components().count();
        let mut traversal = inside_canon.clone();
        for _ in 0..depth {
            traversal.push("..");
        }
        // Re-enter `outside` relative to filesystem root.
        for component in outside_canon.components().skip(1) {
            traversal.push(component.as_os_str());
        }
        traversal.push("secret.txt");

        let state = state_with_root(inside.path());
        let err = resolve_within_workspace(traversal.to_str().unwrap(), &state).unwrap_err();
        assert!(err.contains("outside the workspace"), "got: {err}");
    }

    #[test]
    fn rejects_parent_dir_in_nonexistent_tail() {
        // The ancestor exists, but the requested leaf reintroduces `..` past
        // it. This is the branch the `Component::ParentDir` rejection guards
        // against: without it, `starts_with` on a retained literal `..`
        // would wrongly accept the path.
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("child").join("..").join("..").join("loot");

        let state = state_with_root(dir.path());
        let err = resolve_within_workspace(target.to_str().unwrap(), &state).unwrap_err();
        assert!(
            err.contains("traverses above") || err.contains("outside the workspace"),
            "got: {err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_on_unix() {
        use std::os::unix::fs::symlink;

        let inside = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, "leak").unwrap();

        // `inside/link` points at `outside` — any read through `inside/link/…`
        // is really a read of `outside/…`.
        let link = inside.path().join("link");
        symlink(outside.path(), &link).unwrap();
        let through_link = link.join("secret.txt");

        let state = state_with_root(inside.path());
        let err = resolve_within_workspace(through_link.to_str().unwrap(), &state).unwrap_err();
        assert!(err.contains("outside the workspace"), "got: {err}");
    }

    #[test]
    fn set_then_clear_workspace_root() {
        let dir = TempDir::new().unwrap();
        let state: WorkspaceState = new_workspace_state();
        {
            let mut guard = state.lock().unwrap();
            *guard = Some(dir.path().canonicalize().unwrap());
        }
        // Sanity: path inside is allowed while root is set.
        let inside = dir.path().join("a.txt");
        fs::write(&inside, "x").unwrap();
        assert!(resolve_within_workspace(inside.to_str().unwrap(), &state).is_ok());

        // Clearing puts us back into the "no workspace" rejection path.
        {
            let mut guard = state.lock().unwrap();
            *guard = None;
        }
        let err = resolve_within_workspace(inside.to_str().unwrap(), &state).unwrap_err();
        assert!(err.contains("No workspace is open"), "got: {err}");
    }
}
