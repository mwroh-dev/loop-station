import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDir, writeJson } from "./fs.js";

export function prepareStationControlFiles(runDir) {
  ensureDir(runDir);
  ensureDir(join(runDir, "locks"));
  for (const file of ["station.log", "events.ndjson"]) {
    const path = join(runDir, file);
    if (!existsSync(path)) writeFileSync(path, "");
  }
}

export function appendStationLog(runDir, message) {
  prepareStationControlFiles(runDir);
  writeFileSync(join(runDir, "station.log"), `[${new Date().toISOString()}] ${message}\n`, { flag: "a" });
}

export function startBackgroundOrchestrator(runDir) {
  prepareStationControlFiles(runDir);
  const stationBin = fileURLToPath(new URL("../bin/station", import.meta.url));
  const out = openSync(join(runDir, "station.log"), "a");
  const child = spawn(process.execPath, [stationBin, "orchestrate", runDir], {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env
  });
  child.unref();
  writeFileSync(join(runDir, "station.pid"), `${child.pid}\n`);
  appendStationLog(runDir, `background orchestrator pid=${child.pid}`);
  return child.pid;
}

export function requestStop(runDir) {
  prepareStationControlFiles(runDir);
  writeFileSync(join(runDir, "locks", "stop-requested"), `${new Date().toISOString()}\n`);
  const pidPath = join(runDir, "station.pid");
  if (!existsSync(pidPath)) return { pid: null, signalSent: false };
  const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
  if (!Number.isFinite(pid)) return { pid: null, signalSent: false };
  try {
    process.kill(pid, "SIGTERM");
    appendStationLog(runDir, `sent SIGTERM to pid=${pid}`);
    return { pid, signalSent: true };
  } catch {
    return { pid, signalSent: false };
  }
}

export async function waitForStop(pid, { timeoutMs = 2000, intervalMs = 50 } = {}) {
  if (!pid) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return !processIsRunning(pid);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeStationSummary(runDir, summary) {
  writeJson(join(runDir, "station-summary.json"), summary);
}
