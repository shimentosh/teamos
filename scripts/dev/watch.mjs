#!/usr/bin/env node
/**
 * Runs `tsx watch <args>` with stdin detached.
 *
 * tsx watch deadlocks before it ever starts the entry file when its stdin is an
 * open pipe rather than a TTY, which is exactly what `turbo dev` hands a task.
 * The task then produces no output and never binds its port. Detaching stdin
 * avoids the deadlock and keeps hot reload intact.
 */

import { spawn } from "node:child_process";

const child = spawn("tsx", ["watch", ...process.argv.slice(2)], {
  stdio: ["ignore", "inherit", "inherit"],
  shell: process.platform === "win32",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
