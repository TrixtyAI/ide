use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

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
    if url.starts_with("http://") || url.starts_with("https://") {
        let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;

        let catalog = response
            .json::<RegistryCatalog>()
            .await
            .map_err(|e| e.to_string())?;

        return Ok(catalog);
    }

    // Fallback to local file reading for dev mode
    let content = std::fs::read_to_string(&url)
        .map_err(|e| format!("Failed to read local registry file {}: {}", url, e))?;

    let catalog: RegistryCatalog =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in registry: {}", e))?;

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

    let response = reqwest::get(&fetch_url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch manifest from {}: HTTP {}",
            fetch_url,
            response.status()
        ));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read HTTP body: {}", e))?;

    let json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON Parsing Failed: {}. Raw Response: {}", e, text))?;

    Ok(json)
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
    let response = reqwest::get(&fetch_url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        // Fallback or empty if no file
        return Ok(String::new());
    }

    let text = response.text().await.map_err(|e| e.to_string())?;

    Ok(text)
}

fn get_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ext_dir = app_data.join("extensions");
    if !ext_dir.exists() {
        std::fs::create_dir_all(&ext_dir).map_err(|e| e.to_string())?;
    }
    Ok(ext_dir)
}

#[tauri::command]
pub async fn install_extension(app: AppHandle, id: String, git_url: String) -> Result<(), String> {
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if target_dir.exists() {
        return Err("Extension is already installed".into());
    }

    let output = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            &git_url,
            target_dir.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    Ok(())
}

#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, id: String) -> Result<(), String> {
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn update_extension(app: AppHandle, id: String) -> Result<(), String> {
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);

    if !target_dir.exists() {
        return Err("Extension not installed".into());
    }

    let output = Command::new("git")
        .args(["pull"])
        .current_dir(&target_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
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
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let disabled_file = app_data.join("disabled_extensions.json");

    if !disabled_file.exists() {
        return Ok(true);
    }

    let content = std::fs::read_to_string(&disabled_file).map_err(|e| e.to_string())?;
    let disabled: Vec<String> = serde_json::from_str(&content).unwrap_or_default();

    Ok(!disabled.contains(&id))
}

#[tauri::command]
pub async fn toggle_extension_state(
    app: AppHandle,
    id: String,
    is_active: bool,
) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let disabled_file = app_data.join("disabled_extensions.json");

    let mut disabled: Vec<String> = if disabled_file.exists() {
        let content = std::fs::read_to_string(&disabled_file).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    if is_active {
        disabled.retain(|x| x != &id);
    } else if !disabled.contains(&id) {
        disabled.push(id.clone());
    }

    let json = serde_json::to_string_pretty(&disabled).map_err(|e| e.to_string())?;
    std::fs::write(disabled_file, json).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn read_extension_script(app: AppHandle, id: String) -> Result<String, String> {
    let ext_dir = get_extensions_dir(&app)?;
    let target_dir = ext_dir.join(&id);
    let index_file = target_dir.join("index.js");

    if !index_file.exists() {
        return Err(format!("Extension {} does not have an index.js file", id));
    }

    let content = std::fs::read_to_string(&index_file).map_err(|e| e.to_string())?;
    Ok(content)
}
