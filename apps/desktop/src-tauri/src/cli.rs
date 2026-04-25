//! Command-line argument parsing for the main Trixty binary.
//!
//! The `tide` launcher (see `src/bin/tide.rs`) calls the main binary with a
//! `--path <PATH>` argument pointing at the folder the user asked to open.
//! We also accept the first positional argument as a shorthand so
//! `TrixtyIDE .` works the same as `TrixtyIDE --path .`, which matches what
//! users type when they don't go through `tide`.
//!
//! Keeping the parser self-contained in a small module (rather than pulling
//! in `tauri-plugin-cli`) avoids adding a whole plugin-runtime for what is
//! really a single optional argument. The downside is no auto-generated
//! `--help`; that's fine for a workspace opener that only speaks one flag.
//!
//! The parser is intentionally strict about validation so a malformed
//! invocation (nonexistent path, path that points at a file) surfaces as a
//! logged warning and the app falls back to its normal cold-start flow —
//! launching straight into Welcome — rather than crashing the process or
//! silently ignoring the user's intent.
//!
//! Tauri-specific filesystem events are NOT wired in here because this
//! module runs before Tauri's setup callback. We resolve the path to an
//! absolute, canonical form and hand it to the frontend through managed
//! state so the `set_workspace_root` containment guard picks it up.

use std::env;
use std::path::PathBuf;

use crate::error::redact_user_paths;

/// Result of parsing argv. When the user didn't supply a path (cold start
/// from the launcher, Start Menu, Dock) every variant falls back to
/// `Empty`, which is how we express "use the normal startup flow".
#[derive(Debug, PartialEq, Eq)]
pub enum CliWorkspace {
    /// No `--path` or positional argument was given.
    Empty,
    /// The user supplied a path and it resolved to an existing directory.
    Path(PathBuf),
    /// The user supplied something, but it failed validation. We keep the
    /// reason so the setup hook can log it (via `redact_user_paths`) and the
    /// frontend can optionally surface a toast later. The path is the raw
    /// input, not the resolved form — we might not have been able to
    /// resolve it at all (e.g. doesn't exist).
    Invalid { raw: String, reason: String },
}

/// Parses the current process argv and returns the first workspace path
/// it finds (or `Empty`). Split from [`parse_args`] so tests can drive it
/// without shelling out.
pub fn parse_cli_workspace() -> CliWorkspace {
    let raw: Vec<String> = env::args().collect();
    parse_args(&raw, env::current_dir().ok())
}

/// Looks for either `--path <PATH>` or the first positional argument after
/// the program name (argv[0]). A `--` sentinel terminates flag parsing, so
/// `TrixtyIDE -- --path` treats `--path` as a literal workspace.
///
/// `cwd` is the current working directory used to resolve relative paths
/// and the `.` shorthand. Threading it through as a parameter (instead of
/// reading `env::current_dir()` inside) keeps the core logic
/// deterministically testable on any platform.
pub fn parse_args(argv: &[String], cwd: Option<PathBuf>) -> CliWorkspace {
    // Skip argv[0] (the program name). Nothing else to do on a bare launch.
    let mut iter = argv.iter().skip(1).peekable();
    let mut candidate: Option<String> = None;
    let mut seen_double_dash = false;

    while let Some(arg) = iter.next() {
        if !seen_double_dash {
            if arg == "--" {
                seen_double_dash = true;
                continue;
            }
            if arg == "--path" {
                // `--path X` — take the next token regardless of shape.
                match iter.next() {
                    Some(value) => {
                        candidate = Some(value.clone());
                        break;
                    }
                    None => {
                        return CliWorkspace::Invalid {
                            raw: "--path".to_string(),
                            reason: "--path flag requires a value".to_string(),
                        };
                    }
                }
            }
            if let Some(value) = arg.strip_prefix("--path=") {
                candidate = Some(value.to_string());
                break;
            }
            // Other `--foo` tokens are not ours; ignore them so future
            // Tauri-level flags (`--webview-version`, debug flags added by
            // tooling) don't get mis-parsed as workspace paths.
            if arg.starts_with("--") {
                continue;
            }
        }
        // First positional (or first token after `--`). This is where
        // `tide .` and `tide c:\test` land when there's no explicit flag.
        candidate = Some(arg.clone());
        break;
    }

    let Some(raw) = candidate else {
        return CliWorkspace::Empty;
    };

    resolve_workspace_path(&raw, cwd.as_deref())
}

/// Resolves a user-supplied path string to an absolute, canonical directory
/// path, rejecting paths that don't exist or point at a regular file. The
/// returned `PathBuf` is what gets fed into `set_workspace_root`, which then
/// re-canonicalises defensively — we canonicalise here too so the
/// pre-startup logging and the Tauri-side guard agree on the same form.
pub fn resolve_workspace_path(raw: &str, cwd: Option<&std::path::Path>) -> CliWorkspace {
    // Trim surrounding whitespace; a cut-and-paste drag from a terminal
    // occasionally grabs a trailing newline that would otherwise turn into
    // a "no such file" error.
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return CliWorkspace::Invalid {
            raw: raw.to_string(),
            reason: "workspace path is empty".to_string(),
        };
    }

    // Build an absolute-but-not-yet-canonical path. `.` and other
    // relative forms are joined against the caller's cwd so the semantics
    // match what a user expects from a shell (`tide .` opens the shell's
    // working directory, not TrixtyIDE's install directory).
    let candidate = {
        let buf = PathBuf::from(trimmed);
        if buf.is_absolute() {
            buf
        } else if let Some(cwd) = cwd {
            cwd.join(buf)
        } else {
            buf
        }
    };

    let canonical = match candidate.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            return CliWorkspace::Invalid {
                raw: raw.to_string(),
                reason: redact_user_paths(&format!("path does not exist: {}", e)),
            };
        }
    };

    if !canonical.is_dir() {
        return CliWorkspace::Invalid {
            raw: raw.to_string(),
            reason: "path is not a directory".to_string(),
        };
    }

    CliWorkspace::Path(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn argv(rest: &[&str]) -> Vec<String> {
        let mut v = vec!["TrixtyIDE".to_string()];
        v.extend(rest.iter().map(|s| (*s).to_string()));
        v
    }

    #[test]
    fn no_args_is_empty() {
        let out = parse_args(&argv(&[]), None);
        assert_eq!(out, CliWorkspace::Empty);
    }

    #[test]
    fn positional_existing_directory_is_accepted() {
        let dir = TempDir::new().unwrap();
        let out = parse_args(&argv(&[dir.path().to_str().unwrap()]), None);
        match out {
            CliWorkspace::Path(p) => assert!(p.is_dir()),
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn dash_path_flag_existing_directory_is_accepted() {
        let dir = TempDir::new().unwrap();
        let out = parse_args(&argv(&["--path", dir.path().to_str().unwrap()]), None);
        match out {
            CliWorkspace::Path(p) => assert!(p.is_dir()),
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn dash_path_equals_form_is_accepted() {
        let dir = TempDir::new().unwrap();
        let arg = format!("--path={}", dir.path().to_str().unwrap());
        let out = parse_args(&argv(&[&arg]), None);
        match out {
            CliWorkspace::Path(p) => assert!(p.is_dir()),
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn dot_is_resolved_against_cwd() {
        let dir = TempDir::new().unwrap();
        let canonical_cwd = dir.path().canonicalize().unwrap();
        let out = parse_args(&argv(&["."]), Some(canonical_cwd.clone()));
        match out {
            CliWorkspace::Path(p) => assert_eq!(p, canonical_cwd),
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn relative_path_is_resolved_against_cwd() {
        let parent = TempDir::new().unwrap();
        let child = parent.path().join("sub");
        fs::create_dir(&child).unwrap();
        let cwd = Some(parent.path().canonicalize().unwrap());
        let out = parse_args(&argv(&["sub"]), cwd);
        match out {
            CliWorkspace::Path(p) => {
                assert!(p.is_dir());
                assert!(p.ends_with("sub"));
            }
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn nonexistent_path_is_invalid() {
        let out = parse_args(
            &argv(&["C:/definitely/not/a/real/path/for/this/test"]),
            None,
        );
        assert!(matches!(out, CliWorkspace::Invalid { .. }));
    }

    #[test]
    fn path_that_points_at_a_file_is_invalid() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "hi").unwrap();
        let out = parse_args(&argv(&[file.to_str().unwrap()]), None);
        match out {
            CliWorkspace::Invalid { reason, .. } => {
                assert!(reason.contains("not a directory"), "got: {}", reason);
            }
            other => panic!("expected Invalid, got {:?}", other),
        }
    }

    #[test]
    fn dash_path_without_value_is_invalid() {
        let out = parse_args(&argv(&["--path"]), None);
        match out {
            CliWorkspace::Invalid { reason, .. } => {
                assert!(reason.contains("requires a value"), "got: {}", reason);
            }
            other => panic!("expected Invalid, got {:?}", other),
        }
    }

    #[test]
    fn empty_path_is_invalid() {
        let out = parse_args(&argv(&["--path", "   "]), None);
        match out {
            CliWorkspace::Invalid { reason, .. } => {
                assert!(reason.contains("empty"), "got: {}", reason);
            }
            other => panic!("expected Invalid, got {:?}", other),
        }
    }

    #[test]
    fn unknown_flags_before_path_are_ignored() {
        // A future Tauri / webview flag like `--remote-debugging-port=9222`
        // must not be treated as the workspace path.
        let dir = TempDir::new().unwrap();
        let out = parse_args(
            &argv(&[
                "--remote-debugging-port=9222",
                "--path",
                dir.path().to_str().unwrap(),
            ]),
            None,
        );
        match out {
            CliWorkspace::Path(p) => assert!(p.is_dir()),
            other => panic!("expected Path, got {:?}", other),
        }
    }

    #[test]
    fn double_dash_escapes_flag_like_path() {
        // `TrixtyIDE -- --path` should treat `--path` as a literal
        // positional. It will fail validation (no such dir), but we're
        // checking that flag parsing stopped at `--`.
        let out = parse_args(&argv(&["--", "--path"]), None);
        assert!(matches!(out, CliWorkspace::Invalid { .. }));
    }
}
