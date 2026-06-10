import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOT } from "./config.js";
import { writeJson } from "./fs.js";
import { agentRole } from "./layout-config.js";

const TOPOLOGY_PATH = "station-topology.json";

function tmux(args, options = {}) {
  return execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function hasTmux() {
  return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

export function createTmuxStation(runDir, run, config) {
  const visibleAgents = config.agents.filter((agent) => agent.visible !== false);
  if (!hasTmux()) {
    throw new Error("tmux is required to create a visible station session");
  }

  const current = currentTmuxContext();
  if (current) {
    return createBorrowedSessionStation(runDir, current, config);
  }
  return createOwnedSessionStation(runDir, run, config);
}

function createOwnedSessionStation(runDir, run, config) {
  const visibleAgents = config.agents.filter((agent) => agent.visible !== false);
  const session = run.sessionName;
  const [first, ...rest] = visibleAgents;
  const firstPane = tmux(["new-session", "-d", "-s", session, "-n", config.windowName, "-P", "-F", "#{pane_id}", ...agentCommand(first, runDir, config, null)]);
  tmux(["select-pane", "-t", firstPane, "-T", first.name]);
  const panes = {
    [first.name]: paneRecord(firstPane, first, config, null)
  };

  let target = firstPane;
  for (const agent of rest) {
    const split = createAgentPaneWithFallback({ session, target, agent, runDir, config, direction: "-v" });
    tmux(["select-pane", "-t", split.paneId, "-T", agent.name]);
    panes[agent.name] = paneRecord(split.paneId, agent, config, null);
    target = split.paneId;
  }
  tmux(["select-layout", "-t", `${session}:${config.windowName}`, "tiled"]);
  const topology = {
    mode: "owned-session",
    sessionName: session,
    attachTarget: session,
    windowTarget: `${session}:${config.windowName}`,
    leaderPaneId: null,
    managedPaneIds: Object.values(panes).map((pane) => pane.paneId)
  };
  persistStationRuntime(runDir, panes, topology);
  return { panes, topology };
}

function createBorrowedSessionStation(runDir, current, config) {
  const visibleAgents = config.agents.filter((agent) => agent.visible !== false);
  const [first, ...rest] = visibleAgents;
  const sectionDirection = borrowedSectionDirection(config);
  const firstPane = createAgentPaneWithFallback({
    session: current.sessionName,
    target: current.paneId,
    agent: first,
    runDir,
    config,
    direction: "-h",
    fallbackWindowName: config.windowName
  });
  tmux(["select-pane", "-t", firstPane.paneId, "-T", first.name]);
  const panes = {
    [first.name]: paneRecord(firstPane.paneId, first, config, null)
  };

  let target = firstPane.paneId;
  for (const agent of rest) {
    const split = createAgentPaneWithFallback({
      session: current.sessionName,
      target,
      agent,
      runDir,
      config,
      direction: sectionDirection,
      fallbackWindowName: agent.name
    });
    tmux(["select-pane", "-t", split.paneId, "-T", agent.name]);
    panes[agent.name] = paneRecord(split.paneId, agent, config, null);
    target = split.paneId;
  }
  const topology = {
    mode: "borrowed-session",
    sessionName: current.sessionName,
    attachTarget: firstPane.windowTarget === current.windowTarget ? current.windowTarget : firstPane.windowTarget,
    windowTarget: firstPane.windowTarget === current.windowTarget ? current.windowTarget : firstPane.windowTarget,
    leaderPaneId: current.paneId,
    managedPaneIds: Object.values(panes).map((pane) => pane.paneId)
  };
  persistStationRuntime(runDir, panes, topology);
  return { panes, topology };
}

function persistStationRuntime(runDir, panes, topology) {
  writeJson(join(runDir, "panes.json"), panes);
  writeJson(join(runDir, TOPOLOGY_PATH), topology);
}

function createAgentPaneWithFallback({ session, target, agent, runDir, config, direction, fallbackWindowName }) {
  try {
    const paneId = tmux(["split-window", direction, "-p", "50", "-t", target, "-P", "-F", "#{pane_id}", ...agentCommand(agent, runDir, config, null)]);
    return {
      paneId,
      windowTarget: paneWindowTarget(paneId)
    };
  } catch (error) {
    if (!isNoSpaceForNewPane(error)) throw error;
    const paneId = tmux(["new-window", "-d", "-t", session, "-n", fallbackWindowName ?? agent.name, "-P", "-F", "#{pane_id}", ...agentCommand(agent, runDir, config, null)]);
    return {
      paneId,
      windowTarget: paneWindowTarget(paneId)
    };
  }
}

function isNoSpaceForNewPane(error) {
  return /no space for new pane/i.test(String(error?.stderr ?? error?.message ?? ""));
}

export function killSession(sessionName) {
  if (hasTmux()) spawnSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
}

export function killPane(paneId) {
  if (hasTmux()) spawnSync("tmux", ["kill-pane", "-t", paneId], { stdio: "ignore" });
}

export function attachSession(sessionName) {
  return spawnSync("tmux", ["attach", "-t", sessionName], { stdio: "inherit" });
}

export function focusStation(topology) {
  if (!topology) return { status: 1 };
  if (topology.mode === "owned-session" || topology.mode === "terminal-attached-owned-session") {
    return attachSession(topology.sessionName);
  }
  if (process.env.TMUX) {
    return spawnSync("tmux", ["switch-client", "-t", topology.attachTarget], { stdio: "inherit" });
  }
  return attachSession(topology.sessionName);
}

export function readStationTopology(runDir) {
  return JSON.parse(readFileSync(join(runDir, TOPOLOGY_PATH), "utf8"));
}

export function updateStationTopology(runDir, patch) {
  const current = readStationTopology(runDir);
  const next = { ...current, ...patch };
  writeJson(join(runDir, TOPOLOGY_PATH), next);
  return next;
}

export function isPaneAlive(paneId) {
  if (!hasTmux()) return false;
  return spawnSync("tmux", ["display-message", "-p", "-t", paneId, "#{pane_id}"], { stdio: "ignore" }).status === 0;
}

export function respawnAgentPane(runDir, panes, agentName, config, caseFolder = null) {
  const pane = panes[agentName];
  if (!pane) return panes;
  if (!hasTmux()) throw new Error("tmux is required to respawn station panes");
  const agent = config.agents.find((item) => item.name === agentName);
  if (!agent) throw new Error(`Unknown agent pane: ${agentName}`);
  tmux(["respawn-pane", "-k", "-t", pane.paneId, ...agentCommand(agent, runDir, config, caseFolder)]);
  tmux(["select-pane", "-t", pane.paneId, "-T", agent.name]);
  tmux(["clear-history", "-t", pane.paneId]);
  waitForPaneReady(pane.paneId, config.timeouts?.paneReadyMs ?? 15000);
  const updated = {
    ...panes,
    [agentName]: paneRecord(pane.paneId, agent, config, caseFolder)
  };
  writeJson(join(runDir, "panes.json"), updated);
  return updated;
}

export function capturePane(paneId, historyLines = 120) {
  const result = spawnSync("tmux", ["capture-pane", "-p", "-t", paneId, "-S", `-${historyLines}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function agentCommand(agent, runDir, config, caseFolder) {
  const command = agent.kind === "code"
    ? codeAgentCommand(agent, runDir)
    : modelAgentCommand(agent, config);
  const cwd = resolveAgentCwd(agent, config, caseFolder);
  const codexProfile = agent.kind === "model" ? resolveCodexProfile(config, agent) : null;
  return [
    "env",
    `STATION_AGENT_NAME=${agent.name}`,
    `STATION_RUN_DIR=${runDir}`,
    `STATION_ROOT=${ROOT}`,
    `STATION_AGENT_CWD=${cwd}`,
    `STATION_PROVIDER_ROOT=${config.locations.providerRoot ?? ""}`,
    `STATION_RELEASE_ROOT=${config.locations.releaseRoot ?? ""}`,
    `STATION_CONSUMER_ROOT=${config.locations.consumerRoot ?? ""}`,
    `STATION_CONSUMER_INSTALL_TARGET=${config.locations.consumerInstallTarget ?? ""}`,
    `STATION_TARGET_SKILL_NAME=${config.targetSkillName ?? ""}`,
    `STATION_TARGET_SKILL_INSTALL_PATH=${config.locations.targetSkillInstallPath ?? ""}`,
    ...(codexProfile?.model ? [`STATION_CODEX_MODEL=${codexProfile.model}`] : []),
    ...(codexProfile?.model_reasoning_effort ? [`STATION_CODEX_REASONING_EFFORT=${codexProfile.model_reasoning_effort}`] : []),
    "sh",
    "-lc",
    command
  ];
}

function modelAgentCommand(agent, config) {
  if (process.env[config.agentCommandEnv]) return process.env[config.agentCommandEnv];
  const profile = resolveCodexProfile(config, agent);
  return codexAgentCommand(profile);
}

const SAFE_CODEX_OPTION_PATTERN = /^[A-Za-z0-9._:-]+$/;

function assertSafeCodexOption(name, value) {
  if (!SAFE_CODEX_OPTION_PATTERN.test(String(value))) {
    throw new Error(`Unsafe codex ${name} value for shell command: ${JSON.stringify(value)}`);
  }
  return value;
}

function codexAgentCommand(profile = {}) {
  const args = [];
  if (profile.model) args.push(`-m ${assertSafeCodexOption("model", profile.model)}`);
  if (profile.model_reasoning_effort) args.push(`-c model_reasoning_effort="${assertSafeCodexOption("model_reasoning_effort", profile.model_reasoning_effort)}"`);
  const prefix = args.length > 0 ? `${args.join(" ")} ` : "";
  return `CODEX_BIN="\${STATION_CODEX_BIN:-codex}"; exec "$CODEX_BIN" ${prefix}--no-alt-screen -C "$STATION_AGENT_CWD" --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox`;
}

function resolveCodexProfile(config, agent) {
  const runtime = config.codexRuntime ?? {};
  const role = agentRole(agent);
  return {
    ...(runtime.invokerDefault ?? {}),
    ...((role && runtime.roleDefaults?.[role]) ?? {}),
    ...(runtime.agentOverrides?.[agent.name] ?? {}),
    ...(agent.model ? { model: String(agent.model) } : {}),
    ...(agent.model_reasoning_effort ? { model_reasoning_effort: String(agent.model_reasoning_effort) } : {})
  };
}

function codeAgentCommand(agent, runDir) {
  if (agent.role === "orchestrator" || agent.name === "Orchestrator") {
    return orchestratorViewCommand(runDir);
  }
  return stationControlCommand(runDir);
}

function stationControlCommand(runDir) {
  return `while [ ! -f "${runDir}/station.log" ]; do sleep 0.2; done; tail -n 200 -F "${runDir}/station.log" "${runDir}/events.ndjson"`;
}

function orchestratorViewCommand(runDir) {
  return `while true; do clear; node "${join(ROOT, "bin", "station")}" orchestrator-view "${runDir}"; sleep 1; done`;
}

function paneRecord(paneId, agent, config, caseFolder) {
  const codexProfile = agent.kind === "model" ? resolveCodexProfile(config, agent) : null;
  return {
    paneId,
    name: agent.name,
    role: agent.role ?? null,
    kind: agent.kind,
    cwd: resolveAgentCwd(agent, config, caseFolder),
    lifecycle: agent.lifecycle,
    codexRuntime: agent.kind === "model",
    preflightRequired: agent.kind === "model" && !process.env[config.agentCommandEnv],
    codexProfile
  };
}

function resolveAgentCwd(agent, config, caseFolder) {
  const baseCwd = resolveAgentBaseCwd(agent, config, caseFolder);
  if (agent.kind !== "model") return baseCwd;
  const isolated = isolatedAgentWorkdir(baseCwd, agent, caseFolder, config);
  mkdirSync(isolated, { recursive: true });
  return isolated;
}

function resolveAgentBaseCwd(agent, config, caseFolder) {
  switch (agent.cwd) {
    case "providerRoot":
      return config.locations.providerRoot;
    case "consumerRoot":
      return config.locations.consumerRoot;
    case "caseFolder":
      return caseFolder ?? config.locations.consumerRoot ?? ROOT;
    case "stationRoot":
    default:
      return config.locations.stationRoot ?? ROOT;
  }
}

function isolatedAgentWorkdir(baseCwd, agent, caseFolder, config) {
  const role = agentRole(agent) ?? "model";
  const session = sanitizePathSegment(config.sessionPrefix ?? "loop-station");
  const agentName = sanitizePathSegment(agent.name);
  const scopeToken = sanitizePathSegment(caseFolder ? basename(caseFolder) : "runtime");
  const nonce = Date.now().toString(36);
  switch (agent.lifecycle) {
    case "attempt-scoped":
      return join(baseCwd, ".loop-station-agent-workdirs", session, agentName, "attempt", scopeToken, nonce);
    case "case-scoped":
      return join(baseCwd, ".loop-station-agent-workdirs", session, agentName, "case", scopeToken);
    case "run-scoped":
      return join(baseCwd, ".loop-station-agent-workdirs", session, agentName, "run");
    default:
      return join(baseCwd, ".loop-station-agent-workdirs", session, role, nonce);
  }
}

function sanitizePathSegment(value) {
  return String(value ?? "unknown")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function waitForPaneReady(paneId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = capturePane(paneId, 80);
    if (/OpenAI Codex|›|>_/.test(text)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Pane did not become ready: ${paneId}`);
}

function currentTmuxContext() {
  if (!process.env.TMUX) return null;
  const paneTarget = process.env.TMUX_PANE?.trim();
  const args = paneTarget
    ? ["display-message", "-p", "-t", paneTarget, "#S:#I #{pane_id}"]
    : ["display-message", "-p", "#S:#I #{pane_id}"];
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  const [sessionAndWindow = "", paneId = ""] = result.stdout.trim().split(" ");
  const [sessionName, windowIndex] = sessionAndWindow.split(":");
  if (!sessionName || !windowIndex || !paneId.startsWith("%")) return null;
  return {
    sessionName,
    windowTarget: `${sessionName}:${windowIndex}`,
    paneId
  };
}

function paneWindowTarget(paneId) {
  const result = spawnSync("tmux", ["display-message", "-p", "-t", paneId, "#S:#I"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Failed to resolve tmux window for pane ${paneId}`);
  return result.stdout.trim();
}

function borrowedSectionDirection(config) {
  return config.layout?.sectionDirection === "horizontal" ? "-h" : "-v";
}
