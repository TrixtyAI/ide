use log::{error, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::error::redact_user_paths;
use crate::http::{read_text_capped, shared_client, DEFAULT_REQUEST_TIMEOUT, MAX_RESPONSE_BYTES};

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryCatalog {
    pub marketplace: Vec<RegistryEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub data: Option<String>,
    pub path: Option<String>, // Support for subfolders
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ExtensionState {
    pub installed: bool,
    pub is_active: bool,
    pub local_path: Option<String>,
}

// Helper to resolve github repo URLs to raw URLs
fn repo_to_raw_base(repo_url: &str, branch: &str, subpath: Option<&str>) -> String {
    let mut url = repo_url.trim_end_matches(".git").to_string();
    if url.starts_with("https://github.com/") {
        url = url.replacen(
            "https://github.com/",
            "https://raw.githubusercontent.com/",
            1,
        );
    }

    let base = format!("{}/{}", url, branch);
    if let Some(p) = subpath {
        let clean_path = p.trim_start_matches('/');
        format!("{}/{}", base, clean_path)
    } else {
        base
    }
}

#[tauri::command]
pub async fn get_registry_catalog(url: String) -> Result<RegistryCatalog, String> {
    // Trim and lower-case the scheme before matching so inputs like
    // `  HTTP://…` or `Https://…` still hit the intended branch instead of
    // falling through to the local-file fallback with a confusing error.
    let trimmed = url.trim();
    let scheme_prefix: String = trimmed.chars().take_while(|c| *c != ':').collect();
    let scheme_lc = scheme_prefix.to_ascii_lowercase();

    // Plain `http://` (any casing/whitespace) is rejected outright: a MITM on
    // the catalog can inject arbitrary `repository`/`data` entries that
    // `install_extension` will then pass to `git clone`, escalating a network
    // attack into code execution.
    if scheme_lc == "http" {
        return Err("Registry URL must use https://; plain HTTP is rejected to prevent MITM tampering of the catalog".to_string());
    }

    if scheme_lc == "https" {
        let response = shared_client()
            .get(trimmed)
            .timeout(DEFAULT_REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        // Surface the HTTP failure explicitly, otherwise a 404/500 HTML body
        // turns into a "Failed to parse registry JSON" error that hides the
        // real problem (typo'd URL, registry missing, proxy blocking, …).
        let status = response.status();
        if !status.is_success() {
            return Err(format!(
                "Failed to fetch registry from {}: HTTP {}",
                trimmed, status
            ));
        }

        let body = read_text_capped(response, MAX_RESPONSE_BYTES).await?;
        let catalog: RegistryCatalog = serde_json::from_str(&body).map_err(|e| {
            let err = format!("Failed to parse registry JSON from {}: {}", trimmed, e);
            error!("{}", err);
            redact_user_paths(&err)
        })?;

        return Ok(catalog);
    }

    // Fallback to local file reading for dev mode. Only reachable when the
    // caller supplied something without an http/https scheme, so we pass the
    // original (untrimmed) value through to keep error messages pointing at
    // what the caller actually sent.
    let content = std::fs::read_to_string(&url).map_err(|e| {
        let err = format!("Failed to read local registry file {}: {}", url, e);
        error!("{}", err);
        redact_user_paths(&err)
    })?;

    let catalog: RegistryCatalog = serde_json::from_str(&content)
        .map_err(|e| redact_user_paths(&format!("Invalid JSON in registry: {}", e)))?;

    Ok(catalog)
}

#[tauri::command]
pub async fn fetch_extension_manifest(
    repo_url: String,
    branch: String,
    data_url: Option<String>,
    path: Option<String>,
) -> Result<Value, String> {
    let fetch_url = if let Some(d) = data_url {
        // If data_url contains 'blob', replace with raw for github
        if d.contains("github.com") && d.contains("/blob/") {
            d.replace("github.com", "raw.githubusercontent.com")
                .replace("/blob/", "/")
        } else {
            d
        }
    } else {
        format!(
            "{}/package.json",
            repo_to_raw_base(&repo_url, &branch, path.as_deref())
        )
    };

    let response = shared_client()
        .get(&fetch_url)
        .timeout(DEFAULT_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch manifest from {}: HTTP {}",
            fetch_url,
            response.status()
        ));
    }

    let text = read_text_capped(response, MAX_RESPONSE_BYTES).await?;

    let json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON Parsing Failed: {}. Raw Response: {}", e, text))?;

    Ok(json)
}

#[tauri::command]
pub async fn fetch_extension_stars(repo_url: String) -> Result<Option<u32>, String> {
    // Parse owner/repo from a GitHub HTTPS URL. Anything else gracefully returns None.
    let cleaned = repo_url.trim_end_matches(".git");
    let prefix = "https://github.com/";
    if !cleaned.starts_with(prefix) {
        return Ok(None);
    }
    let rest = &cleaned[prefix.len()..];
    let mut parts = rest.splitn(3, '/');
    let owner = match parts.next().filter(|s| !s.is_empty()) {
        Some(o) => o,
        None => return Ok(None),
    };
    let repo = match parts.next().filter(|s| !s.is_empty()) {
        Some(r) => r,
        None => return Ok(None),
    };

    let api_url = format!("https://api.github.com/repos/{}/{}", owner, repo);

    // GitHub API requires a User-Agent header.
    // Failures (network, rate limit, parse) are logged and return None for fallback.
    let response = match shared_client()
        .get(&api_url)
        .header(reqwest::header::USER_AGENT, "TrixtyIDE")
        .timeout(DEFAULT_REQUEST_TIMEOUT)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!("Failed to fetch stars for {}: {}", repo_url, e);
            return Ok(None);
        }
    };

    if !response.status().is_success() {
        warn!(
            "GitHub API error {} for stars of {}",
            response.status(),
            repo_url
        );
        return Ok(None);
    }

    let text = match read_text_capped(response, MAX_RESPONSE_BYTES).await {
        Ok(t) => t,
        Err(e) => {
            warn!("Failed to read stars body for {}: {}", repo_url, e);
            return Ok(None);
        }
    };

    let body: serde_json::Value = match serde_json::from_str(&text) {
        Ok(b) => b,
        Err(e) => {
            warn!("Failed to parse stars JSON for {}: {}", repo_url, e);
            return Ok(None);
        }
    };

    Ok(body
        .get("stargazers_count")
        .and_then(|v| v.as_u64())
        .and_then(|n| u32::try_from(n).ok()))
}

#[tauri::command]
pub async fn fetch_extension_file(
    repo_url: String,
    branch: String,
    path: Option<String>,
    file_name: String,
) -> Result<String, String> {
    let fetch_url = format!(
        "{}/{}",
        repo_to_raw_base(&repo_url, &branch, path.as_deref()),
        file_name
    );
    let response = shared_client()
        .get(&fetch_url)
        .timeout(DEFAULT_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        // Fallback or empty if no file
        return Ok(String::new());
    }

    let text = read_text_capped(response, MAX_RESPONSE_BYTES).await?;

    Ok(text)
}

fn get_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| redact_user_paths(&e.to_string()))?;
    let ext_dir = app_data.join("extensions");
    if !ext_dir.exists() {
        std::fs::create_dir_all(&ext_dir).map_err(|e| redact_user_paths(&e.to_string()))?;
    }
    Ok(ext_dir)
}

/// Hosts we allow `git clone` to target from the extension marketplace. Every
/// legitimate entry today points at one of these, and the constraint blocks
/// the bulk of the attack surface: `file://`, Windows UNC, `ssh://`,
/// `git://`, and `ext::` transports can't reach this point because the host
/// won't match, and typo-squatted domains have nowhere to land.
const ALLOWED_GIT_HOSTS: &[&str] = &["github.com", "gitlab.com", "bitbucket.org"];

/// Enforces the URL shape that `git clone` will accept: strict `https://`,
/// allow-listed host, exactly `owner/repo[.git]`, ASCII-safe segments, no
/// credentials, no transport-helper syntax. Everything coming out of
/// `resolveGitRepoUrl` on the frontend already looks like this, so the
/// check is free for legitimate catalog entries and hard-stops a compromised
/// registry.
fn validate_git_clone_url(url: &str) -> Result<(), String> {
    // Reject control characters and whitespace up front — these should never
    // appear in a real clone URL and catching them here keeps downstream
    // argv/process parsers honest.
    if url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("git_url must not contain control characters or whitespace".to_string());
    }

    // Block the `ext::` transport-helper syntax that lets git run arbitrary
    // helper binaries. The https:// strip below would catch this too, but
    // the explicit message helps when debugging a compromised catalog.
    if url.contains("::") {
        return Err("git_url must not contain transport-helper syntax (`::`)".to_string());
    }

    let after_scheme = url
        .strip_prefix("https://")
        .ok_or_else(|| format!("git_url must begin with https:// (got `{}`)", url))?;

    // `user@host/...` shapes shift the host parser and let an attacker embed
    // credentials or, worse, alternate hosts. No legitimate marketplace
    // entry uses them.
    if after_scheme.contains('@') {
        return Err("git_url must not contain `@` (credentials/alternate host)".to_string());
    }

    let (host, path) = after_scheme
        .split_once('/')
        .ok_or_else(|| format!("git_url is missing a repository path: `{}`", url))?;

    if !ALLOWED_GIT_HOSTS.contains(&host) {
        return Err(format!(
            "git_url host `{}` is not in the allowlist ({})",
            host,
            ALLOWED_GIT_HOSTS.join(", ")
        ));
    }

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() != 2 {
        return Err(format!(
            "git_url path must be `<owner>/<repo>` or `<owner>/<repo>.git`; got `{}`",
            path
        ));
    }

    for seg in &segments {
        if seg.starts_with('-') {
            return Err(format!(
                "git_url path segment `{}` cannot start with `-`",
                seg
            ));
        }
        if !seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            return Err(format!(
                "git_url path segment `{}` contains disallowed characters",
                seg
            ));
        }
    }

    Ok(())
}

/// Reject extension ids that would escape `ext_dir` on join, contain
/// path separators, parent-directory components, or anything other than
/// the safe marketplace-style slug characters. Required because a
/// compromised catalog could supply `id = "../../../Windows/foo"` and
/// `ext_dir.join(id)` on Windows happily resolves that outside the
/// extensions directory — `git clone` would then write to the escaped
/// location instead of the sandboxed app-data subfolder.
fn validate_extension_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("extension id is empty".to_string());
    }
    if id == "." || id == ".." {
        return Err(format!(
            "extension id `{}` is not a valid directory name",
            id
        ));
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!(
            "extension id `{}` cannot contain path separators or `..`",
            id
        ));
    }
    if id.starts_with('-') {
        return Err(format!("extension id `{}` cannot start with `-`", id));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!(
            "extension id `{}` contains disallowed characters (allowed: ASCII alphanumeric, `-`, `_`, `.`)",
            id
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_extension(app: AppHandle, id: String, git_url: String) -> Result<(), String> {
    // Validate id and git_url before we even build the target directory so a
    // bad input never reaches `git clone` or the filesystem.
    validate_extension_id(&id)?;
    validate_git_clone_url(&git_url)?;

    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if target_dir.exists() {
        return Err("Extension is already installed".into());
    }

    // Belt-and-suspenders: even though `validate_git_clone_url` already
    // enforces an https:// allow-listed host, turn off the protocols that are
    // most commonly abused for arbitrary command execution during clone. If
    // anything ever gets past the URL check, git itself will still refuse
    // `ext::`, `file://`, and raw `git://`.
    let output = Command::new("git")
        .arg("-c")
        .arg("protocol.ext.allow=never")
        .arg("-c")
        .arg("protocol.file.allow=never")
        .arg("-c")
        .arg("protocol.git.allow=never")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(&git_url)
        .arg(&target_dir)
        .output()
        .await
        .map_err(|e| redact_user_paths(&e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        error!("git clone failed for {}: {}", id, stderr);
        return Err(redact_user_paths(&stderr));
    }

    Ok(())
}

#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, id: String) -> Result<(), String> {
    validate_extension_id(&id)?;
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|e| redact_user_paths(&e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn update_extension(app: AppHandle, id: String) -> Result<(), String> {
    validate_extension_id(&id)?;
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if !target_dir.exists() {
        return Err("Extension not installed".into());
    }

    // Harden `git pull` against a malicious `.git/config` left behind by the
    // extension author. git honors `core.sshCommand`, `core.fsmonitor` and
    // `protocol.*.allow` from local config, which together turn a plain pull
    // into an RCE primitive. Override them on the command line so the clone's
    // own config cannot dictate what gets executed. Mirrors the install path's
    // protocol allow-listing and extends it with the exec-vector flags.
    let output = Command::new("git")
        .arg("-c")
        .arg("core.sshCommand=")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-c")
        .arg("protocol.ext.allow=never")
        .arg("-c")
        .arg("protocol.file.allow=never")
        .arg("-c")
        .arg("protocol.git.allow=never")
        .arg("pull")
        .current_dir(&target_dir)
        .output()
        .await
        .map_err(|e| redact_user_paths(&e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        error!("git pull failed for {}: {}", id, stderr);
        return Err(redact_user_paths(&stderr));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_installed_extensions(app: AppHandle) -> Result<Vec<String>, String> {
    let ext_dir = get_extensions_dir(&app)?;
    let mut installed = Vec::new();

    if ext_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(ext_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        if let Ok(name) = entry.file_name().into_string() {
                            installed.push(name);
                        }
                    }
                }
            }
        }
    }

    Ok(installed)
}

#[tauri::command]
pub async fn is_extension_active(app: AppHandle, id: String) -> Result<bool, String> {
    validate_extension_id(&id)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let disabled_file = app_data.join("disabled_extensions.json");

    if !disabled_file.exists() {
        return Ok(true);
    }

    let content = std::fs::read_to_string(&disabled_file).map_err(|e| e.to_string())?;
    // Surface parse failures instead of silently falling back to "no extensions
    // disabled". A corrupted disabled_extensions.json previously re-enabled
    // every extension on the next read, which the user has no way to notice
    // until an extension they had disabled starts running again.
    let disabled: Vec<String> = serde_json::from_str(&content).map_err(|e| {
        let err = format!("Failed to parse disabled_extensions.json: {}", e);
        error!("{}", err);
        redact_user_paths(&err)
    })?;

    Ok(!disabled.contains(&id))
}

#[tauri::command]
pub async fn toggle_extension_state(
    app: AppHandle,
    id: String,
    is_active: bool,
) -> Result<(), String> {
    validate_extension_id(&id)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let disabled_file = app_data.join("disabled_extensions.json");

    // Same rationale as `is_extension_active`: a corrupted disabled list used
    // to silently re-enable every extension here. Propagate both the read
    // error and the parse error so the caller can surface the problem.
    let mut disabled: Vec<String> = if disabled_file.exists() {
        let content = std::fs::read_to_string(&disabled_file).map_err(|e| {
            let err = format!("Failed to read disabled_extensions.json: {}", e);
            error!("{}", err);
            redact_user_paths(&err)
        })?;
        serde_json::from_str(&content).map_err(|e| {
            let err = format!("Failed to parse disabled_extensions.json: {}", e);
            error!("{}", err);
            redact_user_paths(&err)
        })?
    } else {
        Vec::new()
    };

    if is_active {
        disabled.retain(|x| x != &id);
    } else if !disabled.contains(&id) {
        disabled.push(id.clone());
    }

    let json = serde_json::to_string_pretty(&disabled).map_err(|e| e.to_string())?;
    crate::fs_atomic::write_atomic(&disabled_file, json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn read_extension_script(app: AppHandle, id: String) -> Result<String, String> {
    validate_extension_id(&id)?;
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);
    let index_file = target_dir.join("index.js");

    if !index_file.exists() {
        return Err(format!("Extension {} does not have an index.js file", id));
    }

    let content = std::fs::read_to_string(&index_file).map_err(|e| e.to_string())?;
    Ok(content)
}

#[cfg(test)]
mod git_url_validation_tests {
    use super::validate_git_clone_url;

    #[test]
    fn accepts_github_https_with_git_suffix() {
        assert!(validate_git_clone_url("https://github.com/owner/repo.git").is_ok());
    }

    #[test]
    fn accepts_github_https_without_git_suffix() {
        assert!(validate_git_clone_url("https://github.com/owner/repo").is_ok());
    }

    #[test]
    fn accepts_gitlab_and_bitbucket() {
        assert!(validate_git_clone_url("https://gitlab.com/g/r.git").is_ok());
        assert!(validate_git_clone_url("https://bitbucket.org/g/r.git").is_ok());
    }

    #[test]
    fn rejects_plain_http() {
        assert!(validate_git_clone_url("http://github.com/owner/repo.git").is_err());
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(validate_git_clone_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_ssh_and_git_schemes() {
        assert!(validate_git_clone_url("ssh://git@github.com/owner/repo.git").is_err());
        assert!(validate_git_clone_url("git://github.com/owner/repo.git").is_err());
    }

    #[test]
    fn rejects_ext_transport_helpers() {
        assert!(validate_git_clone_url("ext::curl https://evil.example").is_err());
    }

    #[test]
    fn rejects_non_allowlisted_host() {
        assert!(validate_git_clone_url("https://evil.example.com/a/b.git").is_err());
    }

    #[test]
    fn rejects_authentication_or_alternate_host() {
        assert!(validate_git_clone_url("https://user@github.com/a/b.git").is_err());
        assert!(validate_git_clone_url("https://github.com@evil.example/a/b.git").is_err());
    }

    #[test]
    fn rejects_extra_path_segments() {
        assert!(validate_git_clone_url("https://github.com/a/b/c.git").is_err());
        assert!(validate_git_clone_url("https://github.com/only").is_err());
    }

    #[test]
    fn rejects_flag_like_segments() {
        assert!(validate_git_clone_url("https://github.com/-upload-pack/r.git").is_err());
    }

    #[test]
    fn rejects_whitespace_and_control_chars() {
        assert!(validate_git_clone_url("https://github.com/a/b .git").is_err());
        assert!(validate_git_clone_url("https://github.com/a/b\n.git").is_err());
    }
}

#[cfg(test)]
mod extension_id_validation_tests {
    use super::validate_extension_id;

    #[test]
    fn accepts_plain_slug() {
        assert!(validate_extension_id("trixty.example-addon").is_ok());
        assert!(validate_extension_id("my_ext_01").is_ok());
    }

    #[test]
    fn rejects_empty_or_dot_segments() {
        assert!(validate_extension_id("").is_err());
        assert!(validate_extension_id(".").is_err());
        assert!(validate_extension_id("..").is_err());
    }

    #[test]
    fn rejects_path_separators_and_parent_references() {
        assert!(validate_extension_id("a/b").is_err());
        assert!(validate_extension_id("a\\b").is_err());
        assert!(validate_extension_id("../evil").is_err());
        assert!(validate_extension_id("..\\..\\Windows").is_err());
        assert!(validate_extension_id("foo..bar").is_err());
    }

    #[test]
    fn rejects_leading_dash() {
        assert!(validate_extension_id("-flagish").is_err());
    }

    #[test]
    fn rejects_non_ascii_and_special_chars() {
        assert!(validate_extension_id("ext ension").is_err());
        assert!(validate_extension_id("ext%20").is_err());
        assert!(validate_extension_id("exté").is_err());
    }
}
