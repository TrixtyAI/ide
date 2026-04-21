/// Strips the current user's home directory from an error string before it
/// crosses the Tauri boundary. Errors composed with absolute paths (`C:\Users\
/// <name>\...`, `/home/<name>/...`, `/Users/<name>/...`) leak both the OS
/// shape and the user's account name to the renderer, which then ends up in
/// alerts, the AI chat, and any future telemetry. Logs keep the raw value via
/// the crate's `log::error!` calls; only the value returned to the frontend
/// is redacted.
pub fn redact_user_paths(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    let mut out = input.to_string();

    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy().to_string();
        if !home_str.is_empty() {
            out = replace_path_variants(&out, &home_str, "$HOME");
        }
    }

    out
}

/// Replaces `needle` and its `\\`/`/` separator variants with `replacement`,
/// but only when the needle is immediately followed by a path separator or
/// the end of the string. Errors often mix slash styles (PowerShell stderr
/// vs. Rust path display vs. Git output) so we cover all three, and a
/// boundary check keeps a short home path like `/Users/al` from eating the
/// `ice` of a neighboring `/Users/alice/...` path.
fn replace_path_variants(input: &str, needle: &str, replacement: &str) -> String {
    let mut out = replace_at_path_boundary(input, needle, replacement);

    let backslashed = needle.replace('/', "\\");
    if backslashed != needle {
        out = replace_at_path_boundary(&out, &backslashed, replacement);
    }

    let forward = needle.replace('\\', "/");
    if forward != needle {
        out = replace_at_path_boundary(&out, &forward, replacement);
    }

    out
}

fn replace_at_path_boundary(input: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() || input.len() < needle.len() {
        return input.to_string();
    }

    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i <= input.len().saturating_sub(needle.len()) {
        if input[i..].starts_with(needle) {
            let end = i + needle.len();
            let at_boundary = end == input.len() || matches!(bytes[end], b'/' | b'\\');
            if at_boundary {
                out.push_str(replacement);
                i = end;
                continue;
            }
        }
        // Advance one UTF-8 scalar so we never land inside a multi-byte char.
        let ch = input[i..]
            .chars()
            .next()
            .expect("remainder is non-empty while loop runs");
        out.push(ch);
        i += ch.len_utf8();
    }

    if i < input.len() {
        out.push_str(&input[i..]);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::{redact_user_paths, replace_at_path_boundary};

    #[test]
    fn redaction_is_a_noop_on_empty_input() {
        assert_eq!(redact_user_paths(""), "");
    }

    #[test]
    fn redaction_keeps_unrelated_strings_intact() {
        let msg = "Failed to fetch https://api.github.com/repos/foo/bar: 404";
        assert_eq!(redact_user_paths(msg), msg);
    }

    #[test]
    fn redaction_replaces_home_directory_and_slash_variant() {
        let Some(home) = dirs::home_dir() else {
            // No home directory resolvable in this environment; skip rather
            // than assert something that isn't the function's contract.
            return;
        };
        let home_str = home.to_string_lossy().to_string();
        if home_str.is_empty() {
            return;
        }

        let alt_slash = if home_str.contains('\\') {
            home_str.replace('\\', "/")
        } else {
            home_str.replace('/', "\\")
        };

        let native = format!("Failed to read file {}/foo.ts: denied", home_str);
        assert!(
            redact_user_paths(&native).contains("$HOME/foo.ts")
                || redact_user_paths(&native).contains("$HOME\\foo.ts"),
            "native slash variant should be redacted: {}",
            redact_user_paths(&native)
        );

        let alt = format!("Failed to read file {}/foo.ts: denied", alt_slash);
        let redacted_alt = redact_user_paths(&alt);
        assert!(
            redacted_alt.contains("$HOME"),
            "alternate slash variant should still be redacted: {}",
            redacted_alt
        );
    }

    #[test]
    fn boundary_match_does_not_eat_a_neighboring_path() {
        // Prefix only: no path separator after the needle, so we must not
        // chop off characters from the sibling path.
        let out = replace_at_path_boundary("/Users/alice/Docs", "/Users/al", "$HOME");
        assert_eq!(out, "/Users/alice/Docs");
    }

    #[test]
    fn boundary_match_redacts_when_followed_by_separator() {
        let out = replace_at_path_boundary("/Users/al/Docs", "/Users/al", "$HOME");
        assert_eq!(out, "$HOME/Docs");
    }

    #[test]
    fn boundary_match_redacts_at_end_of_input() {
        let out = replace_at_path_boundary("cd /Users/al", "/Users/al", "$HOME");
        assert_eq!(out, "cd $HOME");
    }
}
