//! What the shell remembers between runs: which TeamOS instance to open and
//! whether to start with the computer.
//!
//! The session itself is an ordinary cookie inside the webview, so nothing
//! secret is written here and there is no token for this file to leak.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Url;

/// The instance this build opens unless the user points it somewhere else.
pub const DEFAULT_INSTANCE_URL: &str = "https://teamos.sentosh.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub instance_url: String,
    /// The app lives in the tray, so starting with the computer is the useful
    /// default; the tray menu turns it off.
    pub autostart: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            instance_url: DEFAULT_INSTANCE_URL.to_string(),
            autostart: true,
        }
    }
}

/// `TEAMOS_DESKTOP_DATA_DIR` overrides the location so a development run does
/// not disturb an installed one.
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("TEAMOS_DESKTOP_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("app.teamos.desktop")
}

fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn load() -> Config {
    let mut config = fs::read_to_string(config_path())
        .ok()
        .and_then(|text| serde_json::from_str::<Config>(&text).ok())
        .unwrap_or_default();

    // A saved value that no longer parses would leave the window with nowhere
    // to go, so fall back rather than open a blank shell.
    match normalize_url(&config.instance_url) {
        Some(url) => config.instance_url = url,
        None => config.instance_url = DEFAULT_INSTANCE_URL.to_string(),
    }

    // Development override. Deliberately not written back: `pnpm dev` pointing
    // at localhost should not repoint an installed app.
    if let Some(url) = std::env::var("TEAMOS_INSTANCE_URL")
        .ok()
        .as_deref()
        .and_then(normalize_url)
    {
        config.instance_url = url;
    }

    config
}

pub fn save(config: &Config) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())
}

/// Reduces an address to `scheme://host[:port]`, accepting only http and https.
///
/// Everything else — a path, a `javascript:` URL, a bare word with no host — is
/// rejected, because whatever comes out of here becomes the window's home page
/// and the origin the shell grants IPC access to.
pub fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // "teamos.example.com" is what people type; assume https rather than fail.
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let url = Url::parse(&candidate).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }

    let host = url.host_str()?;
    if host.is_empty() {
        return None;
    }

    let mut origin = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        origin.push_str(&format!(":{port}"));
    }
    Some(origin)
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn keeps_scheme_host_and_port() {
        assert_eq!(
            normalize_url("https://teamos.sentosh.com"),
            Some("https://teamos.sentosh.com".into())
        );
        assert_eq!(
            normalize_url("http://localhost:5173"),
            Some("http://localhost:5173".into())
        );
    }

    #[test]
    fn drops_paths_and_assumes_https() {
        assert_eq!(
            normalize_url("teamos.sentosh.com"),
            Some("https://teamos.sentosh.com".into())
        );
        assert_eq!(
            normalize_url("https://teamos.sentosh.com/dashboard?a=1#b"),
            Some("https://teamos.sentosh.com".into())
        );
        assert_eq!(
            normalize_url("  https://teamos.sentosh.com/  "),
            Some("https://teamos.sentosh.com".into())
        );
    }

    #[test]
    fn rejects_anything_that_is_not_a_web_origin() {
        assert_eq!(normalize_url(""), None);
        assert_eq!(normalize_url("   "), None);
        assert_eq!(normalize_url("javascript://alert(1)"), None);
        assert_eq!(normalize_url("file:///etc/passwd"), None);
        assert_eq!(normalize_url("teamos://auth/callback"), None);
    }
}
