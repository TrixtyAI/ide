//! `tide` — terminal launcher for the Trixty IDE desktop app.
//!
//! Mirrors the VS Code `code` / JetBrains `idea` pattern: a tiny binary the
//! user drops on `$PATH` that locates the installed IDE and spawns it with
//! the folder the user pointed at.
//!
//! ```text
//! $ tide .                 # open the current directory
//! $ tide c:\test           # open an absolute path
//! $ tide ../some-project   # open a relative path
//! ```
//!
//! Design goals, in order of priority:
//!
//! 1. **Zero friction on success.** If the main binary is on `$PATH`, or
//!    right next to `tide` in the install directory, we find it without the
//!    user configuring anything.
//! 2. **Actionable errors on failure.** If we can't find `TrixtyIDE`, we
//!    print an error message with concrete paths we tried, so the user
//!    knows where to copy the binary or how to set the env override.
//! 3. **Cross-platform without `cfg` noise.** The candidate list builder
//!    below uses platform `cfg`s, but the spawn logic is a single code
//!    path that works the same on every OS.
//!
//! The launcher does NOT re-parse `--path` / `-p`; it forwards argv to the
//! main binary verbatim so anything the main binary's `cli.rs` understands
//! (positional, `--path`, `--path=`, escaping via `--`) keeps working.

use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, ExitCode};

/// Environment variable the user can set to bypass path discovery entirely,
/// e.g. when they're running from a custom install location or when the
/// binary is shipped under a non-standard name. Highest-priority input.
const ENV_OVERRIDE: &str = "TRIXTY_IDE_PATH";

fn main() -> ExitCode {
    let argv: Vec<OsString> = env::args_os().collect();
    // Skip argv[0]; everything else is forwarded.
    let forward: Vec<OsString> = argv.into_iter().skip(1).collect();

    let main_binary = match locate_main_binary() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("tide: {}", e);
            return ExitCode::from(127);
        }
    };

    // Detach from the parent terminal so the IDE keeps running after the
    // user closes / reuses the shell. On Windows we rely on the subsystem
    // flag baked into the main binary (`#![cfg_attr(..., windows_subsystem
    // = "windows")]`) to keep the spawned process consoleless; on Unix a
    // plain fork-exec via `Command::spawn` already gives us that, because
    // the child inherits the controlling terminal but doesn't block the
    // parent.
    match Command::new(&main_binary).args(&forward).spawn() {
        Ok(_child) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("tide: failed to spawn {}: {}", main_binary.display(), e);
            ExitCode::from(126)
        }
    }
}

/// Searches in priority order:
///
/// 1. `$TRIXTY_IDE_PATH` (explicit override).
/// 2. A sibling binary next to `tide` itself — the common "the user added
///    the install directory to PATH" case on Windows, and the "they
///    symlinked both binaries into `/usr/local/bin`" case on Unix.
/// 3. `TrixtyIDE` on `$PATH`, which `Command::new` would try anyway, but
///    we probe it up-front so our error message can list the fallback
///    paths that failed rather than pretending we only tried one thing.
/// 4. Platform-specific default install locations.
fn locate_main_binary() -> Result<PathBuf, String> {
    // 1. Environment override wins. We don't validate `is_file()` here so
    //    a user debugging with a symlink or a shim still works — the
    //    eventual `Command::spawn` will surface the real error.
    if let Some(v) = env::var_os(ENV_OVERRIDE) {
        let p = PathBuf::from(v);
        if !p.as_os_str().is_empty() {
            return Ok(p);
        }
    }

    let mut attempts: Vec<PathBuf> = Vec::new();

    // 2. Sibling of the running `tide` binary.
    if let Ok(tide_path) = env::current_exe() {
        if let Some(dir) = tide_path.parent() {
            for name in main_binary_names() {
                let candidate = dir.join(name);
                attempts.push(candidate.clone());
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    // 3. `$PATH`. We walk it manually so the error message can surface the
    //    specific directories we searched if nothing matches.
    if let Some(path_env) = env::var_os("PATH") {
        for dir in env::split_paths(&path_env) {
            for name in main_binary_names() {
                let candidate = dir.join(name);
                attempts.push(candidate.clone());
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    // 4. Platform-specific install defaults.
    for candidate in default_install_paths() {
        attempts.push(candidate.clone());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let tried = attempts
        .iter()
        .take(10) // cap so the error stays readable
        .map(|p| format!("  - {}", p.display()))
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!(
        "could not find the TrixtyIDE binary. Set the {} environment \
         variable to its full path, or place it on $PATH. \
         Tried (first {} candidates):\n{}",
        ENV_OVERRIDE,
        attempts.len().min(10),
        tried
    ))
}

/// The names we look for. Windows bundles ship with an `.exe` suffix; on
/// Unix we support both the canonical `TrixtyIDE` casing and a lowercase
/// `trixty-ide` some Linux package maintainers prefer.
fn main_binary_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["TrixtyIDE.exe"]
    }
    #[cfg(target_os = "macos")]
    {
        // On macOS the actual Mach-O lives inside the `.app` bundle. The
        // platform-install-paths fallback handles that; this list covers a
        // plain sibling binary on `$PATH`.
        &["TrixtyIDE", "trixty-ide"]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        &["TrixtyIDE", "trixty-ide"]
    }
}

/// OS-specific default install paths. These are the ones the Tauri
/// bundler writes to by default for each target; a follow-up PR that ships
/// an installer will keep these in sync.
fn default_install_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Tauri's NSIS/MSI installers land in Program Files by default.
        // Check both the 64-bit and 32-bit Program Files views so the
        // launcher still works on a 32-bit build installed on 64-bit
        // Windows (rare but cheap to cover).
        for env_var in [
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "LOCALAPPDATA",
        ] {
            if let Some(base) = env::var_os(env_var) {
                let base = PathBuf::from(base);
                out.push(base.join("TrixtyIDE").join("TrixtyIDE.exe"));
                out.push(base.join("Trixty IDE").join("TrixtyIDE.exe"));
                // `LOCALAPPDATA\Programs\TrixtyIDE\TrixtyIDE.exe` is the
                // layout `winget` / user-scope MSI installs tend to use.
                out.push(
                    base.join("Programs")
                        .join("TrixtyIDE")
                        .join("TrixtyIDE.exe"),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Standard Applications folders plus user-scoped.
        let app_paths = [
            "/Applications/TrixtyIDE.app/Contents/MacOS/TrixtyIDE",
            "/Applications/Trixty IDE.app/Contents/MacOS/TrixtyIDE",
        ];
        for p in app_paths {
            out.push(PathBuf::from(p));
        }
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            out.push(
                home.join("Applications")
                    .join("TrixtyIDE.app")
                    .join("Contents")
                    .join("MacOS")
                    .join("TrixtyIDE"),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Tauri's AppImage + .deb/.rpm ship into these locations. The
        // AppImage run-path is the self-extracting binary itself; we rely
        // on the user symlinking or adding its containing directory to
        // `$PATH`, which the step-3 walk above already covers.
        let linux_paths = [
            "/usr/bin/TrixtyIDE",
            "/usr/bin/trixty-ide",
            "/usr/local/bin/TrixtyIDE",
            "/usr/local/bin/trixty-ide",
            "/opt/TrixtyIDE/TrixtyIDE",
            "/opt/trixty-ide/trixty-ide",
        ];
        for p in linux_paths {
            out.push(PathBuf::from(p));
        }
    }

    out
}
