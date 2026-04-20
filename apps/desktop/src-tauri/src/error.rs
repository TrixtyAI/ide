/// Strips the current user's home directory from an error string before it
/// crosses the Tauri boundary. Errors composed with absolute paths (`C:\Users\
/// <name>\...`, `/home/<name>/...`, `/Users/<name>/...`) leak both the OS
/// shape and the user's account name to the renderer, which then ends up in
/// alerts, the AI chat, and any future telemetry. Logs keep the raw value via
/// `tracing::error!`; only the value returned to the frontend is redacted.
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

/// Replaces `needle` and its `\\`/`/` separator variants with `replacement`.
/// Errors often mix slash styles (PowerShell stderr vs. Rust path display vs.
/// Git output) so we want one substitution to cover all three.
fn replace_path_variants(input: &str, needle: &str, replacement: &str) -> String {
    let mut out = input.replace(needle, replacement);

    let backslashed = needle.replace('/', "\\");
    if backslashed != needle {
        out = out.replace(&backslashed, replacement);
    }

    let forward = needle.replace('\\', "/");
    if forward != needle {
        out = out.replace(&forward, replacement);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::redact_user_paths;

    #[test]
    fn redaction_is_a_noop_on_empty_input() {
        assert_eq!(redact_user_paths(""), "");
    }

    #[test]
    fn redaction_keeps_unrelated_strings_intact() {
        let msg = "Failed to fetch https://api.github.com/repos/foo/bar: 404";
        assert_eq!(redact_user_paths(msg), msg);
    }
}
