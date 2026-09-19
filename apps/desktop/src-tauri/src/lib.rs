//! TeamOS as a desktop app.
//!
//! The window loads TeamOS from the instance itself rather than bundling a copy
//! of the web app, so the desktop is never a version behind the server. What
//! the shell adds is the part a browser tab cannot: signing in through the
//! system browser, OS notifications while the window is in the background, a
//! tray icon the window hides into, and starting with the computer.

mod auth;
mod commands;
mod config;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_deep_link::DeepLinkExt;

use auth::PendingLogin;

/// Passed by the autostart entry so a login start lands in the tray rather than
/// throwing a window in front of someone who just turned their computer on.
const MINIMIZED_FLAG: &str = "--minimized";

/// What a TeamOS instance loaded in the window is allowed to call. Deliberately
/// short, and deliberately without `desktop_set_instance_url`.
const REMOTE_COMMAND_PERMISSIONS: &[&str] = &[
    "allow-desktop-start-login",
    "allow-desktop-notify",
    "allow-desktop-set-badge",
    "allow-desktop-is-foreground",
];

pub fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let start_minimized = args.iter().any(|arg| arg == MINIMIZED_FLAG);
    run_app(start_minimized);
}

fn run_app(start_minimized: bool) {
    let config = config::load();
    let instance_url = config.instance_url.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Windows delivers a deep link by launching the app again with the
            // URL as an argument; the plugin's deep-link feature forwards it,
            // and this covers the case where it arrives as plain argv.
            if let Some(url) = args.iter().find(|arg| arg.starts_with("teamos://")) {
                auth::handle_deep_link(app, url);
                return;
            }
            show_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_FLAG]),
        ))
        .manage(PendingLogin::default())
        .invoke_handler(tauri::generate_handler![
            commands::desktop_info,
            commands::desktop_start_login,
            commands::desktop_notify,
            commands::desktop_set_badge,
            commands::desktop_is_foreground,
            commands::desktop_set_instance_url,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // An instance the build did not know about still needs IPC access,
            // or notifications and browser sign-in silently stop working there.
            grant_instance_ipc(&handle, &instance_url);

            build_main_window(&handle, &instance_url, !start_minimized)?;
            build_tray(&handle, config.autostart)?;

            // Start at login unless the user turned it off. Without it the app
            // is not there to notify anyone until they remember to open it.
            let autolaunch = handle.autolaunch();
            let _ = if config.autostart {
                autolaunch.enable()
            } else {
                autolaunch.disable()
            };

            // Installing the app registers `teamos://` with the OS. A
            // development run never installs anything, so register it here or
            // browser sign-in cannot come back.
            #[cfg(debug_assertions)]
            if let Err(error) = app.deep_link().register("teamos") {
                eprintln!("could not register the teamos:// scheme: {error}");
            }

            // A deep link that launched this very process.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    auth::handle_deep_link(&handle, url.as_str());
                }
            }

            let deep_link_handle = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    auth::handle_deep_link(&deep_link_handle, url.as_str());
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to the tray, the way a chat app does: TeamOS keeps
            // its connection open and can still raise a notification. "Quit" in
            // the tray menu is the way out.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start TeamOS");
}

fn build_main_window(app: &AppHandle, instance_url: &str, visible: bool) -> tauri::Result<()> {
    let url: Url = instance_url
        .parse()
        .unwrap_or_else(|_| config::DEFAULT_INSTANCE_URL.parse().expect("valid default"));

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("TeamOS")
        .inner_size(1280.0, 840.0)
        .min_inner_size(960.0, 600.0)
        .visible(visible)
        .center()
        .build()?;

    Ok(())
}

/// The local page for pointing the shell at a different server. Separate from
/// the main window so the instance's own pages never share its permissions.
fn open_setup_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
        .title("TeamOS — Instance")
        .inner_size(460.0, 320.0)
        .resizable(false)
        .center()
        .build();
}

fn build_tray(app: &AppHandle, autostart_enabled: bool) -> tauri::Result<()> {
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start at login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "Open TeamOS", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &autostart_item,
            &MenuItem::with_id(app, "instance", "Change instance…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit TeamOS", true, None::<&str>)?,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("TeamOS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "instance" => open_setup_window(app),
            "autostart" => {
                let enabled = autostart_item.is_checked().unwrap_or(false);
                if let Err(error) = commands::set_autostart(app, enabled) {
                    eprintln!("could not change start at login: {error}");
                    let _ = autostart_item.set_checked(!enabled);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Shows the unread count where the platform has no badge of its own.
pub(crate) fn set_tray_tooltip(app: &AppHandle, unread: i64) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };

    let tooltip = match unread {
        0 => "TeamOS".to_string(),
        1 => "TeamOS — 1 unread".to_string(),
        n => format!("TeamOS — {n} unread"),
    };
    let _ = tray.set_tooltip(Some(tooltip));
}

/// Grants a TeamOS instance the short list of commands above.
///
/// Tauri refuses IPC from a remote origin unless a capability names it, so
/// without this the page loaded from the instance can raise no notifications
/// and start no browser sign-in. `capabilities/instance.json` covers the
/// instances this build ships with; this covers one the user typed in.
pub(crate) fn grant_instance_ipc(app: &AppHandle, origin: &str) {
    let identifier = format!(
        "runtime-{}",
        origin
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
    );

    let mut capability = tauri::ipc::CapabilityBuilder::new(identifier)
        .local(false)
        .remote(origin.to_string())
        .window("main");

    for permission in REMOTE_COMMAND_PERMISSIONS {
        capability = capability.permission(*permission);
    }

    if let Err(error) = app.add_capability(capability) {
        // Not fatal: the window still loads TeamOS, it just cannot reach the
        // shell. Better a working app without notifications than no app.
        eprintln!("could not grant {origin} access to the desktop shell: {error}");
    }
}

pub(crate) fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
