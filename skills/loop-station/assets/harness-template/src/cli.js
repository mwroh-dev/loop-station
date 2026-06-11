import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { createRun, loadRun, requireRunDir, saveQueue, saveState } from "./run-store.js";
import { emit } from "./events.js";
import { ensureDir, removePath, writeJson } from "./fs.js";
import { capturePane, createTmuxStation, focusStation, killPane, killSession, readStationTopology, respawnAgentPane, updateStationTopology } from "./tmux-station.js";
import { runOrchestrator } from "./orchestrator.js";
import { prepareStationControlFiles, requestStop, startBackgroundOrchestrator, waitForStop, writeStationSummary } from "./station-control.js";
import { createMessage, inspectMailboxReply, recordMailboxCompletion, transitionMessage } from "./message-lifecycle.js";
import { waitForArtifacts } from "./artifact-awaiter.js";
import { requiredJsonArtifactsForStage, validateStageArtifactSchemasDeclared } from "./artifact-schema.js";
import { runVerifier } from "./verifier.js";
import { pasteMessageToPane } from "./tmux-transport.js";
import { configuredTargetSkills, inspectNamedTargetSkill, inspectTargetSkill, requireTargetSkillInstalled } from "./target-skill.js";
import { discoverSkillProfile, enrichStageContractsWithProfiles } from "./skill-contract-discovery.js";
import { detectCaseFolderChanges, detectRunnerBypassViolations, inspectActionStageAttempt, inspectEvaluatorAttempt, inspectRunnerAttempt, snapshotCaseFolder, validateRunnerForbiddenPatterns } from "./completion.js";
import { applyProviderResponse, inspectProviderResponse, providerResponseAttemptDir } from "./provider-response.js";
import { agentNamesForRole, agentRole, firstAgentNameForRole, hasManagedSectionLayout, reviewRoleNames } from "./layout-config.js";
import { closeAttachedRuntimeTerminal, launchAttachedRuntimeTerminal } from "./terminal-launch.js";
import { codexConfigPath, markProjectsTrusted, missingTrustedRoots } from "./codex-trust.js";
import { waitForModelPanesReady } from "./pane-watcher.js";
import { deployVerifierAgentName, isPresetConfig, isRecoveryLoop, providerEngineerAgentName, validateProfileContract } from "./profiles.js";

const commands = new Map([
  ["boot", boot],
  ["start", start],
  ["status", status],
  ["attach", attach],
  ["stop", stop],
  ["cleanup", cleanup],
  ["validate", validate],
  ["orchestrator-view", orchestratorView],
  ["orchestrate", orchestrate],
  ["run-next", runNext],
  ["run-four", runFour],
  ["report-provider", reportProvider],
  ["provider-response", providerResponse],
  ["smoke-run-one", smokeRunOne]
]);

const ALLOWED_STAGE_ACTORS = new Set([
  "human_user",
  "station_capture_controller",
  "runner_model",
  "skill_runtime",
  "evaluator_model"
]);

export async function main(argv) {
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") return printHelp();
  const handler = commands.get(command);
  if (!handler) {
    printHelp();
    throw new Error(`Unknown command: ${command}`);
  }
  await handler(argv.slice(1));
}

async function boot(argv = []) {
  enforceRunnerGuardPatterns(loadConfig());
  const { runDir, run, state, config } = createRun(parseRunOptions(argv));
  suppressCodexUpdatePrompt();
  prepareStationControlFiles(runDir);
  emit(runDir, "run_created", { runId: run.runId });
  enforceTargetSkillInstalled(runDir, state, config);
  const station = createTmuxStation(runDir, run, config);
  emit(runDir, "tmux_station_created", { sessionName: station.topology.sessionName, paneCount: Object.keys(station.panes).length, mode: station.topology.mode });
  emit(runDir, "station_booted", { sessionName: station.topology.sessionName, mode: station.topology.mode });
  console.log(`Booted ${run.runId}`);
}

async function start() {
  const options = parseRunOptions(process.argv.slice(3));
  const mode = resolveStartMode({ ...options, stdinIsTTY: process.stdin.isTTY });
  const preflightConfig = loadConfig();
  enforceRunnerGuardPatterns(preflightConfig);
  enforceRuntimePolicy(preflightConfig, mode);
  await ensureTrustedCodexRootsForStart(preflightConfig);
  const { runDir, run, state, config } = createRun(options);
  suppressCodexUpdatePrompt();
  prepareStationControlFiles(runDir);
  emit(runDir, "run_created", { runId: run.runId });
  enforceTargetSkillInstalled(runDir, state, config);
  const station = createTmuxStation(runDir, run, config);
  await enforceModelPaneStartup(runDir, station.panes, config);
  emit(runDir, "tmux_station_created", { sessionName: station.topology.sessionName, paneCount: Object.keys(station.panes).length, mode: station.topology.mode });
  const pid = startBackgroundOrchestrator(runDir);
  emit(runDir, "station_start_requested", { mode: "background", pid });
  let topology = station.topology;
  if (mode.attach) {
    emit(runDir, "station_attach_requested", { sessionName: topology.sessionName, mode: topology.mode });
    const visible = await makeRuntimeVisible(runDir, topology);
    if (!visible.ok) {
      throw new Error(`Visible runtime launch failed. Attach manually with: ${visible.attachCommand}. ${visible.reason ?? ""}`.trim());
    }
    topology = visible.topology;
  }
  writeStationSummary(runDir, {
    runId: run.runId,
    sessionName: topology.sessionName,
    pid,
    panes: Object.keys(station.panes),
    paneProfiles: Object.fromEntries(
      Object.entries(station.panes)
        .filter(([, pane]) => pane.codexProfile)
        .map(([name, pane]) => [name, pane.codexProfile])
    ),
    topology: topology.mode,
    attachTarget: topology.attachTarget,
    terminalApp: topology.terminalApp ?? null,
    terminalLaunchMethod: topology.terminalLaunchMethod ?? null,
    terminalWindowId: topology.terminalWindowId ?? null
  });
  console.log(`Started station ${run.runId} pid=${pid}`);
}

async function status() {
  const runDir = requireRunDir();
  const ctx = loadRun(runDir);
  const eventsPath = join(runDir, "events.ndjson");
  const topology = existsSync(join(runDir, "station-topology.json")) ? readStationTopology(runDir) : null;
  console.log(JSON.stringify({
    run: ctx.run,
    topology,
    state: ctx.state,
    queue: ctx.queue,
    messages: ctx.messages,
    recentEvents: existsSync(eventsPath) ? readFileSync(eventsPath, "utf8").trim().split("\n").slice(-10).map((line) => JSON.parse(line)) : []
  }, null, 2));
}

async function attach() {
  const runDir = requireRunDir();
  const topology = readStationTopology(runDir);
  const attached = focusStation(topology);
  if (attached.status !== 0) throw new Error(`tmux focus failed for ${topology.attachTarget}`);
}

async function stop() {
  const runDir = requireRunDir();
  ensureDir(join(runDir, "locks"));
  const stop = requestStop(runDir);
  emit(runDir, "station_stop_requested", stop);
  console.log(`Stop requested${stop.pid ? ` for pid=${stop.pid}` : ""}.`);
}

async function cleanup() {
  const runDir = requireRunDir();
  const topology = readStationTopology(runDir);
  if (["owned-session", "terminal-attached-owned-session"].includes(topology.mode)) {
    killSession(topology.sessionName);
    if (topology.mode === "terminal-attached-owned-session") {
      closeAttachedRuntimeTerminal(topology);
    }
  } else {
    for (const paneId of topology.managedPaneIds ?? []) killPane(paneId);
  }
  const stop = requestStop(runDir);
  if (stop.pid) {
    const stopped = await waitForStop(stop.pid);
    if (!stopped) {
      try {
        process.kill(stop.pid, "SIGKILL");
      } catch {}
      await waitForStop(stop.pid, { timeoutMs: 1000, intervalMs: 50 });
    }
  }
  emit(runDir, "cleanup_requested", stop);
  removePath(join(runDir, "locks"));
  console.log(`Cleaned station runtime and locks.`);
}

async function validate(argv) {
  const json = argv.includes("--json");
  const skipTools = argv.includes("--skip-tools");
  const report = validateStation({ skipTools });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printValidationReport(report);
  }
  if (!report.ok) process.exitCode = 1;
}

async function orchestratorView(argv) {
  const runDir = argv[0] ?? process.env.STATION_RUN_DIR;
  if (!runDir) throw new Error("Usage: station orchestrator-view <run-dir>");
  const ctx = loadRun(runDir);
  ensureLaneState(ctx.state);
  const grouped = Object.groupBy(ctx.queue, (item) => item.status);
  const summary = {
    runId: ctx.run.runId,
    status: ctx.state.status,
    lanes: ctx.state.lanes,
    queue: Object.fromEntries(Object.entries(grouped).map(([key, value]) => [key, value.length])),
    completedCases: ctx.state.completedCases,
    failedCases: ctx.state.failedCases
  };
  console.log(JSON.stringify(summary, null, 2));
}

function validateStation({ skipTools = false } = {}) {
  const checks = {};
  let config;
  try {
    config = loadConfig();
    checks.config = { ok: true, path: process.env.STATION_CONFIG ?? "station.json" };
  } catch (error) {
    return {
      ok: false,
      checks: {
        config: { ok: false, reason: error.message }
      }
    };
  }

  checks.caseManifest = validateCaseManifest(config);
  checks.profile = validateProfile(config);
  checks.targetSkill = validateTargetSkill(config);
  checks.actionStages = validateActionStages(config);
  checks.runnerGuards = validateRunnerGuards(config);
  checks.observer = validateObserver(config);
  checks.agents = validateAgents(config);
  checks.tools = skipTools ? { ok: true, skipped: true } : validateTools();
  return {
    ok: Object.values(checks).every((check) => check.ok),
    checks
  };
}

function validateRunnerGuards(config) {
  const result = validateRunnerForbiddenPatterns(config.runnerForbiddenPatterns ?? []);
  return result.ok
    ? { ok: true }
    : { ok: false, reason: "runner_guard_pattern_invalid", invalid: result.invalid };
}

function enforceRunnerGuardPatterns(config) {
  const check = validateRunnerGuards(config);
  if (!check.ok) {
    throw new Error(`runner_guard_pattern_invalid: ${check.invalid.map((item) => `${item.index}:${item.error}`).join(", ")}`);
  }
}

function validateActionStages(config) {
  if (!isActionPipeline(config)) return { ok: true, skipped: true };
  const stages = orderedActionStages(config);
  const missingSkill = stages.find((stage) => !stage.skill);
  if (missingSkill) {
    return { ok: false, reason: "generic_action_stage_forbidden", stageId: missingSkill.id };
  }
  for (const stage of stages) {
    const target = inspectNamedTargetSkill({
      name: stage.skill,
      installPath: stage.installPath
    });
    if (!target.ok) {
      return {
        ok: false,
        reason: "stage_skill_invalid",
        stageId: stage.id,
        skill: stage.skill,
        detail: target.reason
      };
    }
    const declared = validateStageArtifactSchemasDeclared(stage);
    if (!declared.ok) {
      return {
        ok: false,
        reason: "missing_artifact_schema",
        stageId: stage.id,
        missing: declared.missing
      };
    }
    const authority = validateStageAuthorityContract(stage);
    if (!authority.ok) {
      return {
        ok: false,
        reason: "stage_authority_contract_invalid",
        stageId: stage.id,
        violations: authority.violations
      };
    }
  }
  return {
    ok: true,
    stages: stages.map((stage) => ({
      id: stage.id,
      skill: stage.skill,
      requiredJsonArtifacts: requiredJsonArtifactsForStage(stage)
    }))
  };
}

function validateStageAuthorityContract(stage) {
  if (!("phaseContracts" in stage)) return { ok: true, violations: [] };
  const phases = stage.phaseContracts;
  const violations = [];
  if (!Array.isArray(phases) || phases.length === 0) {
    return { ok: false, violations: ["phaseContracts must be a non-empty array"] };
  }
  phases.forEach((phase, index) => {
    if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
      violations.push(`phaseContracts[${index}] must be an object`);
      return;
    }
    if (typeof phase.id !== "string" || phase.id.trim() === "") {
      violations.push(`phaseContracts[${index}].id missing`);
    }
    if (phase.allowedActor !== undefined && !ALLOWED_STAGE_ACTORS.has(phase.allowedActor)) {
      violations.push(`phaseContracts[${index}].allowedActor invalid: ${phase.allowedActor}`);
    }
  });
  if (phases.some(isHumanManualCapturePhase) && !hasAwaitingCaptureCheckpoint(stage)) {
    violations.push("manual capture requires awaiting_capture human checkpoint");
  }
  return {
    ok: violations.length === 0,
    violations
  };
}

function isHumanManualCapturePhase(phase) {
  return phase && typeof phase === "object" && (
    phase.allowedActor === "human_user"
    || phase.captureMode === "human_manual"
    || phase.checkpoint === "awaiting_capture"
  );
}

function hasAwaitingCaptureCheckpoint(stage) {
  return (stage.humanCheckpoints ?? []).some((checkpoint) => (
    checkpoint?.id === "awaiting_capture"
    || checkpoint?.checkpoint === "awaiting_capture"
  ));
}

function validateCaseManifest(config) {
  const path = config.caseManifest;
  if (!path || !existsSync(path)) return { ok: false, path, reason: "case_manifest_missing" };
  try {
    const cases = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(cases)) return { ok: false, path, reason: "case_manifest_not_array" };
    const manifestDir = dirname(path);
    const invalid = cases.find((item) => !item.id || !item.folder || !item.prompt);
    if (invalid) return { ok: false, path, reason: "case_missing_required_fields", caseId: invalid.id ?? null };
    const missing = cases.find((item) => !existsSync(resolveManifestPath(item.folder, manifestDir)) || !existsSync(resolveManifestPath(item.prompt, manifestDir)));
    if (missing) return { ok: false, path, reason: "case_path_missing", caseId: missing.id };
    return { ok: true, path, caseCount: cases.length };
  } catch (error) {
    return { ok: false, path, reason: "case_manifest_invalid_json", error: error.message };
  }
}

function resolveManifestPath(path, baseDir) {
  if (!path) return path;
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

function validateTargetSkill(config) {
  return inspectTargetSkill(config);
}

function validateProfile(config) {
  return validateProfileContract(config);
}

function validateAgents(config) {
  const agents = Array.isArray(config.agents) ? config.agents : [];
  const reviewers = agents.filter((agent) => agentRole(agent) === "judgment");
  if (reviewers.length === 0) return { ok: false, reason: "missing_required_agent", agentName: "JudgmentAgent-Model|EvaluatorAgent-Model|JudgeAgent-Model" };
  const invalid = reviewers.find((agent) => agent.execution !== "model" || agent.visible === false || !(agent.inputs ?? []).includes("EVALUATE_CASE"));
  if (invalid) {
    return { ok: false, reason: "invalid_required_agent", agentName: invalid.name };
  }
  return { ok: true, required: reviewers.map((agent) => agent.name) };
}

function validateObserver(config) {
  const agents = Array.isArray(config.agents) ? config.agents : [];
  const stationControl = agents.find((agent) => (
    agent.execution === "script"
    && agent.visible !== false
    && (agent.name === "StationControl" || agentRole(agent) === "station_control")
  ));
  if (!stationControl) {
    return { ok: false, reason: "missing_required_observer", agentName: "StationControl" };
  }
  return {
    ok: true,
    observer: "deterministic",
    agentName: stationControl.name
  };
}

function validateTools() {
  const tools = ["tmux", "codex"];
  const results = Object.fromEntries(tools.map((tool) => [tool, commandExists(tool)]));
  return {
    ok: Object.values(results).every(Boolean),
    tools: results
  };
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0;
}

function printValidationReport(report) {
  console.log(`Loop Station validation: ${report.ok ? "ok" : "failed"}`);
  for (const [name, check] of Object.entries(report.checks)) {
    console.log(`- ${name}: ${check.ok ? "ok" : `failed (${check.reason ?? "unknown"})`}`);
  }
}

async function orchestrate(argv) {
  const runDir = argv[0] ?? process.env.STATION_RUN_DIR;
  if (!runDir) throw new Error("Usage: station orchestrate <run-dir>");
  await runOrchestrator(runDir);
}

async function runNext(argv) {
  const dispatchOnly = argv.includes("--dispatch-only");
  const result = await dispatchNextCase({ dispatchOnly });
  if (!result) {
    console.log("No case dispatched.");
    return;
  }
  console.log(`Dispatched ${result.caseId} attempt ${result.attempt}${dispatchOnly ? " (dispatch-only)" : ""}`);
}

async function runFour(argv) {
  const dispatchOnly = argv.includes("--dispatch-only");
  const results = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await dispatchNextCase({ dispatchOnly });
    if (!result) break;
    results.push(result);
  }
  console.log(`Dispatched ${results.length} case(s)${dispatchOnly ? " (dispatch-only)" : ""}`);
}

async function dispatchNextCase({ dispatchOnly }) {
  const runDir = requireRunDir();
  const config = loadConfig();
  if (hasManagedSectionLayout(config)) {
    return dispatchNextCaseManaged(runDir, config, { dispatchOnly });
  }
  let ctx = loadRun(runDir);
  enforceTargetSkillInstalled(runDir, ctx.state, config);
  if (await tickRun(runDir, { dispatchOnly })) {
    ctx = loadRun(runDir);
  }
  if (isActionPipeline(config)) {
    if (ctx.state.activeCaseId || ctx.queue.some((item) => item.status === "active")) {
      emit(runDir, "sequential_gate_blocked", { activeCaseId: ctx.state.activeCaseId });
      return null;
    }
    const queueItem = ctx.queue.find((item) => item.status === "queued" || item.status === "rerun_queued");
    if (!queueItem) return null;
    return dispatchNextActionPipelineCase(runDir, ctx, config, queueItem, { dispatchOnly });
  }
  if (ctx.state.activeCaseId || ctx.queue.some((item) => item.status === "active")) {
    emit(runDir, "sequential_gate_blocked", { activeCaseId: ctx.state.activeCaseId });
    return null;
  }
  const queueItem = ctx.queue.find((item) => item.status === "queued" || item.status === "rerun_queued");
  if (!queueItem) return null;
  const attempt = queueItem.attempts + 1;
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
  ensureDir(attemptDir);
  writeJson(join(attemptDir, "case-folder-before.json"), snapshotCaseFolder(queueItem.folder));
  const requiredOutputs = {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json")
  };
  const targetSkills = configuredTargetSkills(config).map((skill) => ({
    name: skill.targetSkillName,
    slug: skill.slug,
    installPath: skill.installPath
  }));
  const promptText = queueItem.prompt && existsSync(queueItem.prompt) ? readFileSync(queueItem.prompt, "utf8") : "";
  const skillProfiles = targetSkills.map((skill) => discoverSkillProfile({
    name: skill.name,
    installPath: skill.installPath,
    requestText: promptText
  }));
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: runnerAgentName(config),
    type: "RUN_SKILL_CASE",
    caseId: queueItem.id,
    attempt,
    stageId: "run",
    body: {
      case: queueItem,
      promptPath: queueItem.prompt,
      optionalInputs: queueItem.optionalInputs,
      loopProfile: config.loopProfile ?? null,
      targetSkillName: config.targetSkillName,
      targetSkills,
      skillProfiles,
      stageContracts: enrichStageContractsWithProfiles(stageContracts(config, targetSkills), skillProfiles, promptText),
      consumerRoot: ctx.run.locations.consumerRoot,
      consumerInstallTarget: ctx.run.locations.consumerInstallTarget,
      targetSkillInstallPath: ctx.run.locations.targetSkillInstallPath,
      providerRoot: ctx.run.locations.providerRoot,
      releaseRoot: ctx.run.locations.releaseRoot,
      outputDir: attemptDir,
      requiredOutputs,
      rule: `Execute this case by invoking ${config.targetSkillName ?? "the configured target skill"} inside the Codex session from consumerRoot. Do not bypass that Codex skill invocation with provider entrypoints, wrappers, legacy launchers, or installers. Write required artifacts, then stop.`
    },
    artifactPaths: Object.values(requiredOutputs)
  });
  writeJson(join(attemptDir, "dispatch.json"), message);

  queueItem.status = "active";
  queueItem.attempts = attempt;
  ctx.state.activeCaseId = queueItem.id;
  ctx.state.activeStageId = "run";
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  transitionMessage(runDir, message.id, "pending");

  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, config, message, message.to, queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${message.to}`);
  }

  emit(runDir, "case_dispatched", { caseId: queueItem.id, attempt, messageId: message.id, dispatchOnly });
  return { caseId: queueItem.id, attempt, messageId: message.id };
}

function isActionPipeline(config) {
  return config.pipelineMode === "action-stages" && Array.isArray(config.stageContracts) && config.stageContracts.length > 0;
}

function orderedActionStages(config) {
  return Array.isArray(config.stageContracts) ? config.stageContracts : [];
}

function stageById(config, stageId) {
  return orderedActionStages(config).find((stage) => stage.id === stageId) ?? null;
}

function stageAgentName(config, stage) {
  return stage.agentName ?? firstAgentNameForRole(config, stage.agentRole ?? stage.role ?? "runner") ?? "RunnerAgent-Model";
}

function evaluatorAgentName(config) {
  return firstAgentNameForRole(config, "evaluator") ?? "EvaluatorAgent-Model";
}

function runnerAgentName(config) {
  return firstAgentNameForRole(config, "runner") ?? "RunnerAgent-Model";
}

function attemptDirForCase(runDir, queueItem) {
  return join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
}

function stageDirForCase(runDir, queueItem, stageId) {
  return join(attemptDirForCase(runDir, queueItem), "stages", stageId);
}

function materializeStageArtifacts(stageDir, stage) {
  const requiredOutputs = {
    runnerReport: join(stageDir, "runner-report.md"),
    runnerMetadata: join(stageDir, "runner-metadata.json"),
    outputManifest: join(stageDir, "output-manifest.json")
  };
  const requiredArtifacts = new Set(Object.values(requiredOutputs));
  for (const fileName of stage.requiredArtifacts ?? []) {
    requiredArtifacts.add(join(stageDir, fileName));
  }
  return {
    requiredOutputs,
    requiredArtifacts: [...requiredArtifacts]
  };
}

function promptTextForCase(queueItem) {
  return queueItem.prompt && existsSync(queueItem.prompt) ? readFileSync(queueItem.prompt, "utf8").trim() : `Read the prompt file at ${queueItem.prompt}`;
}

function upstreamArtifactsForStage(config, runDir, queueItem, stageId) {
  const currentIndex = orderedActionStages(config).findIndex((stage) => stage.id === stageId);
  if (currentIndex <= 0) return [];
  return orderedActionStages(config)
    .slice(0, currentIndex)
    .map((stage) => ({ stageId: stage.id, path: stageDirForCase(runDir, queueItem, stage.id) }));
}

async function dispatchNextActionPipelineCase(runDir, ctx, config, queueItem, { dispatchOnly }) {
  const attempt = queueItem.attempts + 1;
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
  ensureDir(attemptDir);
  writeJson(join(attemptDir, "case-folder-before.json"), snapshotCaseFolder(queueItem.folder));
  queueItem.status = "active";
  queueItem.attempts = attempt;
  ctx.state.activeCaseId = queueItem.id;
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  return startSequentialActionStage(runDir, ctx, config, queueItem, orderedActionStages(config)[0], { dispatchOnly });
}

async function startSequentialActionStage(runDir, ctx, config, queueItem, stage, { dispatchOnly }) {
  if (!stage) return null;
  const stageDir = stageDirForCase(runDir, queueItem, stage.id);
  ensureDir(stageDir);
  const { requiredOutputs, requiredArtifacts } = materializeStageArtifacts(stageDir, stage);
  const promptText = promptTextForCase(queueItem);
  const agentName = stageAgentName(config, stage);
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: stage.messageType ?? "RUN_ACTION_STAGE",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: stage.id,
    body: {
      case: queueItem,
      promptPath: queueItem.prompt,
      promptText,
      optionalInputs: queueItem.optionalInputs,
      stage,
      input: stage.input,
      instructions: stage.instructions ?? [],
      consumerRoot: ctx.run.locations.consumerRoot,
      outputRoot: ctx.run.locations.outputRoot ?? config.locations.outputRoot ?? null,
      attemptDir: attemptDirForCase(runDir, queueItem),
      stageDir,
      upstreamArtifacts: upstreamArtifactsForStage(config, runDir, queueItem, stage.id),
      requiredOutputs,
      requiredArtifacts,
      stageContracts: [stage],
      rule: `Execute only the ${stage.id} stage for this case, write the required artifacts, then stop.`
    },
    artifactPaths: requiredArtifacts
  });
  writeJson(join(stageDir, "dispatch.json"), message);
  ctx.state.activeStageId = stage.id;
  saveState(runDir, ctx.state);
  transitionMessage(runDir, message.id, "pending");

  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, config, message, agentName, queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${agentName}`);
  }

  emit(runDir, "action_stage_dispatched", {
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: stage.id,
    agentName,
    messageId: message.id,
    dispatchOnly
  });
  return { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id };
}

async function advanceCompletedActionStage(runDir, ctx, config, { dispatchOnly = false } = {}) {
  const activeCaseId = ctx.state.activeCaseId;
  if (!activeCaseId) return false;
  const queueItem = ctx.queue.find((item) => item.id === activeCaseId);
  const stage = stageById(config, ctx.state.activeStageId);
  if (!queueItem || queueItem.status !== "active" || !stage || queueItem.attempts < 1) return false;
  const attemptDir = attemptDirForCase(runDir, queueItem);
  const stageDir = stageDirForCase(runDir, queueItem, stage.id);
  const stageMessage = activeCaseMessage(ctx.messages, queueItem, stage.messageType ?? "RUN_ACTION_STAGE", stage.id);
  if (stageMessage && transportFailedState(stageMessage.state)) {
    if (!shouldFailFastActivation(config)) {
      const recovery = await recoverActivationFailure(runDir, config, stageMessage, stageMessage.to, queueItem.folder);
      if (!recovery.failed) return true;
      stageMessage.id = recovery.message?.id ?? stageMessage.id;
      stageMessage.state = recovery.message?.state ?? stageMessage.state;
      stageMessage.signals = recovery.message?.signals ?? stageMessage.signals;
      stageMessage.failureReason = recovery.message?.failureReason ?? stageMessage.failureReason;
    }
    failActionPipelineCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_transport_failed",
      guardViolations: [
        `message ${stageMessage.id} for ${stageMessage.to} failed before execution start`,
        `message state: ${stageMessage.state}`,
        `signals: ${(stageMessage.signals ?? []).join(", ") || "(none)"}`,
        `failureReason: ${stageMessage.failureReason ?? "(none)"}`
      ],
      required: requiredRunnerArtifacts(stageDir)
    });
    return true;
  }

  const caseFolderGuard = detectActiveCaseFolderChanges(attemptDir, queueItem);
  if (caseFolderGuard.length > 0) {
    failActionPipelineCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "case_folder_modified",
      guardViolations: caseFolderGuard,
      required: requiredRunnerArtifacts(stageDir)
    });
    return true;
  }

  const transcriptGuard = detectRunnerBypassForAgent(runDir, stageAgentName(config, stage), ctx, stage);
  if (transcriptGuard.length > 0) {
    failActionPipelineCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_bypass_transcript_detected",
      guardViolations: transcriptGuard,
      required: requiredRunnerArtifacts(stageDir)
    });
    return true;
  }

  const completion = inspectActionStageAttempt(stageDir, stage, runnerGuardOptions(ctx));
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(stageMessage);
  if (!reply.complete) return false;
  recordMailboxCompletion(runDir, stageMessage, "RUNNER_DONE", reply.payload);
  if (!completion.passed) {
    failActionPipelineCase(runDir, ctx, queueItem, completion);
    return true;
  }
  if (reply.payload.status !== "done") {
    failActionPipelineCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_reply_status_mismatch",
      guardViolations: [`runner mailbox reply status was ${reply.payload.status}`],
      required: requiredRunnerArtifacts(stageDir)
    });
    return true;
  }

  const stages = orderedActionStages(config);
  const index = stages.findIndex((item) => item.id === stage.id);
  const nextStage = stages[index + 1] ?? null;
  if (nextStage) {
    await startSequentialActionStage(runDir, ctx, config, queueItem, nextStage, { dispatchOnly });
    return true;
  }

  await startActionPipelineEvaluationStage(runDir, ctx, config, queueItem, { dispatchOnly });
  return true;
}

async function startActionPipelineEvaluationStage(runDir, ctx, config, queueItem, { dispatchOnly }) {
  const attemptDir = attemptDirForCase(runDir, queueItem);
  const existing = ctx.messages.find((message) => (
    message.to === evaluatorAgentName(config)
    && message.type === "EVALUATE_CASE"
    && message.caseId === queueItem.id
    && message.attempt === queueItem.attempts
  ));
  if (existing) return false;

  const stages = orderedActionStages(config);
  const finalStage = stages.at(-1);
  const finalStageDir = finalStage ? stageDirForCase(runDir, queueItem, finalStage.id) : attemptDir;
  const requiredOutputs = {
    evalReport: join(attemptDir, "eval-report.md"),
    evalVerdict: join(attemptDir, "eval-verdict.json")
  };
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: evaluatorAgentName(config),
    type: "EVALUATE_CASE",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: "evaluate-run",
    body: {
      case: queueItem,
      attemptDir,
      promptPath: queueItem.prompt,
      stageEvidencePaths: stages.map((item) => ({ stageId: item.id, path: stageDirForCase(runDir, queueItem, item.id) })),
      evidencePaths: {
        runnerReport: join(finalStageDir, "runner-report.md"),
        runnerMetadata: join(finalStageDir, "runner-metadata.json"),
        outputManifest: join(finalStageDir, "output-manifest.json"),
        dispatch: join(finalStageDir, "dispatch.json")
      },
      requiredOutputs,
      targetSkills: [],
      skillProfiles: [],
      loopProfile: config.loopProfile ?? null,
      rule: "Evaluate the full action-stage artifact chain. Pass only when staged outputs and evidence are credible."
    },
    artifactPaths: Object.values(requiredOutputs)
  });
  writeJson(join(attemptDir, "evaluation-dispatch.json"), message);
  ctx.state.activeStageId = "evaluate-run";
  saveState(runDir, ctx.state);
  transitionMessage(runDir, message.id, "pending");
  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, config, message, evaluatorAgentName(config), queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${evaluatorAgentName(config)}`);
  }
  emit(runDir, "evaluation_dispatched", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, dispatchOnly, stageId: "evaluate-run" });
  return true;
}

function failActionPipelineCase(runDir, ctx, queueItem, completion) {
  const attemptDir = attemptDirForCase(runDir, queueItem);
  writeLoopStationFailure(attemptDir, queueItem, completion);
  queueItem.status = completion.reason === "needs_human" ? "needs_human" : "case_failed_final";
  ctx.state.activeCaseId = null;
  ctx.state.activeStageId = null;
  ctx.state.failedCases += 1;
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  emit(runDir, "case_failed_final", { caseId: queueItem.id, attempt: queueItem.attempts, reason: completion.reason });
}

function stageContracts(config, targetSkills) {
  if (Array.isArray(config.stageContracts) && config.stageContracts.length > 0) {
    return config.stageContracts.map((stage) => enrichStageContractWithTarget(stage, targetSkills));
  }
  return targetSkills.map((skill) => ({
    id: skill.slug,
    skill: skill.name,
    installPath: skill.installPath,
    sourcePath: skill.sourcePath ?? null,
    providerRoot: skill.providerRoot ?? null,
    input: "Use the assigned case prompt and optional inputs.",
    outputs: [],
    evidence: ["public skill invocation", "required station artifacts"],
    handoffArtifact: null
  }));
}

function enrichStageContractWithTarget(stage, targetSkills) {
  const stageSkillSlug = String(stage.skill ?? "").replace(/^\$/, "");
  const target = targetSkills.find((skill) => skill.name === stage.skill || skill.slug === stageSkillSlug);
  if (!target) return stage;
  return {
    ...stage,
    installPath: stage.installPath ?? target.installPath,
    sourcePath: stage.sourcePath ?? target.sourcePath ?? null,
    providerRoot: stage.providerRoot ?? target.providerRoot ?? null,
    handoffArtifact: stage.handoffArtifact ?? null
  };
}

async function dispatchNextCaseManaged(runDir, config, { dispatchOnly }) {
  let ctx = loadRun(runDir);
  ensureLaneState(ctx.state);
  enforceTargetSkillInstalled(runDir, ctx.state, config);
  const changed = await tickManagedRun(runDir, config, { dispatchOnly });
  if (changed) ctx = loadRun(runDir);
  ensureLaneState(ctx.state);
  if (isPresetConfig(config) && presetCaseStillActive(ctx.queue)) {
    emit(runDir, "sequential_gate_blocked", { activePresetCase: true });
    return null;
  }

  const freeRunner = firstFreeAgent(config, "runner", ctx.state.lanes);
  if (!freeRunner) {
    emit(runDir, "runner_capacity_blocked", { lanes: ctx.state.lanes.length });
    return null;
  }
  const queueItem = ctx.queue.find((item) => item.status === "queued" || item.status === "rerun_queued");
  if (!queueItem) return null;
  return startManagedRunLane(runDir, ctx, config, queueItem, freeRunner, { dispatchOnly });
}

function ensureLaneState(state) {
  state.lanes ??= [];
  state.nextLaneNumber ??= 1;
  syncLegacySummaryState(state);
}

function syncLegacySummaryState(state) {
  const firstLane = state.lanes[0] ?? null;
  state.activeCaseId = firstLane?.caseId ?? null;
  state.activeStageId = firstLane?.stageId ?? null;
}

function nextLaneId(state) {
  const id = `lane-${state.nextLaneNumber}`;
  state.nextLaneNumber += 1;
  return id;
}

function firstFreeAgent(config, role, lanes) {
  const names = role === "review"
    ? reviewRoleNames(config)
    : agentNamesForRole(config, role);
  const busy = new Set(lanes
    .filter((lane) => (
      lane.role === role
      || (role === "review" && ["judgment", "judge", "evaluator"].includes(lane.role))
    ))
    .map((lane) => lane.agentName));
  return names.find((name) => !busy.has(name)) ?? null;
}

function runtimeAutoDispatch(config) {
  return config.runtime?.autoDispatch === true;
}

function transportPolicy(config) {
  return config.runtimePolicy?.transportPolicy ?? {};
}

function activationFailurePolicy(config) {
  return transportPolicy(config).activationFailurePolicy ?? "recycle_once";
}

function shouldFailFastActivation(config) {
  return activationFailurePolicy(config) === "fail_fast";
}

function readPanes(runDir) {
  return JSON.parse(readFileSync(join(runDir, "panes.json"), "utf8"));
}

function readMessage(runDir, messageId) {
  return loadRun(runDir).messages.find((message) => message.id === messageId) ?? null;
}

function shouldRespawnBeforeDispatch(panes, agentName, forceRespawn = false) {
  if (forceRespawn) return true;
  return panes[agentName]?.lifecycle === "attempt-scoped";
}

async function submitMessageToAgent(runDir, config, message, agentName, caseFolder, { forceRespawn = false } = {}) {
  let panes = readPanes(runDir);
  if (shouldRespawnBeforeDispatch(panes, agentName, forceRespawn)) {
    panes = await respawnAgentPane(runDir, panes, agentName, config, caseFolder);
  }
  return pasteMessageToPane(runDir, panes, message, submissionTimeouts(config));
}

async function recoverActivationFailure(runDir, config, message, agentName, caseFolder) {
  const attempts = Number(message.activationRecoveryAttempts ?? 0);
  if (activationFailurePolicy(config) !== "recycle_once" || attempts >= 1) {
    return { recovered: false, failed: true, message };
  }
  transitionMessage(runDir, message.id, "pending", {
    activationRecoveryAttempts: attempts + 1,
    activationRecoveryPolicy: "recycle_once",
    lastActivationRecoveryAt: new Date().toISOString()
  });
  const refreshed = readMessage(runDir, message.id) ?? message;
  const submitted = await submitMessageToAgent(runDir, config, refreshed, agentName, caseFolder, { forceRespawn: true });
  const nextMessage = readMessage(runDir, message.id) ?? refreshed;
  if (!submitted.ok && transportFailedState(nextMessage.state)) {
    return { recovered: false, failed: true, message: nextMessage };
  }
  return { recovered: true, failed: false, message: nextMessage };
}

function persistManagedState(runDir, ctx) {
  syncLegacySummaryState(ctx.state);
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
}

function createLane(state, lane) {
  const record = { id: nextLaneId(state), ...lane };
  state.lanes.push(record);
  syncLegacySummaryState(state);
  return record;
}

function removeLane(state, laneId) {
  state.lanes = state.lanes.filter((lane) => lane.id !== laneId);
  syncLegacySummaryState(state);
}

function laneForCase(state, caseId, stageId = null) {
  return state.lanes.find((lane) => lane.caseId === caseId && (stageId ? lane.stageId === stageId : true));
}

function runnerAttemptDir(runDir, queueItem) {
  return join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
}

async function startManagedRunLane(runDir, ctx, config, queueItem, agentName, { dispatchOnly }) {
  const attempt = queueItem.attempts + 1;
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
  ensureDir(attemptDir);
  writeJson(join(attemptDir, "case-folder-before.json"), snapshotCaseFolder(queueItem.folder));
  const message = buildRunMessage(runDir, ctx, config, queueItem, attempt, attemptDir, agentName);
  writeJson(join(attemptDir, "dispatch.json"), message);
  queueItem.status = "active_run";
  queueItem.attempts = attempt;
  const lane = createLane(ctx.state, {
    role: "runner",
    agentName,
    caseId: queueItem.id,
    attempt,
    stageId: "run",
    messageId: message.id
  });
  persistManagedState(runDir, ctx);
  transitionMessage(runDir, message.id, "pending");
  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, config, message, agentName, queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${agentName}`);
  }
  emit(runDir, "case_dispatched", { caseId: queueItem.id, attempt, messageId: message.id, dispatchOnly, laneId: lane.id, agentName });
  return { caseId: queueItem.id, attempt, messageId: message.id, laneId: lane.id, agentName };
}

function buildRunMessage(runDir, ctx, config, queueItem, attempt, attemptDir, agentName) {
  const requiredOutputs = {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json")
  };
  const targetSkills = configuredTargetSkills(config).map((skill) => ({
    name: skill.targetSkillName,
    slug: skill.slug,
    installPath: skill.installPath
  }));
  const promptText = queueItem.prompt && existsSync(queueItem.prompt) ? readFileSync(queueItem.prompt, "utf8") : "";
  const skillProfiles = targetSkills.map((skill) => discoverSkillProfile({
    name: skill.name,
    installPath: skill.installPath,
    requestText: promptText
  }));
  return createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: "RUN_SKILL_CASE",
    caseId: queueItem.id,
    attempt,
    stageId: "run",
    body: {
      case: queueItem,
      promptPath: queueItem.prompt,
      optionalInputs: queueItem.optionalInputs,
      loopProfile: config.loopProfile ?? null,
      targetSkillName: config.targetSkillName,
      targetSkills,
      skillProfiles,
      stageContracts: enrichStageContractsWithProfiles(stageContracts(config, targetSkills), skillProfiles, promptText),
      consumerRoot: ctx.run.locations.consumerRoot,
      consumerInstallTarget: ctx.run.locations.consumerInstallTarget,
      targetSkillInstallPath: ctx.run.locations.targetSkillInstallPath,
      providerRoot: ctx.run.locations.providerRoot,
      releaseRoot: ctx.run.locations.releaseRoot,
      outputDir: attemptDir,
      requiredOutputs,
      rule: `Execute this case by invoking ${config.targetSkillName ?? "the configured target skill"} inside the Codex session from consumerRoot. Do not bypass that Codex skill invocation with provider entrypoints, wrappers, legacy launchers, or installers. Write required artifacts, then stop.`
    },
    artifactPaths: Object.values(requiredOutputs)
  });
}

function buildEvaluationMessage(runDir, ctx, config, queueItem, attemptDir, agentName) {
  const requiredOutputs = {
    evalReport: join(attemptDir, "eval-report.md"),
    evalVerdict: join(attemptDir, "eval-verdict.json")
  };
  return createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: "EVALUATE_CASE",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: "evaluate",
    body: {
      case: queueItem,
      attemptDir,
      promptPath: queueItem.prompt,
      evidencePaths: {
        runnerReport: join(attemptDir, "runner-report.md"),
        runnerMetadata: join(attemptDir, "runner-metadata.json"),
        outputManifest: join(attemptDir, "output-manifest.json"),
        dispatch: join(attemptDir, "dispatch.json")
      },
      requiredOutputs,
      targetSkills: configuredTargetSkills(config).map((skill) => ({
        name: skill.targetSkillName,
        slug: skill.slug,
        installPath: skill.installPath
      })),
      skillProfiles: discoverConfiguredSkillProfiles(config, queueItem.prompt),
      loopProfile: config.loopProfile ?? null,
      rule: "Evaluate runner artifacts, process evidence, public skill invocation evidence, and output provenance. Pass only when required artifacts and source evidence satisfy the case."
    },
    artifactPaths: Object.values(requiredOutputs)
  });
}

function buildProviderMessage(runDir, ctx, queueItem, status, agentName) {
  const config = loadConfig();
  const attempt = Math.max(queueItem.attempts, 1);
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
  const artifacts = {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json"),
    loopStationFailure: join(attemptDir, "loop-station-failure.json"),
    loopStationFailureReport: join(attemptDir, "loop-station-failure.md"),
    evalReport: join(attemptDir, "eval-report.md"),
    evalVerdict: join(attemptDir, "eval-verdict.json")
  };
  const providerResponses = {
    markdown: join(attemptDir, "provider-response.md"),
    json: join(attemptDir, "provider-response.json")
  };
  return createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: "REPORT_CASE_RESULT_TO_PROVIDER_CODEX",
    caseId: queueItem.id,
    attempt,
    stageId: isRecoveryLoop(config) ? "provider_fix" : "provider_feedback",
    body: {
      status,
      case: queueItem,
      loopProfile: config.loopProfile ?? null,
      repairContract: config.repairContract ?? null,
      providerRoot: ctx.run.locations.providerRoot,
      releaseRoot: ctx.run.locations.releaseRoot,
      consumerRoot: ctx.run.locations.consumerRoot,
      consumerInstallTarget: ctx.run.locations.consumerInstallTarget,
      targetSkillInstallPath: ctx.run.locations.targetSkillInstallPath,
      evidencePaths: artifacts,
      providerResponses,
      rule: "Review this case result inside the provider Codex session. Decide and report fixed, known_unsupported, or needs_human. Loop-station will not patch provider files."
    },
    artifactPaths: Object.values(artifacts).filter((path) => existsSync(path))
  });
}

function buildChallengeReviewMessage(runDir, ctx, queueItem, attemptDir, agentName, completion) {
  const requiredOutputs = {
    challengeReport: join(attemptDir, "challenge-report.md"),
    challengeVerdict: join(attemptDir, "challenge-verdict.json")
  };
  return createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: "CHALLENGE_REVIEW",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: "challenge_review",
    body: {
      case: queueItem,
      attemptDir,
      priorVerdict: completion.verdict ?? {},
      requiredOutputs,
      challengeQuestion: completion.verdict?.challenge_question
        ?? "Find the strongest reason this case should not pass yet, then decide whether it truly passes or needs repair."
    },
    artifactPaths: Object.values(requiredOutputs)
  });
}

function buildDeployVerifyMessage(runDir, ctx, queueItem, agentName) {
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  const requiredOutputs = {
    deployVerifyReport: join(attemptDir, "deploy-verify-report.md"),
    deployVerifyVerdict: join(attemptDir, "deploy-verify.json")
  };
  return createMessage(runDir, {
    runId: ctx.run.runId,
    to: agentName,
    type: "DEPLOY_VERIFY",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: "deploy_verify",
    body: {
      case: queueItem,
      attemptDir,
      requiredOutputs,
      releaseRoot: ctx.run.locations.releaseRoot,
      consumerRoot: ctx.run.locations.consumerRoot,
      consumerInstallTarget: ctx.run.locations.consumerInstallTarget,
      targetSkillInstallPath: ctx.run.locations.targetSkillInstallPath,
      rule: "Verify that provider-owned changes and consumer installation reached the consumer skill surface. Write deploy verification artifacts, then stop."
    },
    artifactPaths: Object.values(requiredOutputs)
  });
}

async function tickManagedRun(runDir, config, { dispatchOnly = false } = {}) {
  const ctx = loadRun(runDir);
  ensureLaneState(ctx.state);
  let changed = false;

  for (const lane of [...ctx.state.lanes].filter((item) => item.stageId === "deploy_verify")) {
    changed = (await processManagedDeployVerifyLane(runDir, ctx, config, lane)) || changed;
  }
  for (const lane of [...ctx.state.lanes].filter((item) => item.stageId === "provider_feedback" || item.stageId === "provider_fix")) {
    changed = (await processManagedProviderLane(runDir, ctx, config, lane, { dispatchOnly })) || changed;
  }
  for (const lane of [...ctx.state.lanes].filter((item) => item.stageId === "challenge_review")) {
    changed = (await processManagedChallengeLane(runDir, ctx, config, lane)) || changed;
  }
  for (const lane of [...ctx.state.lanes].filter((item) => item.stageId === "evaluate")) {
    changed = (await processManagedEvaluationLane(runDir, ctx, config, lane, { dispatchOnly })) || changed;
  }
  for (const lane of [...ctx.state.lanes].filter((item) => item.stageId === "run")) {
    changed = (await processManagedRunLane(runDir, ctx, config, lane)) || changed;
  }
  changed = (await assignWaitingChallengeReviews(runDir, ctx, config, { dispatchOnly })) || changed;
  changed = (await assignWaitingEvaluations(runDir, ctx, config, { dispatchOnly })) || changed;
  changed = (await assignWaitingProviders(runDir, ctx, config, { dispatchOnly })) || changed;
  changed = (await assignWaitingDeployVerifications(runDir, ctx, config, { dispatchOnly })) || changed;
  if (!dispatchOnly && runtimeAutoDispatch(config) && !isPresetConfig(config)) {
    while (firstFreeAgent(config, "runner", ctx.state.lanes)) {
      const queueItem = ctx.queue.find((item) => item.status === "queued" || item.status === "rerun_queued");
      if (!queueItem) break;
      const freeRunner = firstFreeAgent(config, "runner", ctx.state.lanes);
      await startManagedRunLane(runDir, ctx, config, queueItem, freeRunner, { dispatchOnly });
      changed = true;
    }
  }
  if (changed) persistManagedState(runDir, ctx);
  return changed;
}

function presetCaseStillActive(queue) {
  return queue.some((item) => /^(active|waiting)_/.test(item.status));
}

async function processManagedRunLane(runDir, ctx, config, lane) {
  const queueItem = ctx.queue.find((item) => item.id === lane.caseId);
  if (!queueItem) return false;
  const laneMessage = ctx.messages.find((message) => message.id === lane.messageId);
  if (await handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, laneMessage, "runner_transport_failed")) {
    return true;
  }
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  const caseFolderGuard = detectActiveCaseFolderChanges(attemptDir, queueItem);
  if (caseFolderGuard.length > 0) {
    writeLoopStationFailure(attemptDir, queueItem, {
      reason: "case_folder_modified",
      guardViolations: caseFolderGuard,
      required: requiredRunnerArtifacts(attemptDir)
    });
    queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
    removeLane(ctx.state, lane.id);
    return true;
  }
  const transcriptGuard = detectRunnerBypassForAgent(runDir, lane.agentName, ctx);
  if (transcriptGuard.length > 0) {
    writeLoopStationFailure(attemptDir, queueItem, {
      reason: "runner_bypass_transcript_detected",
      guardViolations: transcriptGuard,
      required: requiredRunnerArtifacts(attemptDir)
    });
    queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
    removeLane(ctx.state, lane.id);
    return true;
  }
  const completion = inspectRunnerAttempt(attemptDir, runnerGuardOptions(ctx));
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(laneMessage);
  if (!reply.complete) return false;
  removeLane(ctx.state, lane.id);
  recordMailboxCompletion(runDir, laneMessage, "RUNNER_DONE", reply.payload);
  if (!completion.passed) {
    writeLoopStationFailure(attemptDir, queueItem, completion);
    queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
    emit(runDir, "case_failed_needs_provider", { caseId: queueItem.id, attempt: queueItem.attempts, reason: completion.reason, laneId: lane.id });
    return true;
  }
  if (reply.payload.status !== "done") {
    writeLoopStationFailure(attemptDir, queueItem, {
      reason: "runner_reply_status_mismatch",
      guardViolations: [`runner mailbox reply status was ${reply.payload.status}`],
      required: requiredRunnerArtifacts(attemptDir)
    });
    queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
    emit(runDir, "case_failed_needs_provider", { caseId: queueItem.id, attempt: queueItem.attempts, reason: "runner_reply_status_mismatch", laneId: lane.id });
    return true;
  }
  queueItem.status = "waiting_evaluation";
  return true;
}

async function assignWaitingEvaluations(runDir, ctx, config, { dispatchOnly }) {
  let changed = false;
  while (true) {
    const reviewer = firstFreeAgent(config, "review", ctx.state.lanes);
    const queueItem = ctx.queue.find((item) => item.status === "waiting_evaluation");
    if (!reviewer || !queueItem) break;
    const attemptDir = runnerAttemptDir(runDir, queueItem);
    const message = buildEvaluationMessage(runDir, ctx, config, queueItem, attemptDir, reviewer);
    writeJson(join(attemptDir, "evaluation-dispatch.json"), message);
    queueItem.status = "active_evaluation";
    const lane = createLane(ctx.state, {
      role: agentRole({ name: reviewer }),
      agentName: reviewer,
      caseId: queueItem.id,
      attempt: queueItem.attempts,
      stageId: "evaluate",
      messageId: message.id
    });
    transitionMessage(runDir, message.id, "pending");
    if (!dispatchOnly) {
      const submitted = await submitMessageToAgent(runDir, config, message, reviewer, queueItem.folder);
      if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${reviewer}`);
    }
    emit(runDir, "evaluation_dispatched", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, dispatchOnly, laneId: lane.id, agentName: reviewer });
    changed = true;
  }
  return changed;
}

async function processManagedEvaluationLane(runDir, ctx, config, lane) {
  const queueItem = ctx.queue.find((item) => item.id === lane.caseId);
  if (!queueItem) return false;
  const laneMessage = ctx.messages.find((message) => message.id === lane.messageId);
  if (await handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, laneMessage, "judgment_transport_failed")) {
    return true;
  }
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  const completion = inspectEvaluatorAttempt(attemptDir);
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(laneMessage);
  if (!reply.complete) return false;
  removeLane(ctx.state, lane.id);
  recordMailboxCompletion(runDir, laneMessage, "JUDGMENT_DONE", reply.payload);
  if (completion.passed) {
    if (reply.payload.status !== "done") {
      queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
      writeLoopStationFailure(attemptDir, queueItem, {
        reason: "judgment_reply_status_mismatch",
        guardViolations: [`judgment mailbox reply status was ${reply.payload.status}`],
        required: {
          evalReport: join(attemptDir, "eval-report.md"),
          evalVerdict: join(attemptDir, "eval-verdict.json")
        }
      });
      emit(runDir, "case_failed_needs_provider", { caseId: queueItem.id, attempt: queueItem.attempts, reason: "judgment_reply_status_mismatch", laneId: lane.id });
      return true;
    }
    queueItem.status = "case_passed";
    ctx.state.completedCases += 1;
    emit(runDir, "case_passed", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id });
    return true;
  }
  if (isRecoveryLoop(config) && completion.challengeRequired) {
    queueItem.status = "waiting_challenge_review";
    emit(runDir, "challenge_review_required", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id });
    return true;
  }
  writeLoopStationFailure(attemptDir, queueItem, completion);
  queueItem.status = isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider";
  emit(runDir, "case_failed_needs_provider", { caseId: queueItem.id, attempt: queueItem.attempts, reason: completion.reason, laneId: lane.id });
  return true;
}

async function assignWaitingChallengeReviews(runDir, ctx, config, { dispatchOnly }) {
  if (!isRecoveryLoop(config)) return false;
  let changed = false;
  while (true) {
    const reviewer = firstFreeAgent(config, "review", ctx.state.lanes);
    const queueItem = ctx.queue.find((item) => item.status === "waiting_challenge_review");
    if (!reviewer || !queueItem) break;
    const attemptDir = runnerAttemptDir(runDir, queueItem);
    const priorVerdict = inspectEvaluatorAttempt(attemptDir);
    const message = buildChallengeReviewMessage(runDir, ctx, queueItem, attemptDir, reviewer, priorVerdict);
    writeJson(join(attemptDir, "challenge-dispatch.json"), message);
    queueItem.status = "active_challenge_review";
    const lane = createLane(ctx.state, {
      role: agentRole({ name: reviewer }),
      agentName: reviewer,
      caseId: queueItem.id,
      attempt: queueItem.attempts,
      stageId: "challenge_review",
      messageId: message.id
    });
    transitionMessage(runDir, message.id, "pending");
    if (!dispatchOnly) {
      const submitted = await submitMessageToAgent(runDir, config, message, reviewer, queueItem.folder);
      if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${reviewer}`);
    }
    emit(runDir, "challenge_review_dispatched", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, dispatchOnly, laneId: lane.id, agentName: reviewer });
    changed = true;
  }
  return changed;
}

async function processManagedChallengeLane(runDir, ctx, config, lane) {
  const queueItem = ctx.queue.find((item) => item.id === lane.caseId);
  if (!queueItem) return false;
  const laneMessage = ctx.messages.find((message) => message.id === lane.messageId);
  if (await handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, laneMessage, "challenge_transport_failed")) {
    return true;
  }
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  const completion = inspectEvaluatorAttempt(attemptDir, {
    reportPath: join(attemptDir, "challenge-report.md"),
    verdictPath: join(attemptDir, "challenge-verdict.json")
  });
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(laneMessage);
  if (!reply.complete) return false;
  removeLane(ctx.state, lane.id);
  recordMailboxCompletion(runDir, laneMessage, "JUDGMENT_DONE", reply.payload);
  if (completion.passed) {
    queueItem.status = "case_passed";
    ctx.state.completedCases += 1;
    emit(runDir, "case_passed", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id, source: "challenge_review" });
    return true;
  }
  writeLoopStationFailure(attemptDir, queueItem, completion);
  queueItem.status = "waiting_provider_fix";
  emit(runDir, "challenge_review_failed", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id });
  return true;
}

async function assignWaitingProviders(runDir, ctx, config, { dispatchOnly }) {
  let changed = false;
  while (true) {
    const provider = isRecoveryLoop(config)
      ? firstFreeAgent(config, "provider_engineer", ctx.state.lanes)
      : firstFreeAgent(config, "provider", ctx.state.lanes);
    const queueItem = ctx.queue.find((item) => item.status === (isRecoveryLoop(config) ? "waiting_provider_fix" : "waiting_provider"));
    if (!provider || !queueItem) break;
    const message = buildProviderMessage(runDir, ctx, queueItem, "failed", provider);
    writeJson(join(runnerAttemptDir(runDir, queueItem), "provider-dispatch.json"), message);
    queueItem.status = isRecoveryLoop(config) ? "active_provider_fix" : "active_provider";
    const lane = createLane(ctx.state, {
      role: isRecoveryLoop(config) ? "provider_engineer" : "provider",
      agentName: provider,
      caseId: queueItem.id,
      attempt: queueItem.attempts,
      stageId: isRecoveryLoop(config) ? "provider_fix" : "provider_feedback",
      messageId: message.id
    });
    transitionMessage(runDir, message.id, "pending");
    if (!dispatchOnly) {
      const submitted = await submitMessageToAgent(runDir, config, message, provider, queueItem.folder);
      if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${provider}`);
    }
    emit(runDir, "provider_result_reported", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, status: "failed", dispatchOnly, laneId: lane.id, agentName: provider });
    changed = true;
  }
  return changed;
}

async function processManagedProviderLane(runDir, ctx, config, lane) {
  const queueItem = ctx.queue.find((item) => item.id === lane.caseId);
  if (!queueItem) return false;
  const laneMessage = ctx.messages.find((message) => message.id === lane.messageId);
  if (await handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, laneMessage, "provider_transport_failed")) {
    return true;
  }
  const attemptDir = providerResponseAttemptDir(runDir, queueItem);
  const response = inspectProviderResponse(attemptDir, { config, run: ctx.run });
  emit(runDir, "provider_response_checked", {
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    complete: response.complete,
    reason: response.reason,
    response: response.response,
    installProof: response.installProof,
    installFailures: response.installFailures,
    hashMatch: response.hashMatch,
    installArtifactsVerified: response.installArtifactsVerified,
    deployVerificationVerified: response.deployVerificationVerified,
    laneId: lane.id,
    agentName: lane.agentName
  });
  if (!response.complete) return false;
  const reply = inspectMailboxReply(laneMessage);
  if (!reply.complete) return false;
  removeLane(ctx.state, lane.id);
  recordMailboxCompletion(runDir, laneMessage, "PROVIDER_DONE", reply.payload);
  if (response.response === "fixed") {
    queueItem.status = isRecoveryLoop(config) && response.deployVerificationVerified !== true ? "waiting_deploy_verify" : "rerun_queued";
  } else if (response.response === "known_unsupported") {
    queueItem.status = "case_known_unsupported";
    ctx.state.completedCases += 1;
  } else {
    queueItem.status = "needs_human";
    ctx.state.status = "needs_human";
  }
  return true;
}

async function assignWaitingDeployVerifications(runDir, ctx, config, { dispatchOnly }) {
  if (!isRecoveryLoop(config)) return false;
  let changed = false;
  while (true) {
    const verifier = firstFreeAgent(config, "deploy_verifier", ctx.state.lanes);
    const queueItem = ctx.queue.find((item) => item.status === "waiting_deploy_verify");
    if (!verifier || !queueItem) break;
    const message = buildDeployVerifyMessage(runDir, ctx, queueItem, verifier);
    writeJson(join(runnerAttemptDir(runDir, queueItem), "deploy-verify-dispatch.json"), message);
    queueItem.status = "active_deploy_verify";
    const lane = createLane(ctx.state, {
      role: "deploy_verifier",
      agentName: verifier,
      caseId: queueItem.id,
      attempt: queueItem.attempts,
      stageId: "deploy_verify",
      messageId: message.id
    });
    transitionMessage(runDir, message.id, "pending");
    if (!dispatchOnly) {
      const submitted = await submitMessageToAgent(runDir, config, message, verifier, queueItem.folder);
      if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${verifier}`);
    }
    emit(runDir, "deploy_verify_dispatched", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, dispatchOnly, laneId: lane.id, agentName: verifier });
    changed = true;
  }
  return changed;
}

async function processManagedDeployVerifyLane(runDir, ctx, config, lane) {
  const queueItem = ctx.queue.find((item) => item.id === lane.caseId);
  if (!queueItem) return false;
  const laneMessage = ctx.messages.find((message) => message.id === lane.messageId);
  if (await handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, laneMessage, "deploy_transport_failed")) {
    return true;
  }
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  const completion = inspectEvaluatorAttempt(attemptDir, {
    reportPath: join(attemptDir, "deploy-verify-report.md"),
    verdictPath: join(attemptDir, "deploy-verify.json")
  });
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(laneMessage);
  if (!reply.complete) return false;
  removeLane(ctx.state, lane.id);
  recordMailboxCompletion(runDir, laneMessage, "DEPLOY_VERIFY_DONE", reply.payload);
  if (completion.passed) {
    queueItem.status = "rerun_queued";
    emit(runDir, "deploy_verify_passed", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id });
    return true;
  }
  queueItem.status = "waiting_provider_fix";
  emit(runDir, "deploy_verify_failed", { caseId: queueItem.id, attempt: queueItem.attempts, laneId: lane.id, reason: completion.reason });
  return true;
}

function applyManagedProviderResponse(runDir, ctx, caseId, response, payload = {}) {
  const queueItem = ctx.queue.find((item) => item.id === caseId);
  if (!queueItem) throw new Error(`Unknown case id: ${caseId}`);
  removeLane(ctx.state, laneForCase(ctx.state, caseId, "provider_fix")?.id ?? laneForCase(ctx.state, caseId, "provider_feedback")?.id);
  if (response === "fixed") {
    queueItem.status = isRecoveryLoop(loadConfig()) ? "waiting_deploy_verify" : "rerun_queued";
  } else if (response === "known_unsupported") {
    queueItem.status = "case_known_unsupported";
    ctx.state.completedCases += 1;
  } else {
    queueItem.status = "needs_human";
    ctx.state.status = "needs_human";
  }
  persistManagedState(runDir, ctx);
  emit(runDir, "provider_response_recorded", { caseId, response, source: payload.source ?? "provider-response-files" });
  return { caseId, response, queueItem };
}

function detectRunnerBypassForAgent(runDir, agentName, ctx, stage = null) {
  let panes;
  try {
    panes = JSON.parse(readFileSync(join(runDir, "panes.json"), "utf8"));
  } catch {
    return [];
  }
  const paneId = panes[agentName]?.paneId;
  if (!paneId) return [];
  const transcript = capturePane(paneId, 200);
  return detectRunnerBypassViolations(transcript, `${agentName}-pane`, runnerGuardOptions(ctx, stage));
}

function transportFailedState(state) {
  return ["blocked", "transport_submit_not_started", "timeout", "dead", "failed"].includes(state);
}

async function handleManagedActivationFailure(runDir, ctx, config, queueItem, lane, message, reason) {
  if (!message || !transportFailedState(message.state)) return false;
  if (shouldFailFastActivation(config)) {
    return failManagedLaneTransport(runDir, ctx, queueItem, lane, message, reason);
  }
  const recovery = await recoverActivationFailure(runDir, config, message, lane.agentName, queueItem.folder);
  if (!recovery.failed) return true;
  return failManagedLaneTransport(runDir, ctx, queueItem, lane, recovery.message ?? message, reason);
}

function failManagedLaneTransport(runDir, ctx, queueItem, lane, message, reason) {
  const attemptDir = runnerAttemptDir(runDir, queueItem);
  writeLoopStationFailure(attemptDir, queueItem, {
    reason,
    guardViolations: [
      `message ${message.id} for ${message.to} failed before execution start`,
      `message state: ${message.state}`,
      `signals: ${(message.signals ?? []).join(", ") || "(none)"}`,
      `failureReason: ${message.failureReason ?? "(none)"}`
    ],
    required: message.type === "EVALUATE_CASE"
      ? { evalReport: join(attemptDir, "eval-report.md"), evalVerdict: join(attemptDir, "eval-verdict.json") }
      : requiredRunnerArtifacts(attemptDir)
  });
  removeLane(ctx.state, lane.id);
  queueItem.status = "case_failed_final";
  ctx.state.activeCaseId = null;
  ctx.state.activeStageId = null;
  ctx.state.failedCases += 1;
  persistManagedState(runDir, ctx);
  emit(runDir, "case_failed_final", { caseId: queueItem.id, attempt: queueItem.attempts, reason, laneId: lane.id });
  return true;
}

async function handleActiveActivationFailure(runDir, ctx, config, queueItem, message, reason) {
  if (!message || !transportFailedState(message.state)) return false;
  if (shouldFailFastActivation(config)) {
    failActiveTransport(runDir, ctx, queueItem, message, reason);
    return true;
  }
  const recovery = await recoverActivationFailure(runDir, config, message, message.to, queueItem.folder);
  if (!recovery.failed) return true;
  failActiveTransport(runDir, ctx, queueItem, recovery.message ?? message, reason);
  return true;
}

export async function tickRun(runDir, { dispatchOnly = false } = {}) {
  const config = loadConfig();
  if (hasManagedSectionLayout(config)) {
    return tickManagedRun(runDir, config, { dispatchOnly });
  }
  let ctx = loadRun(runDir);
  if (isActionPipeline(config) && stageById(config, ctx.state.activeStageId)) {
    return await advanceCompletedActionStage(runDir, ctx, config, { dispatchOnly });
  }
  if (ctx.state.activeStageId === "provider_feedback") {
    return await processProviderFeedback(runDir, ctx, { dispatchOnly });
  }
  if (ctx.state.activeStageId === "run") {
    return await advanceCompletedActiveCase(runDir, ctx, { dispatchOnly });
  }
  if (ctx.state.activeStageId === "evaluate" || ctx.state.activeStageId === "evaluate-run") {
    return await advanceEvaluatedActiveCase(runDir, ctx, { dispatchOnly });
  }
  if (ctx.state.activeStageId) {
    // An unrecognized stage would otherwise spin forever as a healthy-looking
    // no-op tick; fail loudly so the orchestrator logs the stuck state.
    throw new Error(`tickRun cannot advance unknown active stage: ${ctx.state.activeStageId}`);
  }
  return false;
}

export async function advanceCompletedActiveCase(runDir, ctx, { dispatchOnly = false } = {}) {
  const activeCaseId = ctx.state.activeCaseId;
  if (!activeCaseId) return false;
  const queueItem = ctx.queue.find((item) => item.id === activeCaseId);
  if (!queueItem || queueItem.status !== "active" || queueItem.attempts < 1) return false;
  const activeMessage = activeCaseMessage(ctx.messages, queueItem, "RUN_SKILL_CASE", "run");
  if (await handleActiveActivationFailure(runDir, ctx, loadConfig(), queueItem, activeMessage, "runner_transport_failed")) {
    return true;
  }
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
  const caseFolderGuard = detectActiveCaseFolderChanges(attemptDir, queueItem);
  if (caseFolderGuard.length > 0) {
    await failActiveCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "case_folder_modified",
      guardViolations: caseFolderGuard,
      required: requiredRunnerArtifacts(attemptDir)
    }, { dispatchOnly });
    return true;
  }
  const transcriptGuard = detectActiveRunnerBypass(runDir, ctx);
  if (transcriptGuard.length > 0) {
    await failActiveCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_bypass_transcript_detected",
      guardViolations: transcriptGuard,
      required: requiredRunnerArtifacts(attemptDir)
    }, { dispatchOnly });
    return true;
  }
  const completion = inspectRunnerAttempt(attemptDir, runnerGuardOptions(ctx));
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(activeMessage);
  if (!reply.complete) return false;
  recordMailboxCompletion(runDir, activeMessage, "RUNNER_DONE", reply.payload);
  if (!completion.passed) {
    await failActiveCase(runDir, ctx, queueItem, completion, { dispatchOnly });
    return true;
  }
  if (reply.payload.status !== "done") {
    await failActiveCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_reply_status_mismatch",
      guardViolations: [`runner mailbox reply status was ${reply.payload.status}`],
      required: requiredRunnerArtifacts(attemptDir)
    }, { dispatchOnly });
    return true;
  }

  await startEvaluationStage(runDir, ctx, queueItem, attemptDir, { dispatchOnly });
  return true;
}

async function startEvaluationStage(runDir, ctx, queueItem, attemptDir, { dispatchOnly }) {
  const config = loadConfig();
  const evaluator = evaluatorAgentName(config);
  const existing = ctx.messages.find((message) => (
    message.to === evaluator
    && message.type === "EVALUATE_CASE"
    && message.caseId === queueItem.id
    && message.attempt === queueItem.attempts
  ));
  if (existing) return false;
  const requiredOutputs = {
    evalReport: join(attemptDir, "eval-report.md"),
    evalVerdict: join(attemptDir, "eval-verdict.json")
  };
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: evaluator,
    type: "EVALUATE_CASE",
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    stageId: "evaluate",
    body: {
      case: queueItem,
      attemptDir,
      evidencePaths: {
        runnerReport: join(attemptDir, "runner-report.md"),
        runnerMetadata: join(attemptDir, "runner-metadata.json"),
        outputManifest: join(attemptDir, "output-manifest.json"),
        dispatch: join(attemptDir, "dispatch.json")
      },
      requiredOutputs,
      targetSkills: configuredTargetSkills(config).map((skill) => ({
        name: skill.targetSkillName,
        slug: skill.slug,
        installPath: skill.installPath
      })),
      skillProfiles: discoverConfiguredSkillProfiles(config, queueItem.prompt),
      rule: "Evaluate runner artifacts, process evidence, public skill invocation evidence, and output provenance. Pass only when required artifacts and source evidence satisfy the case."
    },
    artifactPaths: Object.values(requiredOutputs)
  });
  writeJson(join(attemptDir, "evaluation-dispatch.json"), message);
  ctx.state.activeStageId = "evaluate";
  saveState(runDir, ctx.state);
  transitionMessage(runDir, message.id, "pending");
  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, config, message, evaluator, queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${evaluator}`);
  }
  emit(runDir, "evaluation_dispatched", { caseId: queueItem.id, attempt: queueItem.attempts, messageId: message.id, dispatchOnly });
  return true;
}

export async function advanceEvaluatedActiveCase(runDir, ctx, { dispatchOnly = false } = {}) {
  const activeCaseId = ctx.state.activeCaseId;
  if (!activeCaseId) return false;
  const queueItem = ctx.queue.find((item) => item.id === activeCaseId);
  if (!queueItem || queueItem.status !== "active" || queueItem.attempts < 1) return false;
  const evaluationMessage = activeCaseMessage(ctx.messages, queueItem, "EVALUATE_CASE", ctx.state.activeStageId);
  if (await handleActiveActivationFailure(runDir, ctx, loadConfig(), queueItem, evaluationMessage, "judgment_transport_failed")) {
    return true;
  }
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
  const completion = inspectEvaluatorAttempt(attemptDir);
  if (!completion.complete) return false;
  const reply = inspectMailboxReply(evaluationMessage);
  if (!reply.complete) return false;
  recordMailboxCompletion(runDir, evaluationMessage, "JUDGMENT_DONE", reply.payload);
  if (!completion.passed) {
    if (isActionPipeline(loadConfig())) {
      failActionPipelineCase(runDir, ctx, queueItem, completion);
      return true;
    }
    await failActiveCase(runDir, ctx, queueItem, completion, { dispatchOnly });
    return true;
  }
  if (reply.payload.status !== "done") {
    await failActiveCase(runDir, ctx, queueItem, {
      complete: true,
      passed: false,
      failed: true,
      reason: "judgment_reply_status_mismatch",
      guardViolations: [`judgment mailbox reply status was ${reply.payload.status}`],
      required: {
        evalReport: join(attemptDir, "eval-report.md"),
        evalVerdict: join(attemptDir, "eval-verdict.json")
      }
    }, { dispatchOnly });
    return true;
  }

  passActiveCase(runDir, ctx, queueItem);
  return true;
}

function passActiveCase(runDir, ctx, queueItem) {
  queueItem.status = "case_passed";
  ctx.state.activeCaseId = null;
  ctx.state.activeStageId = null;
  ctx.state.completedCases += 1;
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  emit(runDir, "runner_attempt_completed", { caseId: queueItem.id, attempt: queueItem.attempts, status: "passed" });
  emit(runDir, "case_passed", { caseId: queueItem.id, attempt: queueItem.attempts });
}

async function failActiveCase(runDir, ctx, queueItem, completion, { dispatchOnly }) {
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
  writeLoopStationFailure(attemptDir, queueItem, completion);
  queueItem.status = "case_failed_needs_provider";
  ctx.state.activeStageId = "provider_feedback";
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  await reportCaseResultToProvider(runDir, ctx, queueItem.id, "failed", { dispatchOnly });
  emit(runDir, "case_failed_needs_provider", { caseId: queueItem.id, attempt: queueItem.attempts, reason: completion.reason });
}

function requiredRunnerArtifacts(attemptDir) {
  return {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json")
  };
}

function detectActiveCaseFolderChanges(attemptDir, queueItem) {
  const snapshotPath = join(attemptDir, "case-folder-before.json");
  if (!existsSync(snapshotPath)) return [];
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch {
    return ["case folder snapshot invalid"];
  }
  return detectCaseFolderChanges(queueItem.folder, snapshot);
}

function detectActiveRunnerBypass(runDir, ctx) {
  let panes;
  try {
    panes = JSON.parse(readFileSync(join(runDir, "panes.json"), "utf8"));
  } catch {
    return [];
  }
  const paneId = panes[runnerAgentName(loadConfig())]?.paneId;
  if (!paneId) return [];
  const transcript = capturePane(paneId, 200);
  return detectRunnerBypassViolations(transcript, "runner-pane", runnerGuardOptions(ctx));
}

function runnerGuardOptions(ctx, stage = null) {
  const config = loadConfig();
  return runnerGuardOptionsForStage(config, stage, ctx);
}

export function runnerGuardOptionsForStage(config, stage = null, ctx = null) {
  const allowedPublicRuntimeCalls = [
    ...(config.allowedPublicRuntimeCalls ?? []),
    ...configuredTargetSkills(config).flatMap((skill) => discoverSkillProfile({
      name: skill.targetSkillName,
      installPath: skill.installPath
    }).allowedPublicRuntimeCalls),
    ...(stage ? discoverSkillProfile({
      name: stage.skill,
      installPath: stage.installPath
    }).allowedPublicRuntimeCalls : []),
    ...((stage?.allowedPublicRuntimeCalls ?? []))
  ];
  return {
    forbiddenPatterns: ctx?.run?.runnerForbiddenPatterns ?? config.runnerForbiddenPatterns ?? [],
    allowedPublicRuntimeCalls: [...new Set(allowedPublicRuntimeCalls)]
  };
}

function discoverConfiguredSkillProfiles(config, promptPath = null) {
  const requestText = promptPath && existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  return configuredTargetSkills(config).map((skill) => discoverSkillProfile({
    name: skill.targetSkillName,
    installPath: skill.installPath,
    requestText
  }));
}

async function reportProvider(argv) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const [caseId, status = "failed"] = positional;
  if (!caseId) throw new Error("Usage: station report-provider <case-id> [status] [--dispatch-only]");
  const dispatchOnly = argv.includes("--dispatch-only");
  const runDir = requireRunDir();
  const ctx = loadRun(runDir);
  const result = await reportCaseResultToProvider(runDir, ctx, caseId, status, { dispatchOnly });
  console.log(`Reported ${caseId} attempt ${result.attempt} to ${result.message.to}${dispatchOnly ? " (dispatch-only)" : ""}${result.alreadyReported ? " (already reported)" : ""}`);
}

export async function reportCaseResultToProvider(runDir, ctx, caseId, status, { dispatchOnly }) {
  const config = loadConfig();
  const providerAgent = providerEngineerAgentName(config);
  const queueItem = ctx.queue.find((item) => item.id === caseId);
  if (!queueItem) throw new Error(`Unknown case id: ${caseId}`);
  const attempt = Math.max(queueItem.attempts, 1);
  const existing = ctx.messages.find((message) => (
    agentRole({ name: message.to }) === "provider_engineer"
    && message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX"
    && message.caseId === caseId
    && message.attempt === attempt
  ));
  if (existing) {
    if (!dispatchOnly && !messageWasSubmitted(existing)) {
      const submitted = await submitMessageToAgent(runDir, loadConfig(), existing, existing.to, queueItem.folder);
      if (!submitted.ok) throw new Error(`Failed to submit message ${existing.id} to ${existing.to}`);
    }
    return { message: existing, attempt, alreadyReported: true };
  }

  const attemptDir = join(runDir, "cases", caseId, `attempt-${attempt}`);
  const artifacts = {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json"),
    loopStationFailure: join(attemptDir, "loop-station-failure.json"),
    loopStationFailureReport: join(attemptDir, "loop-station-failure.md"),
    evalReport: join(attemptDir, "eval-report.md"),
    evalVerdict: join(attemptDir, "eval-verdict.json")
  };
  const providerResponses = {
    markdown: join(attemptDir, "provider-response.md"),
    json: join(attemptDir, "provider-response.json")
  };
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: providerAgent,
    type: "REPORT_CASE_RESULT_TO_PROVIDER_CODEX",
    caseId,
    attempt,
    stageId: isRecoveryLoop(config) ? "provider_fix" : "provider_feedback",
    body: {
      status,
      case: queueItem,
      loopProfile: config.loopProfile ?? null,
      repairContract: config.repairContract ?? null,
      evidencePaths: artifacts,
      providerResponses,
      rule: "Review this case result inside the provider Codex session. Decide and report fixed, known_unsupported, or needs_human. Loop-station will not patch provider files."
    },
    artifactPaths: Object.values(artifacts).filter((path) => existsSync(path))
  });
  writeJson(join(attemptDir, "provider-dispatch.json"), message);
  transitionMessage(runDir, message.id, "pending");
  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, loadConfig(), message, message.to, queueItem.folder);
    if (!submitted.ok) throw new Error(`Failed to submit message ${message.id} to ${message.to}`);
  }
  emit(runDir, "provider_result_reported", { caseId, attempt, messageId: message.id, status, dispatchOnly });
  return { message, attempt, alreadyReported: false };
}

function writeLoopStationFailure(attemptDir, queueItem, completion) {
  const payload = {
    status: "failed",
    source: "loop-station",
    reason: completion.reason,
    caseId: queueItem.id,
    attempt: queueItem.attempts,
    guardViolations: completion.guardViolations ?? [],
    missing: completion.missing ?? [],
    required: completion.required ?? {},
    note: "Loop-station rejected this runner attempt before advancing the queue. Provider review should inspect the raw attempt directory and evidence paths."
  };
  writeJson(join(attemptDir, "loop-station-failure.json"), payload);
  writeFileSync(join(attemptDir, "loop-station-failure.md"), `# Loop Station Failure

Status: failed
Reason: ${completion.reason}
Case: ${queueItem.id}
Attempt: ${queueItem.attempts}

Guard violations:
${payload.guardViolations.length ? payload.guardViolations.map((item) => `- ${item}`).join("\n") : "- (none)"}

This attempt was not accepted as a pass by loop-station. Inspect the raw attempt directory and the evidence files before deciding whether the provider should change.
`);
}

function messageWasSubmitted(message) {
  return ["submitted", "accepted_by_pane", "processing", "completed"].includes(message.state);
}

async function providerResponse(argv) {
  const override = argv.includes("--override");
  const [caseId, response] = argv.filter((arg) => arg !== "--override");
  if (!caseId || !response) throw new Error("Usage: station provider-response <case-id> <fixed|known_unsupported|needs_human>");
  const runDir = requireRunDir();
  const ctx = loadRun(runDir);
  ensureLaneState(ctx.state);
  const config = loadConfig();
  if (response === "fixed" && !override) {
    const queueItem = ctx.queue.find((item) => item.id === caseId);
    if (!queueItem) throw new Error(`Unknown case id: ${caseId}`);
    const inspected = inspectProviderResponse(providerResponseAttemptDir(runDir, queueItem), { config, run: ctx.run });
    if (!inspected.complete || inspected.response !== "fixed") {
      throw new Error(`fixed_install_not_verified: ${inspected.reason ?? "missing valid fixed response files"}`);
    }
  }
  if (hasManagedSectionLayout(config)) {
    applyManagedProviderResponse(runDir, ctx, caseId, response, { source: override ? "manual-cli-override" : "manual-cli" });
  } else {
  applyProviderResponse(runDir, ctx, caseId, response, { source: override ? "manual-cli-override" : "manual-cli" });
  }
  console.log(`Provider response recorded for ${caseId}: ${response}`);
}

async function processProviderFeedback(runDir, ctx, { dispatchOnly }) {
  const activeCaseId = ctx.state.activeCaseId;
  if (!activeCaseId) return false;
  const config = loadConfig();
  const queueItem = ctx.queue.find((item) => item.id === activeCaseId);
  if (!queueItem || queueItem.status !== "case_failed_needs_provider") return false;
  const providerMessage = activeCaseMessage(ctx.messages, queueItem, "REPORT_CASE_RESULT_TO_PROVIDER_CODEX", "provider_feedback");
  if (await handleActiveActivationFailure(runDir, ctx, config, queueItem, providerMessage, "provider_transport_failed")) {
    return true;
  }
  const attemptDir = providerResponseAttemptDir(runDir, queueItem);
  const response = inspectProviderResponse(attemptDir, { config, run: ctx.run });
  emit(runDir, "provider_response_checked", {
    caseId: activeCaseId,
    attempt: queueItem.attempts,
    complete: response.complete,
    reason: response.reason,
    response: response.response,
    installProof: response.installProof,
    installFailures: response.installFailures,
    hashMatch: response.hashMatch
  });
  if (response.complete) {
    const reply = inspectMailboxReply(providerMessage);
    if (!reply.complete) return false;
    recordMailboxCompletion(runDir, providerMessage, "PROVIDER_DONE", reply.payload);
    applyProviderResponse(runDir, ctx, activeCaseId, response.response, response.payload);
    return true;
  }
  await ensureProviderFollowUp(runDir, ctx, queueItem, response, { dispatchOnly });
  return false;
}

function activeCaseMessage(messages, queueItem, type, stageId = null) {
  return messages.find((message) => (
    message.type === type
    && message.caseId === queueItem.id
    && message.attempt === queueItem.attempts
    && (stageId ? message.stageId === stageId : true)
  )) ?? null;
}

function failActiveTransport(runDir, ctx, queueItem, message, reason) {
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${queueItem.attempts}`);
  writeLoopStationFailure(attemptDir, queueItem, {
    reason,
    guardViolations: [
      `message ${message.id} for ${message.to} failed before execution start`,
      `message state: ${message.state}`,
      `signals: ${(message.signals ?? []).join(", ") || "(none)"}`,
      `failureReason: ${message.failureReason ?? "(none)"}`
    ],
    required: message.type === "EVALUATE_CASE"
      ? { evalReport: join(attemptDir, "eval-report.md"), evalVerdict: join(attemptDir, "eval-verdict.json") }
      : requiredRunnerArtifacts(attemptDir)
  });
  queueItem.status = "case_failed_final";
  ctx.state.activeCaseId = null;
  ctx.state.activeStageId = null;
  ctx.state.failedCases += 1;
  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  emit(runDir, "case_failed_final", { caseId: queueItem.id, attempt: queueItem.attempts, reason });
}

async function ensureProviderFollowUp(runDir, ctx, queueItem, response, { dispatchOnly }) {
  const attempt = Math.max(queueItem.attempts, 1);
  const attemptDir = join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
  const markerPath = join(attemptDir, "provider-followup.json");
  if (existsSync(markerPath)) return false;
  const providerMessage = ctx.messages.find((message) => (
    agentRole({ name: message.to }) === "provider_engineer"
    && message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX"
    && message.caseId === queueItem.id
    && message.attempt === attempt
  ));
  const providerResponses = providerMessage?.body?.providerResponses ?? {
    markdown: join(attemptDir, "provider-response.md"),
    json: join(attemptDir, "provider-response.json")
  };
  if (!dispatchOnly && shouldWaitBeforeProviderFollowUp(providerMessage)) {
    emit(runDir, "provider_response_followup_deferred", { caseId: queueItem.id, attempt, reason: response.reason, messageId: providerMessage.id });
    return false;
  }
  const message = createMessage(runDir, {
    runId: ctx.run.runId,
    to: providerEngineerAgentName(loadConfig()),
    type: "FOLLOW_UP_PROVIDER_RESPONSE",
    caseId: queueItem.id,
    attempt,
    stageId: isRecoveryLoop(loadConfig()) ? "provider_fix" : "provider_feedback",
    body: {
      reason: response.reason,
      missing: response.missing ?? [],
      error: response.error ?? null,
      invalidResponse: response.response ?? null,
      installProof: response.installProof ?? [],
      installFailures: response.installFailures ?? [],
      hashMatch: response.hashMatch ?? null,
      installArtifactsVerified: response.installArtifactsVerified ?? null,
      deployVerificationVerified: response.deployVerificationVerified ?? null,
      releaseSkillPath: response.releaseSkillPath ?? null,
      consumerSkillPath: response.consumerSkillPath ?? null,
      providerResponses
    },
    artifactPaths: Object.values(providerResponses)
  });
  writeJson(markerPath, {
    messageId: message.id,
    caseId: queueItem.id,
    attempt,
    reason: response.reason,
    createdAt: new Date().toISOString()
  });
  transitionMessage(runDir, message.id, "pending");
  emit(runDir, "provider_response_followup_created", { caseId: queueItem.id, attempt, reason: response.reason, messageId: message.id });
  if (!dispatchOnly) {
    const submitted = await submitMessageToAgent(runDir, loadConfig(), message, message.to, queueItem.folder);
    if (!submitted.ok) emit(runDir, "provider_response_followup_submit_failed", { caseId: queueItem.id, attempt, messageId: message.id });
  }
  return true;
}

function shouldWaitBeforeProviderFollowUp(providerMessage) {
  if (!providerMessage || !messageWasSubmitted(providerMessage)) return false;
  const followUpGraceMs = 120000;
  const createdAt = Date.parse(providerMessage.updatedAt ?? providerMessage.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt < followUpGraceMs;
}

async function smokeRunOne() {
  process.env.STATION_RUNS_DIR ??= mkdtempSync(join(tmpdir(), "loop-station-smoke-"));
  const { runDir, run } = createRun();
  emit(runDir, "smoke_run_one_started", { runId: run.runId });
  const artifactPath = join(runDir, "cases", "fixture-case", "attempt-1", "runner-report.md");
  ensureDir(join(runDir, "cases", "fixture-case", "attempt-1"));
  writeFileSync(artifactPath, "fixture runner report\n");
  const message = createMessage(runDir, {
    runId: run.runId,
    to: "RunnerAgent-Model",
    type: "RUN_SKILL_CASE",
    caseId: "fixture-case",
    attempt: 1,
    stageId: "run",
    artifactPaths: [artifactPath]
  });
  for (const state of ["pending", "submitted", "accepted_by_pane", "processing", "idle_observed"]) {
    transitionMessage(runDir, message.id, state);
  }
  await waitForArtifacts(runDir, message, [artifactPath], { timeoutMs: 1000, intervalMs: 50 });
  runVerifier(runDir, message, { type: "command", command: process.execPath, args: ["-e", "process.exit(0)"] });
  transitionMessage(runDir, message.id, "completed");
  emit(runDir, "smoke_run_one_completed", { status: "passed" });
  console.log(`smoke-run-one PASS run=${run.runId}`);
}

function printHelp() {
  console.log(`loop-station harness

Usage:
  station boot
  station start [--attach]
  station status
  station attach
  station stop
  station cleanup
  station validate [--json] [--skip-tools]
  station run-next [--dispatch-only]
  station run-four [--dispatch-only]
  station report-provider <case-id> [status] [--dispatch-only]
  station provider-response <case-id> <fixed|known_unsupported|needs_human>
  station smoke-run-one

Notes:
  station start always launches a visible runtime.
  Trigger from the current Codex session; live work runs in the attached tmux/Terminal surface.`);
}

function enforceTargetSkillInstalled(runDir, state, config) {
  try {
    const check = requireTargetSkillInstalled(runDir, config);
    emit(runDir, "target_skill_checked", check);
    return check;
  } catch (error) {
    state.status = "target_skill_missing";
    saveState(runDir, state);
    emit(runDir, "target_skill_missing", error.targetSkillCheck ?? { reason: error.message });
    throw error;
  }
}

function parseRunOptions(argv) {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const inlineLimit = argv.find((arg) => arg.startsWith("--limit="));
  const rawLimit = inlineLimit ? inlineLimit.slice("--limit=".length) : (limitIndex === -1 ? null : argv[limitIndex + 1]);
  const caseLimit = rawLimit ? Number.parseInt(rawLimit, 10) : null;
  return {
    caseLimit: Number.isFinite(caseLimit) ? caseLimit : null,
    attach: argv.includes("--attach"),
    detached: argv.includes("--detached")
  };
}

export function resolveStartMode({ attach = false, detached = false, stdinIsTTY = process.stdin.isTTY } = {}) {
  if (attach && detached) {
    throw new Error("Choose either --attach or --detached, not both.");
  }
  if (detached) {
    throw new Error("Loop Station always starts a visible runtime. --detached is not supported.");
  }
  return { attach: true, detached: false, stdinIsTTY };
}

export function enforceRuntimePolicy(config, mode) {
  const policy = config.runtimePolicy ?? {};
  if (policy.attachRequired === true && policy.allowDetached === false && mode.detached) {
    throw new Error("This station is attach-required and does not allow --detached. Start with visible attach.");
  }
}

function submissionTimeouts(config) {
  const submitTimeout = config?.timeouts?.messageSubmitMs ?? 10000;
  const activationTimeout = config?.timeouts?.activationAckMs ?? 30000;
  return {
    submitTimeoutMs: submitTimeout,
    acceptTimeoutMs: activationTimeout
  };
}

async function enforceModelPaneStartup(runDir, panes, config) {
  const result = await waitForModelPanesReady(panes, {
    timeoutMs: config.timeouts?.paneReadyMs ?? 15000
  });
  if (result.ok) return;
  const ctx = loadRun(runDir);
  ctx.state.status = "model_pane_startup_blocked";
  saveState(runDir, ctx.state);
  emit(runDir, "model_pane_startup_blocked", { blocked: result.blocked });
  throw new Error(`model_pane_startup_blocked: ${result.blocked.map((item) => `${item.agentName}:${item.state}:${(item.signals ?? []).join("|")}`).join(", ")}`);
}

async function ensureTrustedCodexRootsForStart(config) {
  const roots = codexTrustRoots(config);
  if (roots.length === 0) return;
  const path = codexConfigPath();
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const missing = missingTrustedRoots(roots, current);
  if (missing.length === 0) return;

  if (process.env.STATION_AUTO_TRUST_PROJECTS === "1") {
    markProjectsTrusted(path, missing);
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(`Codex trust approval is required before start. Trust these roots first: ${missing.join(", ")}`);
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Loop Station needs Codex to trust these roots before launching panes:\n${missing.join("\n")}\nTrust and continue? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error(`Start cancelled. Trust these roots first: ${missing.join(", ")}`);
    }
  } finally {
    rl.close();
  }
  markProjectsTrusted(path, missing);
}

function codexTrustRoots(config) {
  return [...new Set((config.agents ?? [])
    .filter((agent) => agent.kind === "model")
    .map((agent) => modelTrustRoot(agent, config))
    .filter(Boolean))];
}

function modelTrustRoot(agent, config) {
  switch (agent.cwd) {
    case "providerRoot":
      return config.locations.providerRoot;
    case "consumerRoot":
      return config.locations.consumerRoot;
    case "caseFolder":
      return config.locations.consumerRoot ?? config.locations.stationRoot;
    case "stationRoot":
    default:
      return config.locations.stationRoot;
  }
}

export async function makeRuntimeVisible(runDir, topology, options = {}) {
  if (topology.mode === "borrowed-session") {
    const attached = focusStation(topology);
    return {
      ok: attached.status === 0,
      topology,
      attachCommand: `tmux switch-client -t ${topology.attachTarget}`,
      reason: attached.status === 0 ? null : "switch_client_failed"
    };
  }

  const launched = launchAttachedRuntimeTerminal(topology, options.terminalLaunchOptions);
  if (!launched.ok) {
    return {
      ok: false,
      topology,
      attachCommand: launched.attachCommand,
      reason: launched.reason
    };
  }
  const nextTopology = updateStationTopology(runDir, {
    mode: "terminal-attached-owned-session",
    terminalApp: launched.terminalApp,
    terminalLaunchMethod: launched.terminalLaunchMethod,
    terminalWindowId: launched.terminalWindowId ?? null
  });
  return {
    ok: true,
    topology: nextTopology,
    attachCommand: launched.attachCommand,
    reason: null
  };
}

function suppressCodexUpdatePrompt() {
  const versionPath = join(homedir(), ".codex", "version.json");
  if (!existsSync(versionPath)) return;
  const version = JSON.parse(readFileSync(versionPath, "utf8"));
  if (version.latest_version && version.dismissed_version !== version.latest_version) {
    version.dismissed_version = version.latest_version;
    writeJson(versionPath, version);
  }
}
