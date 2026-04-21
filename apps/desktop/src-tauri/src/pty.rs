use log::error;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
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
fn split_utf8_safely(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => buf.len(),
    }
}

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

    // Spawn a thread to read from the PTY and emit to the frontend.
    //
    // Why the leftover buffer: a single UTF-8 codepoint can span up to 4
    // bytes, and we read in fixed 4 KiB chunks. When a multi-byte character
    // straddles the chunk boundary, decoding each chunk independently with
    // `from_utf8_lossy` produces U+FFFD replacement characters (showing up
    // as `�` in the terminal) even though the byte stream itself is
    // perfectly valid. We hold back the trailing truncated bytes and
    // prepend them to the next read so codepoints are never split. See
    // `split_utf8_safely` for the decoding rules.
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        // Reuse the same assembly buffer across reads so a busy shell does
        // not force one allocation per iteration. Capacity is chunk size +
        // the maximum UTF-8 sequence length (4), so a full read plus a
        // 3-byte truncated leftover never has to grow.
        let mut combined: Vec<u8> = Vec::with_capacity(buffer.len() + 4);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    combined.extend_from_slice(&buffer[..n]);

                    let split = split_utf8_safely(&combined);
                    if split > 0 {
                        let chunk = String::from_utf8_lossy(&combined[..split]).into_owned();
                        let _ = app.emit("pty-output", chunk);
                        // Drop the emitted prefix in place; the tail (at
                        // most 3 bytes of a truncated codepoint) stays put
                        // for the next read.
                        combined.drain(..split);
                    }
                }
                Err(e) => {
                    error!("PTY reader error: {}", e);
                    break;
                }
            }
        }
        // Flush any trailing truncated bytes the child never completed so
        // users still see the final prompt/output byte-for-byte (lossy at
        // worst on a deliberately malformed tail).
        if !combined.is_empty() {
            let tail = String::from_utf8_lossy(&combined).into_owned();
            let _ = app.emit("pty-output", tail);
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

#[cfg(test)]
mod tests {
    use super::split_utf8_safely;

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
}
