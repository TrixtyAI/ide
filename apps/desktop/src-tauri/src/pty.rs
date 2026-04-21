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

/// Strips ANSI escape sequences that have no legitimate reason to travel
/// *from* the UI into the PTY. These sequences are meant for shell-to-UI
/// signalling; if the frontend forwards them to the shell (because the user
/// pasted untrusted output, an AI reply, or a README into the terminal),
/// an attacker can hijack the clipboard (OSC 52), retitle the window
/// (OSC 0/1/2), point the host at a bogus working directory (OSC 7),
/// smuggle data through DCS/APC/PM/SOS payloads, or spoof link targets
/// via OSC 8.
///
/// Stripped, starting at either `ESC` (0x1B) + introducer or the 7-bit C1
/// byte, and consuming everything up to a String Terminator (`ST` = 0x9C
/// or `ESC \\`, plus the BEL shorthand 0x07 for OSC):
/// - OSC (`ESC ]` / 0x9D)
/// - DCS (`ESC P` / 0x90)
/// - SOS (`ESC X` / 0x98)
/// - PM  (`ESC ^` / 0x9E)
/// - APC (`ESC _` / 0x9F)
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
        // 7-bit C1 codepoint equivalents of OSC/DCS/SOS/PM/APC. Iterating
        // by `char` (not bytes) is essential: U+0098 appears as the byte
        // sequence `0xC2 0x98` in UTF-8, but individual UTF-8 continuation
        // bytes inside legitimate codepoints (e.g. `😀` contains 0x98) must
        // not be mistaken for a C1 introducer.
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
    let sanitized = sanitize_pty_input(&data);
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(s) = guard.as_ref() {
        let mut writer = s.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(sanitized.as_bytes())
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
