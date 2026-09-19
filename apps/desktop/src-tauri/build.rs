/// The window loads TeamOS from a remote URL, and Tauri refuses IPC from a
/// remote origin unless the command is covered by a capability. Declaring the
/// commands here generates the `allow-*` permissions that `capabilities/` and
/// the runtime capability in `lib.rs` reference by name.
fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_start_login",
            "desktop_notify",
            "desktop_set_badge",
            "desktop_is_foreground",
        ]),
    );

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
