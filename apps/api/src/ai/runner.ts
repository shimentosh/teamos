import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs Claude Code headless on this machine against TeamOS's own MCP
// server. Claude gets only the TeamOS tools (no shell, no files), acting as
// one person through a short-lived key.

const CLAUDE_BIN = process.env.TEAMOS_CLAUDE_BIN || "claude";
const internalApiUrl = (
  process.env.KANEO_INTERNAL_API_URL || "http://127.0.0.1:1337"
)
  .replace(/\/api\/?$/, "")
  .replace(/\/+$/, "");

let available: boolean | null = null;

/** Whether Claude Code is installed where the API runs. Checked once. */
export function claudeCodeAvailable() {
  if (available === null) {
    try {
      const probe = spawnSync(CLAUDE_BIN, ["--version"], {
        timeout: 10_000,
        windowsHide: true,
        encoding: "utf8",
      });
      available = probe.status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

export type RunEvent = { type: "tool"; name: string } | { type: "thinking" };

type StreamLine = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: {
    content?: Array<{ type?: string; name?: string; text?: string }>;
  };
};

export async function runClaudeCode({
  prompt,
  token,
  onEvent,
  timeoutMs = 5 * 60_000,
}: {
  prompt: string;
  token: string;
  onEvent?: (event: RunEvent) => void;
  timeoutMs?: number;
}): Promise<string> {
  const configPath = join(tmpdir(), `teamos-mcp-${randomUUID()}.json`);
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        teamos: {
          type: "http",
          url: `${internalApiUrl}/api/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
    { mode: 0o600 },
  );

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        CLAUDE_BIN,
        [
          "-p",
          prompt,
          "--mcp-config",
          configPath,
          "--strict-mcp-config",
          "--allowedTools",
          "mcp__teamos__*",
          "--output-format",
          "stream-json",
          "--verbose",
          "--max-turns",
          "40",
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Claude took too long and was stopped"));
      }, timeoutMs);

      let buffer = "";
      let result: string | null = null;
      let failed: string | null = null;
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          let event: StreamLine;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "assistant") {
            for (const part of event.message?.content ?? []) {
              if (part.type === "tool_use" && part.name) {
                onEvent?.({
                  type: "tool",
                  name: part.name.replace(/^mcp__teamos__/, ""),
                });
              } else if (part.type === "text") {
                onEvent?.({ type: "thinking" });
              }
            }
          } else if (event.type === "result") {
            if (event.is_error || event.subtype !== "success") {
              failed = event.result || event.subtype || "Claude stopped";
            } else {
              result = event.result ?? "";
            }
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (result !== null) resolve(result);
        else
          reject(
            new Error(
              failed ?? (stderr.trim() || "Claude exited without an answer"),
            ),
          );
      });
    });
  } finally {
    await rm(configPath, { force: true });
  }
}
