//! The commands the shell exposes over IPC.
//!
//! Which of these a page may call is decided in `capabilities/`. A TeamOS
//! instance loaded in the window gets the four it needs to raise notifications
//! and start a browser sign-in. Reading or changing which server the app points
//! at is granted to the shell's own setup window only, so a page can never
//! repoint the app somewhere else.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

use crate::{auth, config, grant_instance_ipc, set_tray_tooltip, show_window};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    version: String,
    platform: String,
    instance_url: String,
    autostart: bool,
}

#[tauri::command]
pub fn desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        instance_url: config::load().instance_url,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
pub fn desktop_start_login(app: AppHandle) -> Result<(), String> {
    auth::start(&app)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingNotification {
    title: String,
    #[serde(default)]
    body: String,
}

/// Toasts are a fixed size; the OS cuts anything longer anyway, and cutting it
/// here keeps a very long task title from filling the corner of the screen.
fn clamp(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[tauri::command]
pub fn desktop_notify(app: AppHandle, notification: IncomingNotification) -> Result<(), String> {
    let title = clamp(&notification.title, 80);
    if title.is_empty() {
        return Ok(());
    }

    app.notification()
        .builder()
        .title(title)
        .body(clamp(&notification.body, 240))
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_set_badge(app: AppHandle, count: i64) -> Result<(), String> {
    let count = count.clamp(0, 9999);

    if let Some(window) = app.get_webview_window("main") {
        // Not every platform has a badge (Windows in particular); the tray
        // tooltip below is the fallback that always shows something.
        let _ = window.set_badge_count(if count > 0 { Some(count) } else { None });
    }

    set_tray_tooltip(&app, count);
    Ok(())
}

/// Whether the window is actually in front of the user. A window hidden to the
/// tray can still report focus, so visibility and minimisation are checked too.
#[tauri::command]
pub fn desktop_is_foreground(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };

    window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && window.is_focused().unwrap_or(false)
}

/// Points the shell at a different TeamOS server. Setup window only.
#[tauri::command]
pub fn desktop_set_instance_url(app: AppHandle, url: String) -> Result<(), String> {
    let normalized = config::normalize_url(&url)
        .ok_or_else(|| "Enter a web address like https://teamos.example.com".to_string())?;

    let mut config = config::load();
    config.instance_url = normalized.clone();
    config::save(&config)?;

    grant_instance_ipc(&app, &normalized);

    let target = normalized.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(target).map_err(|e| e.to_string())?;
    }

    if let Some(setup) = app.get_webview_window("setup") {
        let _ = setup.close();
    }
    show_window(&app);
    Ok(())
}

/// Start with the computer. Driven by the tray menu, not by any page.
pub(crate) fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|e| e.to_string())?;

    let mut config = config::load();
    config.autostart = enabled;
    config::save(&config)
}
