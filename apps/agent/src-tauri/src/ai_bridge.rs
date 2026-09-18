//! Ask TeamOS on this person's own Claude Code.
//!
//! When the workspace runs Ask TeamOS on "each person's own Claude Code" and
//! the person switched on "Run Claude for TeamOS" in this app, requests they
//! make in the web are picked up here and run with the `claude` CLI already
//! installed on this computer. Claude gets only the TeamOS tools, through a
//! read-only key that is revoked when the answer is handed back: it can look,
//! and propose, but it can't change anything or touch this computer.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::api::{AiJob, Client};
use crate::tracker::Tracker;

const CLAUDE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

fn claude_bin() -> String {
    std::env::var("TEAMOS_CLAUDE_BIN").unwrap_or_else(|_| "claude".into())
}

/// Runs forever: waits for a request while both switches are on.
pub fn run(tracker: Arc<Tracker>) {
    loop {
        match tracker.ai_context() {
            Some(ctx) if ctx.workspace_wants && ctx.allowed => {
                // The server holds the request open for up to 25 s.
                let client = Client::with_timeout(&ctx.api_base, Duration::from_secs(40));
                match client.next_ai_job(&ctx.token) {
                    Ok(Some(job)) => {
                        let outcome = run_job(&client, &ctx.token, &job);
                        let _ = client.ai_result(&ctx.token, &job.id, outcome);
                    }
                    Ok(None) => {}
                    Err(_) => std::thread::sleep(Duration::from_secs(15)),
                }
            }
            _ => std::thread::sleep(Duration::from_secs(10)),
        }
    }
}

/// Waits for one request and runs it (the `--ai-once` debug command).
pub fn run_once(tracker: &Tracker, wait: Duration) -> Result<String, String> {
    let ctx = tracker.ai_context().ok_or("not connected")?;
    let client = Client::with_timeout(&ctx.api_base, Duration::from_secs(40));
    let until = Instant::now() + wait;
    while Instant::now() < until {
        if let Some(job) = client.next_ai_job(&ctx.token).map_err(|e| e.to_string())? {
            let outcome = run_job(&client, &ctx.token, &job);
            let summary = match &outcome {
                Ok(text) => format!("answered ({} chars)", text.len()),
                Err(e) => format!("failed: {e}"),
            };
            client
                .ai_result(&ctx.token, &job.id, outcome)
                .map_err(|e| e.to_string())?;
            return Ok(summary);
        }
    }
    Err("no request arrived".into())
}

fn run_job(client: &Client, device_token: &str, job: &AiJob) -> Result<String, String> {
    let config = serde_json::json!({
        "mcpServers": {
            "teamos": {
                "type": "http",
                "url": job.mcp_url,
                "headers": { "Authorization": format!("Bearer {}", job.token) },
            }
        }
    });
    let path = std::env::temp_dir().join(format!("teamos-mcp-{}.json", job.id));
    std::fs::write(&path, config.to_string()).map_err(|e| e.to_string())?;
    let result = run_claude(client, device_token, job, &path);
    let _ = std::fs::remove_file(&path);
    result
}

fn run_claude(
    client: &Client,
    device_token: &str,
    job: &AiJob,
    config: &std::path::Path,
) -> Result<String, String> {
    let mut command = Command::new(claude_bin());
    command
        .args(["-p", &job.prompt, "--mcp-config"])
        .arg(config)
        .args([
            "--strict-mcp-config",
            "--allowedTools",
            "mcp__teamos__*",
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-turns",
            "40",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashes up while Claude works.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Claude Code isn't installed on this computer".to_string()
        } else {
            e.to_string()
        }
    })?;

    let started = Instant::now();
    let stdout = child.stdout.take().ok_or("no output")?;
    let mut answer: Option<String> = None;
    let mut failure: Option<String> = None;
    let mut steps: Vec<String> = Vec::new();
    let mut last_report = Instant::now();

    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if started.elapsed() > CLAUDE_TIMEOUT {
            let _ = child.kill();
            return Err("Claude took too long and was stopped".into());
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match event["type"].as_str() {
            Some("assistant") => {
                if let Some(parts) = event["message"]["content"].as_array() {
                    for part in parts {
                        if part["type"] == "tool_use" {
                            if let Some(name) = part["name"].as_str() {
                                steps.push(name.trim_start_matches("mcp__teamos__").to_string());
                            }
                        }
                    }
                }
            }
            Some("result") => {
                let ok = event["subtype"] == "success" && event["is_error"] != true;
                let text = event["result"].as_str().unwrap_or_default().to_string();
                if ok {
                    answer = Some(text);
                } else {
                    failure = Some(if text.is_empty() {
                        "Claude stopped".into()
                    } else {
                        text
                    });
                }
            }
            _ => {}
        }
        // Progress in small batches, so the web shows Claude working.
        if !steps.is_empty() && last_report.elapsed() > Duration::from_millis(800) {
            let batch: Vec<String> = std::mem::take(&mut steps);
            let _ = client.ai_progress(device_token, &job.id, &batch);
            last_report = Instant::now();
        }
    }
    if !steps.is_empty() {
        let _ = client.ai_progress(device_token, &job.id, &steps);
    }
    let _ = child.wait();
    match (answer, failure) {
        (Some(text), _) => Ok(text),
        (None, Some(error)) => Err(error),
        (None, None) => {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                use std::io::Read;
                let _ = pipe.read_to_string(&mut stderr);
            }
            let stderr = stderr.trim();
            Err(if stderr.is_empty() {
                "Claude exited without an answer".into()
            } else {
                stderr.chars().take(500).collect()
            })
        }
    }
}
