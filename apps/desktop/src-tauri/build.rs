fn main() {
    println!("cargo:rerun-if-env-changed=CLOUD_CONFIG_URL");
    tauri_build::build()
}
