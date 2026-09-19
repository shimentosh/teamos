//! Signing in through the system browser.
//!
//! The shell never asks for a password. It mints a `state` value, opens the
//! instance's desktop sign-in page in the default browser, and waits for the
//! browser to come back over `teamos://auth/callback` with a single-use token.
//! The browser is where passwords, passkeys and SSO sessions already live, so
//! the whole sign-in surface stays there.
//!
//! A callback whose `state` does not match the one this run issued is dropped.
//! Without that, a link someone sends could sign a waiting app into the
//! sender's account.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_opener::OpenerExt;

use crate::config;
use crate::show_window;

/// The `state` value of a sign-in this run started, cleared once it is used.
#[derive(Default)]
pub struct PendingLogin(Mutex<Option<String>>);

fn new_state() -> String {
    // Two v4 UUIDs: 256 bits from the OS random source, hex, and already in the
    // character set the web page validates.
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Opens the browser at the instance's desktop sign-in page.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let instance = config::load().instance_url;
    let state = new_state();

    let url = format!("{instance}/desktop?state={state}");

    {
        let pending = app.state::<PendingLogin>();
        let mut slot = pending.0.lock().map_err(|_| "login state is poisoned")?;
        // A second attempt replaces the first: only the newest one can finish.
        *slot = Some(state);
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// A one-time token is opaque and short. Anything outside this shape did not
/// come from the instance, and refusing it here keeps the value from reaching
/// the URL fragment the window is about to load.
fn is_plausible_token(token: &str) -> bool {
    let length = token.len();
    (16..=256).contains(&length)
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Handles `teamos://auth/callback?token=…&state=…`.
///
/// Returns quietly on anything unexpected: deep links can arrive from any
/// program on the computer, so this is not a place to act on doubt.
pub fn handle_deep_link(app: &AppHandle, raw: &str) {
    let Ok(url) = Url::parse(raw) else {
        return;
    };
    if url.scheme() != "teamos" {
        return;
    }
    // `teamos://auth/callback` parses with "auth" as the host.
    if url.host_str() != Some("auth") || url.path() != "/callback" {
        return;
    }

    let mut token = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "token" => token = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }

    let (Some(token), Some(state)) = (token, state) else {
        return;
    };

    if !is_plausible_token(&token) {
        return;
    }

    // Single-use: take it, so a replayed link finds nothing waiting.
    let expected = match app.state::<PendingLogin>().0.lock() {
        Ok(mut slot) => slot.take(),
        Err(_) => return,
    };
    if expected.as_deref() != Some(state.as_str()) {
        return;
    }

    let instance = config::load().instance_url;
    // The token travels in the fragment, which never reaches the server as part
    // of the request line and so stays out of access logs and referrers.
    let Ok(callback) = format!("{instance}/desktop/callback#token={token}").parse::<Url>() else {
        return;
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(callback);
    }
    show_window(app);
}

#[cfg(test)]
mod tests {
    use super::is_plausible_token;

    #[test]
    fn accepts_the_tokens_better_auth_mints() {
        assert!(is_plausible_token("QHtLRW5yTnZ4YkZ1c0RkVw"));
        assert!(is_plausible_token(&"a".repeat(32)));
    }

    #[test]
    fn rejects_anything_that_could_reshape_the_url() {
        assert!(!is_plausible_token(""));
        assert!(!is_plausible_token("short"));
        assert!(!is_plausible_token("has spaces in it here"));
        assert!(!is_plausible_token("token&redirect=https://evil.example"));
        assert!(!is_plausible_token(&"a".repeat(257)));
    }
}
