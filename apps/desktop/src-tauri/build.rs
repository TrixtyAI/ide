fn main() {
    println!("cargo:rerun-if-env-changed=TRIXTY_CLOUD_ENDPOINT");
    tauri_build::build()
}
