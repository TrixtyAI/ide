fn main() {
    println!("cargo:rerun-if-env-changed=CLOUD_CONFIG_URL");
    println!("cargo:rerun-if-changed=../.env");

    // Manually parse .env to support CLOUD_CONFIG_URL at compile time via option_env!
    if let Ok(content) = std::fs::read_to_string("../.env") {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                if key.trim() == "CLOUD_CONFIG_URL" {
                    println!("cargo:rustc-env=CLOUD_CONFIG_URL={}", value.trim());
                }
            }
        }
    }

    tauri_build::build()
}
