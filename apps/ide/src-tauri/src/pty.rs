use log::error;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

/// Returns the length in bytes of the longest prefix of `buf` that should be
/// emitted right now. Callers are expected to emit `buf[..split]` through
/// `from_utf8_lossy` and retain `buf[split..]` as leftover to prepend to the
/// next read.
///
/// The only case we hold bytes back is a *truncated* UTF-8 sequence at the
/// very end of `buf` (where `str::from_utf8` reports `error_len() == None`):
/// the next read may complete it into a valid codepoint. If the buffer
/// contains invalid UTF-8 *anywhere else* we return `buf.len()` and let the
/// caller emit the whole thing — `from_utf8_lossy` replaces the bad bytes
/// with `U+FFFD` and valid bytes that follow the invalid byte in the same
/// chunk are not delayed to the next read.
/// Describes which shell binary to launch on Unix and whether to pass the
/// `-l` (login) flag. Populated by [`select_unix_shell`].
#[derive(Debug, PartialEq, Eq)]
struct UnixShell {
    path: String,
    /// `true` if the shell is a known POSIX-ish login shell that understands
    /// `-l`. Unknown shells are launched without the flag — passing `-l` to
    /// a shell that does not accept it would crash the terminal at startup.
    login_arg: bool,
}

/// Shells that accept `-l` to run as a login shell, loading user rc/profile
/// files. `sh` is included because many systems symlink `/bin/sh` to one of
/// these; `dash` and `ksh` are listed for minimal distros.
const KNOWN_LOGIN_SHELLS: &[&str] = &["bash", "zsh", "fish", "ksh", "dash", "sh"];

/// Picks the shell to launch on Unix. Tries in order:
/// 1. `$SHELL` if the binary exists.
/// 2. `/bin/bash` if it exists.
/// 3. `/bin/sh` as the last resort (POSIX-mandated).
///
/// Pure over `env` / `exists` for testability: unit tests inject stubs and
/// the production call site wires them to `std::env::var` and
/// `Path::exists`.
fn select_unix_shell<E, X>(env: E, exists: X) -> UnixShell
where
    E: Fn(&str) -> Option<String>,
    X: Fn(&str) -> bool,
{
    if let Some(path) = env("SHELL") {
        if !path.is_empty() && exists(&path) {
            let name = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let login_arg = KNOWN_LOGIN_SHELLS.contains(&name);
            return UnixShell { path, login_arg };
        }
    }
    if exists("/bin/bash") {
        return UnixShell {
            path: "/bin/bash".to_string(),
            login_arg: true,
        };
    }
    // POSIX mandates `/bin/sh`; if even that is gone the PTY spawn will
    // fail below and `spawn_pty` surfaces the error to the caller.
    UnixShell {
        path: "/bin/sh".to_string(),
        login_arg: false,
    }
}

fn split_utf8_safely(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => buf.len(),
    }
}

/// Batching thresholds for the emitter thread. A busy shell (`cargo build`,
/// `npm install`, recursive `find`) used to generate tens of thousands of
/// `pty-output` events per second — one per 4 KiB PTY read — and each event
/// paid the full Tauri IPC + JSON serialization cost. Coalescing reads into
/// short time windows collapses that into a handful of larger events with no
/// perceptible latency cost.
///
/// - `EMIT_BUFFER_BYTES` bounds a single emit so burst output still streams
///   through in roughly screen-sized chunks instead of piling up into
///   multi-megabyte payloads on `npm install` style floods.
/// - `EMIT_INTERVAL` caps the user-visible latency when output trickles in
///   (a shell prompt after an idle pause, the next `echo` from a slow
///   script). The reader blocks inside `read()` so without a timeout on the
///   emitter side, trailing bytes would sit in the buffer until the *next*
///   read returned.
const EMIT_BUFFER_BYTES: usize = 16 * 1024;
const EMIT_INTERVAL: Duration = Duration::from_millis(10);

/// A single live PTY session. The `PtySessions` map holds one per `session_id`
/// so multiple terminal tabs can run concurrently without their output
/// crossing over.
pub struct PtyHandle {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    /// Set by `kill_pty` (or the session-replacement path inside
    /// `spawn_pty`) to tell the reader/emitter threads they must stop
    /// forwarding events. The threads check this flag so bytes still in
    /// flight from a previous shell cannot land in the tab of the next
    /// one — critical now that multiple tabs share a single `pty-output`
    /// event channel distinguished only by `session_id`.
    shutdown: Arc<AtomicBool>,
    /// Owned handles to the reader + emitter threads. Held in `Option`s so
    /// `shutdown_and_join` can take them out (joining consumes the handle)
    /// without needing `&mut self`.
    reader_handle: Option<JoinHandle<()>>,
    emitter_handle: Option<JoinHandle<()>>,
}

impl PtyHandle {
    /// Flags the reader for shutdown and waits for both worker threads to
    /// finish. Called by `spawn_pty` (when replacing an existing session
    /// id), `kill_pty` (when the user closes a tab), and the per-session
    /// teardown in `kill_all_ptys`.
    ///
    /// Callers always go through this path; there is no implicit
    /// `Drop`-based teardown, because `Drop` would have to run on
    /// `&mut self` and could not drop `master` before `handle.join()`,
    /// which would deadlock (the reader is blocked inside `read`, and
    /// only dropping the master wakes it up).
    fn shutdown_and_join(self) {
        self.shutdown.store(true, Ordering::Release);
        // Destructure so we can drop `master` *before* joining. Dropping
        // the master closes the native PTY handle and unblocks the
        // reader's pending `read` call with `Ok(0)` / `Err` on all
        // supported platforms; the reader thread exits, its `Sender`
        // drops, the emitter's `recv_timeout` returns `Disconnected`, and
        // both joins return promptly.
        let PtyHandle {
            master,
            reader_handle,
            emitter_handle,
            ..
        } = self;
        drop(master);
        if let Some(handle) = reader_handle {
            let _ = handle.join();
        }
        if let Some(handle) = emitter_handle {
            let _ = handle.join();
        }
    }
}

/// Tauri-managed state: one `PtyHandle` per live session, keyed on the
/// frontend-supplied `session_id` (currently a UUID generated per tab).
pub type PtySessions = Arc<Mutex<HashMap<String, PtyHandle>>>;

pub fn new_pty_sessions() -> PtySessions {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Payload of the `pty-output` event. Every byte stream is tagged with the
/// originating `session_id` so the frontend can route output to the right
/// xterm instance without a separate event channel per tab.
#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
    data: String,
}

/// Strips ANSI escape sequences that have no legitimate reason to travel
/// *from* the UI into the PTY. These sequences are meant for shell-to-UI
/// signalling; if the frontend forwards them to the shell (because the user
/// pasted untrusted output, an AI reply, or a README into the terminal),
/// an attacker can hijack the clipboard (OSC 52), retitle the window
/// (OSC 0/1/2), point the host at a bogus working directory (OSC 7),
/// smuggle data through DCS/APC/PM/SOS payloads, or spoof link targets
/// via OSC 8.
///
/// Stripped, starting at either the 7-bit `ESC` (0x1B) + introducer form
/// or the corresponding single-character C1 control code point in the
/// input `&str` (for example, OSC as `U+009D`, encoded in UTF-8 as
/// `0xC2 0x9D`), and consuming everything up to a String Terminator
/// (`ST` = `U+009C` or `ESC \\`, plus the BEL shorthand `U+0007` for OSC):
/// - OSC (`ESC ]` / `U+009D`)
/// - DCS (`ESC P` / `U+0090`)
/// - SOS (`ESC X` / `U+0098`)
/// - PM  (`ESC ^` / `U+009E`)
/// - APC (`ESC _` / `U+009F`)
///
/// Unterminated sequences are dropped through end-of-input so half a
/// payload cannot sneak through a later `write_to_pty` call.
///
/// CSI (`ESC [`) is intentionally preserved: xterm.js emits it for
/// bracketed paste (`CSI 200 ~` / `CSI 201 ~`), arrow keys, mouse events,
/// and other normal terminal input the user legitimately produces.
fn sanitize_pty_input(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        // ESC-introduced sequences. We peek first so a bare ESC (the plain
        // Escape key — needed by vim, readline vi-mode, etc.) is preserved.
        if c == '\x1b' {
            if let Some(&next) = chars.peek() {
                if matches!(next, ']' | 'P' | 'X' | '^' | '_') {
                    chars.next(); // consume the introducer
                    skip_to_string_terminator(&mut chars, next == ']');
                    continue;
                }
            }
        }
        // C1 control code points for OSC/DCS/SOS/PM/APC. Iterating by
        // `char` (not bytes) is essential: `U+0098` appears as the UTF-8
        // byte sequence `0xC2 0x98`, but UTF-8 continuation bytes inside
        // legitimate code points (e.g. `😀` contains 0x98) must not be
        // mistaken for a C1 introducer.
        if matches!(c, '\u{90}' | '\u{98}' | '\u{9d}' | '\u{9e}' | '\u{9f}') {
            skip_to_string_terminator(&mut chars, c == '\u{9d}');
            continue;
        }
        out.push(c);
    }
    out
}

/// Consumes the iterator through a String Terminator. If `accept_bel` is
/// true, a bare `BEL` (U+0007) also ends the sequence (OSC uses BEL as a
/// shorthand terminator).
///
/// If no terminator is found the iterator is drained — an unterminated
/// control sequence is treated as "drop everything through end of input"
/// so a split payload cannot sneak through a later call.
fn skip_to_string_terminator<I: Iterator<Item = char>>(
    chars: &mut std::iter::Peekable<I>,
    accept_bel: bool,
) {
    while let Some(c) = chars.next() {
        if accept_bel && c == '\x07' {
            return;
        }
        if c == '\u{9c}' {
            return;
        }
        if c == '\x1b' && chars.peek() == Some(&'\\') {
            chars.next();
            return;
        }
    }
}

/// Flushes the UTF-8-safe prefix of `combined` to the frontend as a single
/// `pty-output` event, tagged with `session_id` so the renderer can route
/// it to the correct xterm instance. Returns `true` if a flush actually
/// went over the bridge so callers can update their timestamp.
///
/// Bytes that form a truncated UTF-8 codepoint at the very tail stay in
/// `combined` for the next flush — same leftover-aware decoding the
/// per-read loop used before this refactor. When `shutdown` is already
/// set we drop the emit silently so a killed session cannot leak stale
/// output into another tab sharing the same event channel.
fn flush_combined<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    combined: &mut Vec<u8>,
    shutdown: &AtomicBool,
) -> bool {
    if combined.is_empty() {
        return false;
    }
    let split = split_utf8_safely(combined);
    if split == 0 {
        return false;
    }
    if shutdown.load(Ordering::Acquire) {
        combined.drain(..split);
        return false;
    }
    let chunk = String::from_utf8_lossy(&combined[..split]).into_owned();
    let _ = app.emit(
        "pty-output",
        PtyOutputPayload {
            session_id: session_id.to_string(),
            data: chunk,
        },
    );
    combined.drain(..split);
    true
}

#[tauri::command]
pub fn spawn_pty<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PtySessions>,
    #[allow(non_snake_case)] sessionId: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let session_id = sessionId;
    if session_id.is_empty() {
        return Err("session_id must not be empty".to_string());
    }

    // If a session with this id already exists, take it out and tear it
    // down before creating the replacement. This path runs when a tab
    // remounts (React strict mode or a fast reload) and re-invokes spawn
    // with the same id. Holding the map lock across `shutdown_and_join`
    // would serialize the join with every other PTY command and could
    // deadlock if the reader was trying to re-enter via `emit`; taking
    // ownership and dropping the guard first avoids that.
    let old = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.remove(&session_id)
    };
    if let Some(old_handle) = old {
        old_handle.shutdown_and_join();
    }

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
        // Respect the user's login shell (`$SHELL`) when present and
        // executable; fall back to `/bin/bash`, then `/bin/sh`. Hardcoding
        // `bash` used to break on macOS Catalina+ (default is zsh) and any
        // minimal Linux image that ships without bash.
        let shell = select_unix_shell(
            |k| std::env::var(k).ok(),
            |p| std::path::Path::new(p).exists(),
        );
        let mut c = CommandBuilder::new(&shell.path);
        if shell.login_arg {
            c.arg("-l");
        }
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

    // Clamp the terminal dimensions before handing them to the native
    // PTY. Accepting anything up to `u16::MAX` (65535) lets a compromised
    // frontend DoS the backend by asking portable_pty for a giant
    // allocation or a malformed size that the underlying OS handle
    // rejects with a panic. Real terminals never exceed a few hundred
    // cells in either direction; 1000 is generous.
    const PTY_MAX_DIM: u16 = 1000;
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24).min(PTY_MAX_DIM),
            cols: cols.unwrap_or(80).min(PTY_MAX_DIM),
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

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_for_emitter = shutdown.clone();
    let session_id_for_emitter = session_id.clone();

    // Two-thread architecture:
    //
    // - Reader thread: blocks inside `reader.read(...)` and forwards each
    //   chunk to the emitter via a channel. Keeping this thread narrow
    //   means the emitter can apply a timeout (`recv_timeout`) that the
    //   blocking read itself does not support on portable_pty.
    //
    // - Emitter thread: batches incoming chunks into a single `pty-output`
    //   event every `EMIT_INTERVAL` or once `EMIT_BUFFER_BYTES` accumulate,
    //   whichever comes first. Preserves the UTF-8 leftover handling from
    //   the previous single-thread implementation via `split_utf8_safely`,
    //   so a multi-byte codepoint that straddles a read boundary still
    //   arrives intact. Every emit is tagged with `session_id` so the
    //   renderer can dispatch to the right xterm tab.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    let reader_handle = thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buffer[..n].to_vec()).is_err() {
                        // Emitter has gone away (shutdown) — no point
                        // keeping the reader thread running.
                        break;
                    }
                }
                Err(e) => {
                    error!("PTY reader error: {}", e);
                    break;
                }
            }
        }
        // Dropping `tx` here closes the channel. The emitter sees
        // `RecvTimeoutError::Disconnected` on its next `recv_timeout` and
        // performs a final flush before exiting.
    });

    let emitter_handle = thread::spawn(move || {
        // Reused across iterations so a busy shell does not force one
        // allocation per flush. Sized to comfortably hold one batch plus a
        // small tail of UTF-8 leftover without reallocating.
        let mut combined: Vec<u8> = Vec::with_capacity(EMIT_BUFFER_BYTES + 4);
        loop {
            match rx.recv_timeout(EMIT_INTERVAL) {
                Ok(bytes) => {
                    combined.extend_from_slice(&bytes);
                    if combined.len() >= EMIT_BUFFER_BYTES {
                        flush_combined(
                            &app,
                            &session_id_for_emitter,
                            &mut combined,
                            &shutdown_for_emitter,
                        );
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // No new data for `EMIT_INTERVAL`; flush whatever is
                    // buffered so trickling output (e.g. a shell prompt
                    // after an idle pause) surfaces promptly.
                    flush_combined(
                        &app,
                        &session_id_for_emitter,
                        &mut combined,
                        &shutdown_for_emitter,
                    );
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // Reader dropped its `Sender` — either EOF, error, or
                    // shutdown. One final flush, including any trailing
                    // truncated UTF-8 bytes (lossy at worst), so users
                    // still see the last prompt/output byte-for-byte.
                    flush_combined(
                        &app,
                        &session_id_for_emitter,
                        &mut combined,
                        &shutdown_for_emitter,
                    );
                    if !combined.is_empty() && !shutdown_for_emitter.load(Ordering::Acquire) {
                        let tail = String::from_utf8_lossy(&combined).into_owned();
                        let _ = app.emit(
                            "pty-output",
                            PtyOutputPayload {
                                session_id: session_id_for_emitter.clone(),
                                data: tail,
                            },
                        );
                    }
                    break;
                }
            }
        }
    });

    let handle = PtyHandle {
        writer: Arc::new(Mutex::new(writer)),
        master: pair.master,
        shutdown,
        reader_handle: Some(reader_handle),
        emitter_handle: Some(emitter_handle),
    };

    state
        .lock()
        .map_err(|e| {
            let err = e.to_string();
            error!("PTY state lock failed: {}", err);
            err
        })?
        .insert(session_id, handle);

    Ok(())
}

#[tauri::command]
pub fn write_to_pty(
    #[allow(non_snake_case)] sessionId: String,
    data: String,
    state: tauri::State<'_, PtySessions>,
) -> Result<(), String> {
    let sanitized = sanitize_pty_input(&data);
    // Clone the `Arc<Mutex<writer>>` out with the map lock held only
    // briefly, then release it before doing the I/O. Holding the outer
    // lock across a `write_all` would serialize every PTY command against
    // a single tab's flush latency.
    let writer = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .get(&sessionId)
            .ok_or_else(|| format!("No PTY session with id {}", sessionId))?
            .writer
            .clone()
    };
    let mut writer = writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(sanitized.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    #[allow(non_snake_case)] sessionId: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, PtySessions>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let handle = guard
        .get(&sessionId)
        .ok_or_else(|| format!("No PTY session with id {}", sessionId))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Kills the PTY session identified by `sessionId` (if any). Flags the
/// reader thread for shutdown, drops the master to unblock it, and joins
/// both worker threads before returning so `spawn_pty` can safely reuse
/// the id and so no stale `pty-output` event can leak into a freshly
/// opened tab. A missing id is treated as a no-op.
#[tauri::command]
pub fn kill_pty(
    #[allow(non_snake_case)] sessionId: String,
    state: tauri::State<'_, PtySessions>,
) -> Result<(), String> {
    // Take the handle out of the map *before* tearing it down. Joining
    // inside the lock would block every other PTY command and could
    // deadlock on a reader that re-enters via `emit`.
    let taken = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.remove(&sessionId)
    };
    if let Some(handle) = taken {
        handle.shutdown_and_join();
    }
    Ok(())
}

#[cfg(test)]
mod shell_selection_tests {
    use super::{select_unix_shell, UnixShell};

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn uses_shell_env_when_set_and_exists() {
        let shell = select_unix_shell(
            |k| {
                if k == "SHELL" {
                    Some("/usr/bin/zsh".to_string())
                } else {
                    None
                }
            },
            |p| p == "/usr/bin/zsh",
        );
        assert_eq!(
            shell,
            UnixShell {
                path: "/usr/bin/zsh".to_string(),
                login_arg: true,
            }
        );
    }

    #[test]
    fn falls_back_to_bash_when_shell_env_unset() {
        let shell = select_unix_shell(no_env, |p| p == "/bin/bash");
        assert_eq!(
            shell,
            UnixShell {
                path: "/bin/bash".to_string(),
                login_arg: true,
            }
        );
    }

    #[test]
    fn falls_back_to_bash_when_shell_env_points_at_missing_binary() {
        let shell = select_unix_shell(
            |k| {
                if k == "SHELL" {
                    Some("/usr/local/bin/missing".to_string())
                } else {
                    None
                }
            },
            |p| p == "/bin/bash",
        );
        assert_eq!(shell.path, "/bin/bash");
    }

    #[test]
    fn final_fallback_is_posix_sh_without_login_flag() {
        // No $SHELL, no /bin/bash — a minimal container image that only
        // ships busybox, for example. Must not panic; must spawn *something*
        // that has a chance of working.
        let shell = select_unix_shell(no_env, |_| false);
        assert_eq!(
            shell,
            UnixShell {
                path: "/bin/sh".to_string(),
                login_arg: false,
            }
        );
    }

    #[test]
    fn recognises_common_login_shells() {
        for name in ["bash", "zsh", "fish", "ksh", "dash", "sh"] {
            let path = format!("/usr/bin/{name}");
            let path_clone = path.clone();
            let shell = select_unix_shell(
                |k| {
                    if k == "SHELL" {
                        Some(path_clone.clone())
                    } else {
                        None
                    }
                },
                |p| p == path,
            );
            assert!(shell.login_arg, "{name} should accept -l");
            assert_eq!(shell.path, path);
        }
    }

    #[test]
    fn unknown_shell_skips_login_flag() {
        // Any shell we do not recognize gets launched without `-l` because
        // passing an unknown flag would crash the terminal at startup.
        let shell = select_unix_shell(
            |k| {
                if k == "SHELL" {
                    Some("/opt/weirdshell/bin/ws".to_string())
                } else {
                    None
                }
            },
            |p| p == "/opt/weirdshell/bin/ws",
        );
        assert_eq!(shell.path, "/opt/weirdshell/bin/ws");
        assert!(!shell.login_arg);
    }

    #[test]
    fn empty_shell_env_falls_through_to_fallback() {
        // Some environments set `SHELL=` literally; treat it the same as
        // unset so we do not try to spawn an empty-path binary.
        let shell = select_unix_shell(
            |k| {
                if k == "SHELL" {
                    Some(String::new())
                } else {
                    None
                }
            },
            |p| p == "/bin/bash",
        );
        assert_eq!(shell.path, "/bin/bash");
    }
}

#[cfg(test)]
mod payload_tests {
    use super::PtyOutputPayload;

    /// Contract test: the frontend listens to `pty-output` and filters on
    /// `sessionId` (camelCase). Renaming the Rust field without updating the
    /// renamed serde attribute would silently break every tab's output
    /// routing, so pin the on-the-wire shape here.
    #[test]
    fn payload_serializes_with_camel_case_session_id() {
        let payload = PtyOutputPayload {
            session_id: "abc-123".to_string(),
            data: "hello".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("serialize payload");
        assert!(
            json.contains("\"sessionId\":\"abc-123\""),
            "expected camelCase sessionId in {json}"
        );
        assert!(
            !json.contains("\"session_id\""),
            "snake_case field leaked: {json}"
        );
        assert!(json.contains("\"data\":\"hello\""), "data missing: {json}");
    }

    #[test]
    fn new_pty_sessions_starts_empty() {
        let sessions = super::new_pty_sessions();
        let guard = sessions.lock().expect("lock sessions");
        assert!(guard.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_pty_input, split_utf8_safely};

    /// Walks `bytes` in fixed `chunk` sized reads, feeding each slice through
    /// the same leftover-aware decoder the PTY thread uses, and returns the
    /// concatenated emitted string. Mirrors the reader loop so tests exercise
    /// the full assembly path, not just the split helper in isolation.
    fn drain(bytes: &[u8], chunk: usize) -> String {
        let mut out = String::new();
        let mut combined: Vec<u8> = Vec::new();
        for window in bytes.chunks(chunk) {
            combined.extend_from_slice(window);
            let split = split_utf8_safely(&combined);
            if split > 0 {
                out.push_str(&String::from_utf8_lossy(&combined[..split]));
                combined.drain(..split);
            }
        }
        if !combined.is_empty() {
            out.push_str(&String::from_utf8_lossy(&combined));
        }
        out
    }

    #[test]
    fn pure_ascii_passes_through_any_chunking() {
        let input = b"hello world from the pty";
        for chunk in 1..=input.len() {
            assert_eq!(drain(input, chunk), "hello world from the pty");
        }
    }

    #[test]
    fn four_byte_codepoint_split_across_reads() {
        // U+1F600 "😀" encodes to F0 9F 98 80 — a four-byte sequence.
        let smiley = "😀";
        let bytes = smiley.as_bytes();
        assert_eq!(bytes.len(), 4);

        // Any split 1..=3 would have been substituted with U+FFFD by the
        // previous naive `from_utf8_lossy(&buffer[..n])` call.
        for boundary in 1..=3 {
            let mut input = b"pre-".to_vec();
            input.extend_from_slice(&bytes[..boundary]);
            // Simulate the read coming back in two chunks exactly at `boundary`
            // inside the codepoint.
            input.extend_from_slice(&bytes[boundary..]);
            input.extend_from_slice(b"-post");

            // Feed at a chunk size that guarantees the boundary lands inside
            // the emoji.
            let chunk = "pre-".len() + boundary;
            assert_eq!(drain(&input, chunk), "pre-😀-post");
        }
    }

    #[test]
    fn multiple_multibyte_codepoints_split_repeatedly() {
        // Mix 2-, 3- and 4-byte sequences, and force 1-byte reads so every
        // boundary is mid-codepoint.
        let input = "café — 日本語 — 😀🚀".as_bytes();
        assert_eq!(drain(input, 1), "café — 日本語 — 😀🚀");
    }

    #[test]
    fn invalid_bytes_become_replacement_and_do_not_stall() {
        // 0xFF is never legal in UTF-8. We want the decoder to replace it
        // with U+FFFD and keep making forward progress instead of holding
        // it back as "maybe the next read completes it".
        let mut input = b"ok-".to_vec();
        input.push(0xFF);
        input.extend_from_slice(b"-more");
        let out = drain(&input, 4);
        assert!(out.starts_with("ok-"));
        assert!(out.ends_with("-more"));
        assert!(out.contains('\u{FFFD}'));
    }

    #[test]
    fn invalid_byte_mid_chunk_does_not_delay_valid_trailing_bytes() {
        // Regression guard for the "hold everything after invalid as leftover"
        // bug: when a read contains `[valid_prefix, invalid_byte, valid_suffix]`
        // we must emit all of it in the same iteration (the valid suffix
        // shouldn't be withheld until the next read). We simulate a single
        // read by giving `drain` a chunk size larger than the whole input.
        let mut input = b"before-".to_vec();
        input.push(0xFF);
        input.extend_from_slice(b"-after");
        // Chunk size = input.len() means drain hits the last iteration with
        // the full buffer present; if the decoder withheld "-after" it would
        // only surface in the final post-loop flush, but the emit-before-
        // flush assertion still catches it.
        let out = drain(&input, input.len());
        assert_eq!(
            out.chars().filter(|&c| c == '\u{FFFD}').count(),
            1,
            "exactly one replacement char expected: {out:?}"
        );
        assert!(out.starts_with("before-"));
        assert!(out.ends_with("-after"));
    }

    #[test]
    fn empty_input_emits_nothing() {
        assert_eq!(drain(b"", 1), "");
        assert_eq!(drain(b"", 4096), "");
    }

    #[test]
    fn truncated_tail_is_flushed_on_close() {
        // Stream ends mid-codepoint (the child crashed or we hit EOF). The
        // incomplete bytes should still surface, just lossily — better than
        // silently swallowing the tail.
        let mut input = b"done ".to_vec();
        input.extend_from_slice(&"😀".as_bytes()[..2]);
        let out = drain(&input, 8);
        assert!(out.starts_with("done "));
        assert!(out.contains('\u{FFFD}'));
    }

    #[test]
    fn passes_through_plain_text_and_newlines() {
        let input = "ls -la\nwhoami\r\n";
        assert_eq!(sanitize_pty_input(input), input);
    }

    #[test]
    fn passes_through_csi_sequences_used_by_xtermjs() {
        // Arrow up, bracketed paste start/end, color reset — all CSI, all
        // expected from normal terminal input.
        let input = "\x1b[A\x1b[200~hello\x1b[201~\x1b[0m";
        assert_eq!(sanitize_pty_input(input), input);
    }

    #[test]
    fn strips_osc_52_clipboard_injection_bel_terminated() {
        // OSC 52 is the classic "paste-to-clipboard" attack vector.
        let input = "safe\x1b]52;c;aGVsbG8=\x07after";
        assert_eq!(sanitize_pty_input(input), "safeafter");
    }

    #[test]
    fn strips_osc_st_terminated() {
        // ST form (ESC \) must also terminate.
        let input = "x\x1b]0;evil-title\x1b\\y";
        assert_eq!(sanitize_pty_input(input), "xy");
    }

    #[test]
    fn strips_dcs_apc_pm_sos() {
        let input = "a\x1bPevil\x1b\\b\x1b_apc\x1b\\c\x1b^pm\x1b\\d\x1bXsos\x1b\\e";
        assert_eq!(sanitize_pty_input(input), "abcde");
    }

    #[test]
    fn drops_unterminated_osc_through_end_of_input() {
        // No ST / BEL ever arrives — everything from the OSC introducer on
        // must be discarded so a split payload cannot sneak through.
        let input = "start\x1b]52;c;dGFpbA==";
        assert_eq!(sanitize_pty_input(input), "start");
    }

    #[test]
    fn strips_8bit_c1_equivalents() {
        // 0x9D = OSC, 0x9C = ST. These 8-bit forms must be handled too.
        let input = "ok\u{9d}1;alert\u{9c}done";
        assert_eq!(sanitize_pty_input(input), "okdone");
    }

    #[test]
    fn handles_back_to_back_sequences() {
        let input = "pre\x1b]0;a\x07\x1b]52;c;Yg==\x07post";
        assert_eq!(sanitize_pty_input(input), "prepost");
    }

    #[test]
    fn preserves_lone_esc_that_is_not_an_attack_introducer() {
        // Bare ESC with nothing after is just the Escape key — leave it so
        // shells (vim, readline vi-mode) still see it.
        let input = "\x1b";
        assert_eq!(sanitize_pty_input(input), "\x1b");
    }

    #[test]
    fn preserves_utf8_multibyte_content() {
        let input = "café 日本 😀";
        assert_eq!(sanitize_pty_input(input), input);
    }
}
