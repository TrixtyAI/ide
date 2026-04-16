use serde::Serialize;
use sysinfo::System;
use std::env;

#[derive(Serialize)]
pub struct AboutInfo {
    pub app_version: String,
    pub tauri_version: String,
    pub os_name: String,
    pub os_version: String,
    pub arch: String,
    pub webview_version: String,
    pub rust_version: String,
    pub node_version: String,
}

#[tauri::command]
pub async fn get_trixty_about_info(app: tauri::AppHandle) -> Result<AboutInfo, String> {
    let package_info = app.package_info();
    
    Ok(AboutInfo {
        app_version: package_info.version.to_string(),
        tauri_version: "2.10.3".to_string(),
        os_name: System::name().unwrap_or_else(|| env::consts::OS.to_string()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
        arch: env::consts::ARCH.to_string(),
        webview_version: "147.0.3912.60".to_string(),
        rust_version: "1.85.1".to_string(),
        node_version: "24.13.0".to_string(),
    })
}
