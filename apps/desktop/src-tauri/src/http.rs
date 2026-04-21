use log::warn;
use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;

/// Connect timeout shared across every outbound HTTP call. Bounded so a slow
/// or unreachable host can't park a Tauri command thread indefinitely waiting
/// on TCP/TLS handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Default per-request timeout applied to every fetch except those that
/// explicitly opt out (e.g. the Ollama proxy, which streams generations that
/// can legitimately exceed 30 s).
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum number of bytes we will buffer from a remote response before
/// erroring out. 10 MiB is generous for manifests, READMEs, search HTML and
/// GitHub API JSON, while still capping memory if a server streams forever.
pub const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();

/// Returns a process-wide `reqwest::Client`. Shared so connection pooling and
/// keep-alive carry across the many per-entry calls made by catalog refresh,
/// and so we configure timeouts/TLS once instead of in every call site.
///
/// No global `User-Agent` is set; callers attach the appropriate UA per
/// request because requirements differ (Chrome for scraping vs. `TrixtyIDE`
/// for the GitHub API).
pub fn shared_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("failed to build shared reqwest client")
    })
}

/// Drains a `reqwest::Response` into a `Vec<u8>` while enforcing a hard cap.
/// Trips early if `Content-Length` already exceeds the cap, otherwise
/// streams chunks and aborts as soon as the running total would breach it.
///
/// The `Content-Length` comparison is done in `u64` space so a large
/// advertised length can't be silently truncated to `usize` on a 32-bit
/// build and bypass the cap.
pub async fn read_body_capped(
    mut resp: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    if let Some(len) = resp.content_length() {
        if len > max_bytes as u64 {
            return Err(format!(
                "Response Content-Length {} exceeds {} byte cap",
                len, max_bytes
            ));
        }
    }
    let mut acc: Vec<u8> = Vec::with_capacity(8 * 1024);
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if acc.len() + chunk.len() > max_bytes {
            return Err(format!("Response body exceeded {} byte cap", max_bytes));
        }
        acc.extend_from_slice(&chunk);
    }
    Ok(acc)
}

/// String specialization of [`read_body_capped`].
///
/// Tries strict UTF-8 first (the case for ~every endpoint we hit — GitHub
/// raw, GitHub API, Ollama, DuckDuckGo Lite). If the bytes aren't valid
/// UTF-8 we fall back to `String::from_utf8_lossy` and log a warning,
/// mirroring `reqwest::Response::text()`'s "best effort decode" behavior so
/// a stray Latin-1 or Shift-JIS page doesn't fail the whole call. The cap
/// from `read_body_capped` still applies.
pub async fn read_text_capped(resp: reqwest::Response, max_bytes: usize) -> Result<String, String> {
    let bytes = read_body_capped(resp, max_bytes).await?;
    match String::from_utf8(bytes) {
        Ok(s) => Ok(s),
        Err(e) => {
            warn!(
                "Response body was not valid UTF-8 ({} byte(s) before failure); decoding lossy",
                e.utf8_error().valid_up_to()
            );
            Ok(String::from_utf8_lossy(e.as_bytes()).into_owned())
        }
    }
}
