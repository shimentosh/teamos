#!/usr/bin/env node
/**
 * Prepares a local dev run so `pnpm dev` is the only command anyone has to type:
 * installs dependencies, creates a usable .env, brings the Postgres container up,
 * and frees the dev ports left behind by a previous run.
 *
 * Escape hatches:
 *   TEAMOS_SKIP_DEV_SETUP=1  skip this script entirely
 *   TEAMOS_KEEP_PORTS=1      report busy dev ports instead of freeing them
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_FILE = join(ROOT, ".env");

const CONTAINER = "teamos-postgres";
const VOLUME = "teamos_postgres_data";
const IMAGE = "postgres:16-alpine";

// The ports `turbo dev` binds: api, web, marketing site, email preview.
// The database port is deliberately absent; it is never force-freed.
const DEV_PORTS = [1337, 5173, 3001, 3002];
const CANDIDATE_DB_PORTS = [5432, 5433, 5434, 5435, 5436];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const isWindows = process.platform === "win32";

function log(message) {
  console.log(`dev › ${message}`);
}

function fail(message) {
  console.error(`dev › ${message}`);
  process.exit(1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(command, args, { shell = false, inherit = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell,
    stdio: inherit ? "inherit" : "pipe",
  });

  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function processName(pid) {
  if (isWindows) {
    const { stdout } = run("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    return stdout.split(",")[0]?.replace(/"/g, "").trim() ?? "";
  }

  const { stdout } = run("ps", ["-p", String(pid), "-o", "comm="]);
  return stdout.trim();
}

/** Listening sockets on a TCP port, with the owning process image name. */
function listenersOnPort(port) {
  const pids = new Set();

  if (isWindows) {
    const { stdout } = run("netstat", ["-ano", "-p", "tcp"]);
    for (const line of stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== "LISTENING") {
        continue;
      }
      if (!columns[1].endsWith(`:${port}`)) {
        continue;
      }
      pids.add(Number(columns[4]));
    }
  } else {
    const { stdout } = run("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    for (const line of stdout.split(/\r?\n/)) {
      if (line.trim()) {
        pids.add(Number(line.trim()));
      }
    }
  }

  return [...pids]
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    .map((pid) => ({ pid, name: processName(pid) }));
}

function killPid(pid) {
  return isWindows
    ? run("taskkill", ["/F", "/PID", String(pid)]).ok
    : run("kill", ["-9", String(pid)]).ok;
}

function ensureDependencies() {
  if (existsSync(join(ROOT, "node_modules"))) {
    return;
  }

  log("node_modules missing, running pnpm install (this takes a few minutes)");
  const result = run("pnpm", ["install"], { shell: isWindows, inherit: true });
  if (!result.ok) {
    fail("pnpm install failed.");
  }
}

function pickDatabasePort() {
  for (const port of CANDIDATE_DB_PORTS) {
    if (listenersOnPort(port).length === 0) {
      return port;
    }
  }
  return CANDIDATE_DB_PORTS.at(-1);
}

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) {
    return;
  }

  const password = randomBytes(12).toString("hex");
  const port = pickDatabasePort();

  // Only the variables a local run actually needs; .env.sample documents the rest.
  writeFileSync(
    ENV_FILE,
    [
      "# Created by scripts/dev/up.mjs on first run. Edit freely; it is gitignored.",
      "# Every other option lives in .env.sample and ENVIRONMENT_SETUP.md.",
      "",
      "KANEO_CLIENT_URL=http://localhost:5173",
      "KANEO_API_URL=http://localhost:1337",
      "",
      `DATABASE_URL=postgresql://kaneo:${password}@localhost:${port}/kaneo`,
      "POSTGRES_DB=kaneo",
      "POSTGRES_USER=kaneo",
      `POSTGRES_PASSWORD=${password}`,
      "",
      "# Keep this stable: changing it invalidates every existing session.",
      `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
      "",
      "# No SMTP locally, so sign in with email + password instead of a mailed code.",
      "DISABLE_EMAIL_OTP_SIGN_IN=true",
      "",
    ].join("\n"),
  );

  log(`wrote .env with a generated AUTH_SECRET and Postgres on port ${port}`);
}

/**
 * Mirrors apps/api/src/database/resolve-database-url.ts so the container we start
 * is always the one the API will connect to.
 */
function resolveDatabase() {
  const file = parseEnvFile(ENV_FILE);
  const read = (key) => process.env[key] || file[key];

  const explicit = read("DATABASE_URL");
  const host = read("POSTGRES_HOST");
  const port = read("POSTGRES_PORT");
  const password = read("POSTGRES_PASSWORD");

  const derived = `postgresql://${encodeURIComponent(
    read("POSTGRES_USER") || "kaneo",
  )}:${encodeURIComponent(password ?? "")}@${host || "postgres"}:${
    port || "5432"
  }/${read("POSTGRES_DB") || "kaneo"}`;

  const connectionString =
    explicit ||
    (password || host || port ? derived : "postgresql://localhost:5432/kaneo");

  const url = new URL(connectionString);

  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, "") || "kaneo",
    username: decodeURIComponent(url.username) || "kaneo",
    password: decodeURIComponent(url.password),
  };
}

function dockerAvailable() {
  return run("docker", ["version", "--format", "{{.Server.Version}}"]).ok;
}

function containerState() {
  const { ok, stdout } = run("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    CONTAINER,
  ]);

  if (!ok) {
    return "missing";
  }
  return stdout === "true" ? "running" : "stopped";
}

function containerHostPort() {
  const { ok, stdout } = run("docker", [
    "inspect",
    "-f",
    '{{range $p := index .HostConfig.PortBindings "5432/tcp"}}{{$p.HostPort}}{{end}}',
    CONTAINER,
  ]);

  return ok && stdout ? Number(stdout) : null;
}

function waitForPostgres(db) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = run("docker", [
      "exec",
      CONTAINER,
      "pg_isready",
      "-U",
      db.username,
      "-d",
      db.database,
    ]);

    if (ready.ok) {
      return true;
    }
    sleep(1000);
  }

  return false;
}

function createContainer(db) {
  // Something else already serves this port - most likely a Postgres the
  // developer installed themselves. Use it rather than fighting over the port.
  const existing = listenersOnPort(db.port);
  if (existing.length > 0) {
    log(
      `port ${db.port} is already served by ${existing[0].name}, using it as the database`,
    );
    return false;
  }

  if (!dockerAvailable()) {
    fail(
      "Docker is not running, so the database cannot start. Start Docker Desktop, or point DATABASE_URL in .env at a Postgres you run yourself.",
    );
  }

  if (!db.password) {
    fail(
      "DATABASE_URL has no password, so the Postgres container cannot be created. Set one in .env.",
    );
  }

  log(`creating the ${CONTAINER} container on port ${db.port}`);
  const created = run("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--restart",
    "unless-stopped",
    "-e",
    `POSTGRES_DB=${db.database}`,
    "-e",
    `POSTGRES_USER=${db.username}`,
    "-e",
    `POSTGRES_PASSWORD=${db.password}`,
    "-p",
    `${db.port}:5432`,
    "-v",
    `${VOLUME}:/var/lib/postgresql/data`,
    IMAGE,
  ]);

  if (!created.ok) {
    fail(`could not create the database container:\n${created.stderr}`);
  }

  return true;
}

function startExistingContainer(db, state) {
  if (!dockerAvailable()) {
    fail(
      "Docker is not running, so the database cannot start. Start Docker Desktop and try again.",
    );
  }

  const mapped = containerHostPort();
  if (mapped && mapped !== db.port) {
    fail(
      `The ${CONTAINER} container publishes port ${mapped} but .env expects ${db.port}. ` +
        `Either point DATABASE_URL back at ${mapped}, or run "docker rm -f ${CONTAINER}" to recreate it (the ${VOLUME} volume keeps your data).`,
    );
  }

  if (state === "stopped") {
    log(`starting the ${CONTAINER} container`);
    const started = run("docker", ["start", CONTAINER]);
    if (!started.ok) {
      fail(`could not start the database container:\n${started.stderr}`);
    }
  }
}

function ensureDatabase(db) {
  if (!LOCAL_HOSTS.has(db.host)) {
    log(`DATABASE_URL points at ${db.host}:${db.port}, leaving it alone`);
    return;
  }

  const state = containerState();

  if (state === "missing") {
    if (!createContainer(db)) {
      return;
    }
  } else {
    startExistingContainer(db, state);
  }

  if (!waitForPostgres(db)) {
    fail(
      `the database did not become ready within 60s. Check "docker logs ${CONTAINER}".`,
    );
  }

  log(`database ready on port ${db.port}`);
}

/**
 * Command lines of every running node process, keyed by pid. Used to tell a
 * leftover TeamOS dev server apart from an unrelated project that happens to
 * sit on one of these ports.
 */
let nodeCommandLines;

function commandLineFor(pid) {
  if (!nodeCommandLines) {
    nodeCommandLines = new Map();

    const { stdout } = isWindows
      ? run("powershell", [
          "-NoProfile",
          "-Command",
          'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }',
        ])
      : run("ps", ["-eo", "pid=,args="]);

    for (const line of stdout.split(/\r?\n/)) {
      const match = isWindows
        ? line.match(/^(\d+)\|(.*)$/)
        : line.trim().match(/^(\d+)\s+(.*)$/);
      if (match) {
        nodeCommandLines.set(Number(match[1]), match[2]);
      }
    }
  }

  return nodeCommandLines.get(pid) ?? "";
}

function belongsToThisRepo(pid) {
  const normalize = (value) => value.replace(/\\/g, "/").toLowerCase();
  return normalize(commandLineFor(pid)).includes(normalize(ROOT));
}

function freeDevPorts() {
  for (const port of DEV_PORTS) {
    for (const { pid, name } of listenersOnPort(port)) {
      // Only reclaim a port from a previous dev run of THIS repo. Anything
      // else belongs to the developer and is reported rather than killed.
      if (!/^node(\.exe)?$/i.test(name) || !belongsToThisRepo(pid)) {
        log(
          `port ${port} is held by ${name} (pid ${pid}) - leaving it running`,
        );
        continue;
      }

      if (process.env.TEAMOS_KEEP_PORTS === "1") {
        log(
          `port ${port} is held by pid ${pid} (TEAMOS_KEEP_PORTS=1, not freeing)`,
        );
        continue;
      }

      log(`freeing port ${port} from a leftover dev server (pid ${pid})`);
      if (!killPid(pid)) {
        log(`could not stop pid ${pid}; port ${port} may still be busy`);
      }
    }
  }
}

function main() {
  if (process.env.TEAMOS_SKIP_DEV_SETUP === "1") {
    return;
  }

  ensureDependencies();
  ensureEnvFile();
  ensureDatabase(resolveDatabase());
  freeDevPorts();

  log("starting web on :5173, api on :1337, site on :3001, email on :3002");
}

main();
