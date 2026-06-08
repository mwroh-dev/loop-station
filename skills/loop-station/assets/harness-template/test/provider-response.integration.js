import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "station");
const runsDir = mkdtempSync(join(tmpdir(), "loop-station-provider-runs-"));

afterEach(() => {
  cleanupRunsDir();
});

function runStation(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      STATION_RUNS_DIR: runsDir,
      STATION_AGENT_COMMAND: "node -e 'setInterval(()=>{},1000)'",
      STATION_AUTO_TRUST_PROJECTS: "1",
      ...env
    }
  });
}

function latestRunDir() {
  const latest = rmSafeReadDir(runsDir).sort().at(-1);
  return join(runsDir, latest);
}

describe("provider response automation", () => {
  it("does not apply fixed response files when install proof is missing", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeProviderResponse(attemptDir, "fixed");

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "case_failed_needs_provider");
    assert.equal(queue[0].attempts, 1);
    assert.equal(state.activeCaseId, caseId);
    assert.equal(state.activeStageId, "provider_feedback");
    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    const followUps = messages.filter((message) => message.type === "FOLLOW_UP_PROVIDER_RESPONSE" && message.caseId === caseId);
    assert.equal(followUps.length, 1);
    assert.equal(followUps[0].body.reason, "fixed_install_not_verified");
  });

  it("applies fixed response files after install proof and matching hashes", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`],
      verification: ["consumer skill hash matches release skill hash"]
    });

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "active");
    assert.equal(queue[0].attempts, 2);
    assert.equal(state.activeCaseId, caseId);
    assert.equal(state.activeStageId, "run");
  });

  it("does not advance when provider response files are invalid", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeFileSync(join(attemptDir, "provider-response.md"), "# Provider response\n");
    writeFileSync(join(attemptDir, "provider-response.json"), "{\"response\":\"not_real\"}\n");

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "case_failed_needs_provider");
    assert.equal(state.activeCaseId, caseId);
    assert.equal(state.activeStageId, "provider_feedback");
  });

  it("creates one follow-up message for missing provider response files", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();

    const firstTick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(firstTick.status, 0, firstTick.stderr || firstTick.stdout);
    const secondTick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(secondTick.status, 0, secondTick.stderr || secondTick.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    const followUps = messages.filter((message) => message.type === "FOLLOW_UP_PROVIDER_RESPONSE" && message.caseId === caseId);
    assert.equal(followUps.length, 1);
    const followUpPath = join(runDir, "cases", caseId, "attempt-1", "provider-followup.json");
    const followUp = JSON.parse(readFileSync(followUpPath, "utf8"));
    assert.equal(followUp.reason, "missing_response_files");
  });

  it("defers missing-file follow-up while a provider handoff is newly submitted", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const messagesPath = join(runDir, "messages.json");
    const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
    const providerMessage = messages.find((message) => message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX");
    providerMessage.state = "submitted";
    providerMessage.updatedAt = new Date().toISOString();
    writeFileSync(messagesPath, `${JSON.stringify(messages, null, 2)}\n`);

    const tick = runStation(["run-next"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const refreshed = JSON.parse(readFileSync(messagesPath, "utf8"));
    const followUps = refreshed.filter((message) => message.type === "FOLLOW_UP_PROVIDER_RESPONSE" && message.caseId === caseId);
    assert.equal(followUps.length, 0);
  });

  it("applies known unsupported response files and closes the case", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeProviderResponse(attemptDir, "known_unsupported");

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "case_known_unsupported");
    assert.equal(queue[1].status, "active");
    assert.equal(state.activeCaseId, queue[1].id);
    assert.equal(state.completedCases, 1);
  });

  it("applies needs human response files and pauses the run", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeProviderResponse(attemptDir, "needs_human");

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "needs_human");
    assert.equal(state.activeCaseId, caseId);
    assert.equal(state.status, "needs_human");
  });

  it("rejects manual fixed without install proof unless override is used", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase();

    const rejected = runStation(["provider-response", caseId, "fixed"], { STATION_CONFIG: fixture.configPath });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /fixed_install_not_verified/);

    const overridden = runStation(["provider-response", caseId, "fixed", "--override"], { STATION_CONFIG: fixture.configPath });
    assert.equal(overridden.status, 0, overridden.stderr || overridden.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queue[0].status, "rerun_queued");
  });

  it("recovery-loop routes fixed cases into deploy verification before rerun", () => {
    const { runDir, caseId, fixture } = setupFailedProviderCase({ profile: "recovery-loop" });
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`],
      verification: ["consumer skill hash matches release skill hash"]
    });
    writeProviderFixArtifacts(attemptDir);
    writeConsumerInstallArtifacts(attemptDir);

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queue[0].status, "active_deploy_verify");
    assert.equal(messages.at(-1).stageId, "deploy_verify");
    assert.equal(messages.at(-1).to, "DeployVerifier-Model");
  });
});

function setupFailedProviderCase({ profile = null } = {}) {
  removeRunsDir();
  const fixture = createConfigFixture({ installSkill: true, profile });
  const boot = runStation(["boot"], { STATION_CONFIG: fixture.configPath });
  assert.equal(boot.status, 0, boot.stderr || boot.stdout);
  const runDir = latestRunDir();
  const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
  const caseId = queue[0].id;
  const attemptDir = join(runDir, "cases", caseId, "attempt-1");
  writeFileSync(join(attemptDir, "runner-report.md"), "report\n");
  writeFileSync(join(attemptDir, "runner-metadata.json"), "{}\n");
  writeFileSync(join(attemptDir, "output-manifest.json"), "{\"status\":\"DONE\",\"verdict\":\"fail\"}\n");
  writeMailboxReplyFromDispatch(join(attemptDir, "dispatch.json"), {
    status: "failed",
    summary: "runner fail",
    artifactPaths: ["runner-report.md", "runner-metadata.json", "output-manifest.json"]
  });
  const gate = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
  assert.equal(gate.status, 0, gate.stderr || gate.stdout);
  return { runDir, caseId, fixture };
}

function createConfigFixture({ installSkill, profile = null }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-provider-test-"));
  const consumerRoot = join(dir, "consumer");
  const providerRoot = join(dir, "provider");
  const releaseRoot = join(dir, "release");
  const releaseSkillPath = join(releaseRoot, "skills", "example-skill");
  const skillPath = join(consumerRoot, ".codex", "skills", "example-skill");
  const caseRoot = join(dir, "cases");
  const caseFolder = join(caseRoot, "fixture-case-001");
  const secondCaseFolder = join(caseRoot, "fixture-case-002");
  const caseManifest = join(dir, "cases.json");
  mkdirSync(consumerRoot, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  mkdirSync(caseFolder, { recursive: true });
  mkdirSync(secondCaseFolder, { recursive: true });
  mkdirSync(releaseSkillPath, { recursive: true });
  writeFileSync(join(releaseSkillPath, "SKILL.md"), skillManifest({ body: "release\n" }));
  writeFileSync(join(caseFolder, "prompt.md"), "fixture prompt\n");
  writeFileSync(join(secondCaseFolder, "prompt.md"), "second fixture prompt\n");
  writeFileSync(caseManifest, `${JSON.stringify([
    {
      id: "fixture-case-001",
      folder: caseFolder,
      prompt: join(caseFolder, "prompt.md"),
      optionalInputs: [],
      evaluationMode: "prompt-grounded"
    },
    {
      id: "fixture-case-002",
      folder: secondCaseFolder,
      prompt: join(secondCaseFolder, "prompt.md"),
      optionalInputs: [],
      evaluationMode: "prompt-grounded"
    }
  ], null, 2)}\n`);
  if (installSkill) {
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest());
  }
  const config = JSON.parse(readFileSync(join(root, "station.json"), "utf8"));
  config.targetSkillName = "$example-skill";
  config.caseManifest = caseManifest;
  config.sessionPrefix = `loop-station-provider-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  config.locations = {
    ...config.locations,
    providerRoot,
    releaseRoot,
    consumerRoot,
    consumerInstallTarget: consumerRoot,
    targetSkillInstallPath: skillPath
  };
  if (profile === "recovery-loop") {
    delete config.agents;
    config.profileMode = "preset";
    config.loopProfile = "recovery-loop";
    config.topologyPreset = "legacy-aligned-visible";
    config.roleCounts = {
      runner: 2,
      judgment: 1,
      observer: 1,
      provider_engineer: 1,
      deploy_verifier: 1
    };
    config.phaseGraph = [
      "run",
      "judgment",
      "challenge_review",
      "provider_fix",
      "consumer_install",
      "deploy_verify",
      "rerun_gate"
    ];
    config.repairContract = {
      requireConsumerInstall: true,
      requireDeployVerification: true,
      requireReleaseConsumerHashMatch: true
    };
  }
  const configPath = join(dir, "station.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath, config, skillPath, releaseSkillPath };
}

function writeProviderResponse(attemptDir, response, overrides = {}) {
  writeFileSync(join(attemptDir, "provider-response.md"), `# Provider response\n\nResponse: \`${response}\`\n`);
  writeFileSync(join(attemptDir, "provider-response.json"), `${JSON.stringify({
    response,
    reason: "done",
    provider_changes: [],
    release_update_install: [],
    verification: [],
    ...overrides
  }, null, 2)}\n`);
  writeMailboxReplyFromDispatch(join(attemptDir, "provider-dispatch.json"), {
    status: response === "needs_human" ? "needs_human" : "done",
    summary: `provider ${response}`,
    artifactPaths: ["provider-response.md", "provider-response.json"]
  });
}

function writeProviderFixArtifacts(attemptDir) {
  writeFileSync(join(attemptDir, "provider-fix-report.md"), "# Provider fix\n");
  writeFileSync(join(attemptDir, "provider-fix.json"), `${JSON.stringify({ status: "completed", changedFiles: ["skill.js"] }, null, 2)}\n`);
}

function writeConsumerInstallArtifacts(attemptDir) {
  writeFileSync(join(attemptDir, "consumer-install-report.md"), "# Consumer install\n");
  writeFileSync(join(attemptDir, "consumer-install.json"), `${JSON.stringify({ status: "completed", installed: true }, null, 2)}\n`);
}

function writeMailboxReplyFromDispatch(dispatchPath, override = {}) {
  if (!existsSync(dispatchPath)) return;
  const dispatch = JSON.parse(readFileSync(dispatchPath, "utf8"));
  const replyPath = dispatch.body?.mailboxReplyPath;
  if (!replyPath) return;
  const contract = dispatch.body?.mailboxReplyContract ?? {};
  mkdirSync(dirname(replyPath), { recursive: true });
  writeFileSync(replyPath, `${JSON.stringify({
    messageId: contract.messageId ?? dispatch.id,
    agentName: contract.agentName ?? dispatch.to,
    role: contract.role ?? "model",
    caseId: contract.caseId ?? dispatch.caseId ?? null,
    attempt: contract.attempt ?? dispatch.attempt ?? null,
    stageId: contract.stageId ?? dispatch.stageId ?? null,
    status: "done",
    summary: "completed",
    artifactPaths: [],
    ...override
  }, null, 2)}\n`);
}

function rmSafeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function skillManifest({ body = "fixture\n" } = {}) {
  return `---
name: example-skill
description: Fixture skill for provider response tests.
---

# example-skill

${body}`;
}

function removeRunsDir() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(runsDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== "ENOTEMPTY" || attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function cleanupRunsDir() {
  if (rmSafeReadDir(runsDir).length > 0) runStation(["cleanup"]);
  removeRunsDir();
}
