import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadConfig, ROOT, runsDir } from "./config.js";
import { ensureDir, readJson, writeJson } from "./fs.js";

export function makeRunId() {
  return new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14);
}

export function latestRunDir() {
  const root = runsDir();
  if (process.env.STATION_RUN_ID) {
    const runDir = join(root, process.env.STATION_RUN_ID);
    if (!existsSync(runDir)) throw new Error(`Requested run does not exist: ${process.env.STATION_RUN_ID}`);
    return runDir;
  }
  if (!existsSync(root)) return null;
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
  return runs.at(-1) ?? null;
}

export function requireRunDir() {
  const runDir = latestRunDir();
  if (!runDir) throw new Error("No run exists. Start or boot the station first.");
  return runDir;
}

export function createRun(options = {}) {
  const config = loadConfig();
  const root = runsDir();
  ensureDir(root);
  const runId = makeRunId();
  const runDir = join(root, runId);
  ensureDir(runDir);
  const run = {
    runId,
    sessionName: `${config.sessionPrefix}-${runId}`,
    createdAt: new Date().toISOString(),
    configName: config.name,
    locations: config.locations
  };
  const state = {
    runId,
    status: "booted",
    activeCaseId: null,
    activeStageId: null,
    lanes: [],
    nextLaneNumber: 1,
    completedCases: 0,
    failedCases: 0,
    messages: {}
  };
  writeJson(join(runDir, "run.json"), run);
  writeJson(join(runDir, "state.json"), state);
  writeJson(join(runDir, "queue.json"), createQueue(config, options.caseLimit));
  writeJson(join(runDir, "messages.json"), []);
  return { runDir, run, state, config };
}

export function loadRun(runDir = requireRunDir()) {
  // Validate shape on read: a corrupted-but-valid-JSON state file (null, wrong
  // type) would otherwise crash the orchestrator with an opaque TypeError when
  // it indexes the object or array-ops the queue/messages.
  return {
    runDir,
    run: readObjectJson(join(runDir, "run.json"), "run.json"),
    state: readObjectJson(join(runDir, "state.json"), "state.json"),
    queue: readArrayJson(join(runDir, "queue.json"), "queue.json"),
    messages: readArrayJson(join(runDir, "messages.json"), "messages.json")
  };
}

function readObjectJson(path, label) {
  const value = readJson(path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Corrupted ${label} at ${path}: expected a JSON object`);
  }
  return value;
}

function readArrayJson(path, label) {
  const value = readJson(path);
  if (!Array.isArray(value)) {
    throw new Error(`Corrupted ${label} at ${path}: expected a JSON array`);
  }
  return value;
}

export function saveState(runDir, state) {
  writeJson(join(runDir, "state.json"), state);
}

export function saveQueue(runDir, queue) {
  writeJson(join(runDir, "queue.json"), queue);
}

function createQueue(config, caseLimit = null) {
  const manifestPath = config.caseManifest ?? join(ROOT, "eval", "cases.json");
  if (!existsSync(manifestPath)) return [];
  const manifestDir = dirname(manifestPath);
  const cases = readJson(manifestPath);
  if (!Array.isArray(cases)) {
    throw new Error(`Corrupted case manifest at ${manifestPath}: expected a JSON array`);
  }
  const limited = Number.isFinite(caseLimit) && caseLimit > 0 ? cases.slice(0, caseLimit) : cases;
  return limited.map((item, index) => ({
    id: item.id,
    order: index + 1,
    status: "queued",
    attempts: 0,
    folder: resolveManifestPath(item.folder, manifestDir),
    prompt: resolveManifestPath(item.prompt, manifestDir),
    optionalInputs: (item.optionalInputs ?? []).map((path) => resolveManifestPath(path, manifestDir)),
    evaluationMode: item.evaluationMode ?? "prompt-grounded"
  }));
}

function resolveManifestPath(path, baseDir) {
  if (!path) return path;
  return isAbsolute(path) ? path : resolve(baseDir, path);
}
