import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(frontendRoot, "..");
const repositoryRoot = resolve(appRoot, "..");
const virtualenvPython = join(
  repositoryRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const python = process.env.PYTHON ?? (existsSync(virtualenvPython) ? virtualenvPython : "python");
const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

function start(command, args, cwd, name) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `${name} exited${signal ? ` after ${signal}` : ` with code ${code ?? "unknown"}`}.`,
    );
    stop(code && code !== 0 ? code : 1);
  });
  return child;
}

async function waitForBackend(child) {
  const deadline = Date.now() + 30_000;
  let lastError = "health endpoint did not respond";

  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null) {
      throw new Error("The backend exited before becoming ready.");
    }
    try {
      const response = await fetch("http://127.0.0.1:8000/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const health = await response.json();
        if (health.status === "ok") return;
        lastError = `unexpected health response: ${JSON.stringify(health)}`;
      } else {
        lastError = `health endpoint returned HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }

  if (!stopping) {
    throw new Error(
      `Backend did not become healthy on port 8000 within 30 seconds (${lastError}). ` +
        "Install backend/requirements.txt and check that port 8000 is available.",
    );
  }
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try {
  const backend = start(
    python,
    [
      "-m",
      "uvicorn",
      "backend.main:app",
      "--reload",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
    ],
    appRoot,
    "Backend",
  );
  await waitForBackend(backend);
  if (!stopping) {
    console.log("Backend is healthy at http://127.0.0.1:8000; starting Vite.");
    start(
      process.execPath,
      [join(frontendRoot, "node_modules", "vite", "bin", "vite.js")],
      frontendRoot,
      "Vite",
    );
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
