//! The commands the shell exposes over IPC.
//!
//! Which of these a page may call is decided in `capabilities/`. A TeamOS
//! instance loaded in the window gets the four it needs to raise notifications
//! and start a browser sign-in. Which server the app points at is not one of
//! them, and is not changeable from the app at all: it is a build-time constant
//! with a development-only environment override.

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

use crate::{auth, config, set_tray_tooltip};

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
