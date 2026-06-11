import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { writeEnvelope } from "../src/message-lifecycle.js";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "station");
const runsDir = mkdtempSync(join(tmpdir(), "loop-station-runs-"));

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
  const latest = readdirSync(runsDir).sort().at(-1);
  return join(runsDir, latest);
}

describe("run-next dispatch", () => {
  it("passes the read-only target skill install check when the target skill exists", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const check = JSON.parse(readFileSync(join(runDir, "target-skill-check.json"), "utf8"));
    assert.equal(check.ok, true);
    assert.equal(check.targetSkillName, "$example-skill");
    assert.equal(check.installPath, fixture.skillPath);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("fails before dispatch when the target skill install check is missing", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: false });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.notEqual(start.status, 0);

    const runDir = latestRunDir();
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const check = JSON.parse(readFileSync(join(runDir, "target-skill-check.json"), "utf8"));
    assert.equal(state.status, "target_skill_missing");
    assert.equal(check.ok, false);
    assert.equal(check.installPlan.defaultMode, "project-local-copy");
    assert.match(check.installPlan.destination, /\.codex\/skills\/example-skill$/);

    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.notEqual(next.status, 0);
    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.length, 0);
  });

  it("creates a four-case queue and dispatches the next case without waiting for artifacts", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const queueBefore = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queueBefore.length, 4);

    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(next.status, 0, next.stderr || next.stdout);

    const queueAfter = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queueAfter[0].status, "active");
    assert.equal(queueAfter[0].attempts, 1);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "RunnerAgent-Model");
    assert.equal(messages[0].type, "RUN_SKILL_CASE");
    assert.equal(messages[0].caseId, queueAfter[0].id);
    assert.equal(messages[0].body.targetSkillName, "$example-skill");
    assert.match(messages[0].body.mailboxRequestPath, /mailbox\/RunnerAgent-Model\/request\//);
    assert.match(messages[0].body.mailboxStartedPath, /mailbox\/RunnerAgent-Model\/started\//);
    assert.match(messages[0].body.mailboxReplyPath, /mailbox\/RunnerAgent-Model\/reply\//);
    assert.equal(messages[0].body.mailboxStartedContract.role, "runner");
    assert.equal(messages[0].body.mailboxReplyContract.role, "runner");
    assert.match(messages[0].body.rule, /\$example-skill|targetSkillName|Codex session/);
    for (const forbidden of ["bin/", "run-example", "install-case-local", ".codex/agent-systems"]) {
      assert.doesNotMatch(JSON.stringify(messages[0].body), new RegExp(forbidden.replaceAll(".", "\\.")));
    }
    assert.ok(messages[0].artifactPaths.some((path) => path.endsWith("runner-report.md")));
    assert.ok(existsSync(join(runDir, "cases", queueAfter[0].id, "attempt-1", "dispatch.json")));
    const envelope = writeEnvelope(runDir, messages[0]);
    assert.match(envelope.text, /^You are RunnerAgent-Model\./);
    assert.match(envelope.text, /MAILBOX_REQUEST=/);
    assert.match(envelope.text, /MAILBOX_STARTED=/);
    assert.match(envelope.text, /MAILBOX_REPLY=/);
    assert.doesNotMatch(envelope.text, /MAILBOX_JSON=/);
    assert.equal(existsSync(messages[0].body.mailboxRequestPath), true);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /^Activation mailbox JSON:/);
    assert.match(renderedTask, /Write this file before doing any task work/);
    assert.match(renderedTask, /\$example-skill\n/);
    assert.match(renderedTask, /Optional input path/);
    assert.match(renderedTask, /Write these files even if the task is blocked, ambiguous, unsupported, or failed/);
    assert.match(renderedTask, /Do not finish with chat-only status/);
    assert.match(renderedTask, /mailbox reply JSON/i);
    assert.match(renderedTask, /output-manifest\.json contract/i);
    assert.match(renderedTask, /"verdict": "pass"/i);
    assert.match(renderedTask, /"verification": \{ "pass": true \}/i);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("uses a compact runner envelope for evaluation-loop preset configs", () => {
    removeRunsDir();
    const fixture = createPresetEvaluationFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "1"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(next.status, 0, next.stderr || next.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    const envelope = writeEnvelope(runDir, messages[0]);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /Simple Loop Station case/i);
    assert.match(renderedTask, /Write exactly these files/i);
    assert.doesNotMatch(renderedTask, /human-owned checkpoint/i);
    assert.doesNotMatch(renderedTask, /provider entrypoints, wrappers, legacy launchers, or installers/i);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("dispatches guided multi-skill pipeline envelopes with public skill contracts", () => {
    removeRunsDir();
    const fixture = createMultiSkillConfigFixture();

    const start = runStation(["boot", "--limit", "1"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(next.status, 0, next.stderr || next.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].body.targetSkills.map((skill) => skill.name), ["$browser-flow", "$sheet-ops"]);
    assert.deepEqual(messages[0].body.stageContracts.map((stage) => stage.skill), ["$browser-flow", "$sheet-ops"]);
    const envelope = writeEnvelope(runDir, messages[0]);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /\$browser-flow/);
    assert.match(renderedTask, /\$sheet-ops/);
    assert.match(renderedTask, /Read only each public SKILL\.md/);
    assert.match(renderedTask, /runner-metadata\.json must record invokedSkills/);
    assert.match(renderedTask, /output-manifest\.json contract/i);
    assert.match(renderedTask, /Allowed public runtime boundaries/);
    assert.match(renderedTask, /capability_gap/);
    assert.doesNotMatch(renderedTask, /Do not run files from .*bundle\/runtime/);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("dispatches the first action stage to the configured model pane", () => {
    removeRunsDir();
    const fixture = createActionPipelineFixture();

    const start = runStation(["boot", "--limit", "1"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(next.status, 0, next.stderr || next.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "Runner1-Model");
    assert.equal(messages[0].stageId, "extract-entities");
    assert.equal(messages[0].type, "RUN_ACTION_STAGE");
    assert.ok(messages[0].artifactPaths.some((path) => path.endsWith("entities.json")));
    const envelope = writeEnvelope(runDir, messages[0]);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /Run this Loop Station action stage/);
    assert.match(renderedTask, /Stage instructions:/);
    assert.match(renderedTask, /Write all generated stage artifacts under:/);
    assert.doesNotMatch(renderedTask, /unsupported by the current prompt renderer/);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("advances action stages in order and then dispatches evaluation", () => {
    removeRunsDir();
    const fixture = createActionPipelineFixture();

    const start = runStation(["boot", "--limit", "1"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const attemptDir = join(runDir, "cases", queue[0].id, "attempt-1");
    const stageOneDir = join(attemptDir, "stages", "extract-entities");
    const stageOneMessageId = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"))[0].id;
    writeRunnerArtifacts(stageOneDir, { status: "passed", verdict: "pass" }, {
      agentName: "Runner1-Model",
      skillRuntimeEvidence: [{ skill: "$entity-extractor", evidence: "public skill invocation" }],
      status: "passed"
    });
    writeStageRuntimeEvidence(stageOneDir, stageOneMessageId, "$entity-extractor");
    writeFileSync(join(stageOneDir, "entities.json"), `${JSON.stringify({ entities: [{ id: "alpha", name: "Alpha", category: "tea", count: 2 }] }, null, 2)}\n`);

    const secondStage = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(secondStage.status, 0, secondStage.stderr || secondStage.stdout);

    let messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.at(-1).to, "Runner2-Model");
    assert.equal(messages.at(-1).stageId, "summarize-entities");

    const stageTwoDir = join(attemptDir, "stages", "summarize-entities");
    const stageTwoMessageId = messages.at(-1).id;
    writeRunnerArtifacts(stageTwoDir, { status: "passed", verdict: "pass" }, {
      agentName: "Runner2-Model",
      skillRuntimeEvidence: [{ skill: "$entity-summarizer", evidence: "public skill invocation" }],
      status: "passed"
    });
    writeStageRuntimeEvidence(stageTwoDir, stageTwoMessageId, "$entity-summarizer");
    writeFileSync(join(stageTwoDir, "summary.json"), `${JSON.stringify({ entity_count: 1, total_count: 2, category_totals: [{ category: "tea", count: 2 }], ids: ["alpha"] }, null, 2)}\n`);
    writeFileSync(join(stageTwoDir, "summary.md"), "summary\n");

    const evaluation = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(evaluation.status, 0, evaluation.stderr || evaluation.stdout);
    messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.at(-1).to, "EvaluatorAgent-Model");
    assert.equal(messages.at(-1).type, "EVALUATE_CASE");

    writeEvaluatorArtifacts(attemptDir, { verdict: "pass" });
    const finalTick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(finalTick.status, 0, finalTick.stderr || finalTick.stdout);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "case_passed");
    assert.equal(state.activeCaseId, null);
    assert.equal(state.activeStageId, null);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("does not dispatch a second case while one case is active", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const four = runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(four.status, 0, four.stderr || four.stdout);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queue.filter((item) => item.status === "active").length, 1);
    assert.deepEqual(queue.map((item) => item.attempts), [1, 0, 0, 0]);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].caseId, queue[0].id);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("dispatches up to runner lane capacity for managed-section configs", () => {
    removeRunsDir();
    const fixture = createManagedConfigFixture({ installSkill: true, runnerCount: 2, evaluatorCount: 1, providerCount: 1 });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const four = runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(four.status, 0, four.stderr || four.stdout);
    assert.match(four.stdout, /Dispatched 2 case\(s\)/);

    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.deepEqual(queue.map((item) => item.status), ["active_run", "active_run", "queued", "queued"]);
    assert.equal(state.lanes.length, 2);
    assert.deepEqual(state.lanes.map((lane) => lane.agentName), ["RunnerAgent-1-Model", "RunnerAgent-2-Model"]);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("queues completed runner lanes behind evaluator capacity in managed-section configs", () => {
    removeRunsDir();
    const fixture = createManagedConfigFixture({ installSkill: true, runnerCount: 2, evaluatorCount: 1, providerCount: 1 });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    writeRunnerArtifacts(join(runDir, "cases", queue[0].id, "attempt-1"), { status: "passed", verdict: "pass" }, { agentName: "RunnerAgent-1-Model" });
    writeRunnerArtifacts(join(runDir, "cases", queue[1].id, "attempt-1"), { status: "passed", verdict: "pass" }, { agentName: "RunnerAgent-2-Model" });

    const tick = runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

	    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
	    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
	    assert.equal(queue.filter((item) => item.status === "active_evaluation").length, 1);
	    assert.equal(queue.filter((item) => item.status === "waiting_evaluation").length, 1);
	    const evaluationLanes = state.lanes.filter((lane) => lane.stageId === "evaluate");
	    assert.equal(evaluationLanes.length, 1);
	    assert.equal(evaluationLanes[0].agentName, "JudgmentAgent-1-Model");

	    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("queues failed runner lanes behind provider capacity in managed-section configs", () => {
    removeRunsDir();
    const fixture = createManagedConfigFixture({ installSkill: true, runnerCount: 2, evaluatorCount: 1, providerCount: 1 });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    writeRunnerArtifacts(join(runDir, "cases", queue[0].id, "attempt-1"), { status: "DONE", verdict: "fail" }, { agentName: "RunnerAgent-1-Model" });
    writeRunnerArtifacts(join(runDir, "cases", queue[1].id, "attempt-1"), { status: "DONE", verdict: "fail" }, { agentName: "RunnerAgent-2-Model" });

    const tick = runStation(["run-four", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

	    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
	    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
	    assert.equal(queue.filter((item) => item.status === "active_provider").length, 1);
	    assert.equal(queue.filter((item) => item.status === "waiting_provider").length, 1);
	    const providerLanes = state.lanes.filter((lane) => lane.stageId === "provider_feedback");
	    assert.equal(providerLanes.length, 1);
	    assert.equal(providerLanes[0].agentName, "ProviderEngineer-1-Model");

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("advances a passed runner attempt only after evaluator pass and dispatches the next queued case", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const firstCaseId = queue[0].id;
    const attemptDir = join(runDir, "cases", firstCaseId, "attempt-1");
    writeRunnerArtifacts(attemptDir, { status: "passed", verdict: "pass" });

    const evaluation = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(evaluation.status, 0, evaluation.stderr || evaluation.stdout);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    let state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    let messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queue[0].status, "active");
    assert.equal(queue[1].status, "queued");
    assert.equal(state.activeCaseId, firstCaseId);
    assert.equal(state.activeStageId, "evaluate");
    assert.equal(messages.filter((message) => message.type === "EVALUATE_CASE").length, 1);

    writeEvaluatorArtifacts(attemptDir, { verdict: "pass" });
    const second = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(second.status, 0, second.stderr || second.stdout);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queue[0].status, "case_passed");
    assert.equal(queue[1].status, "active");
    assert.equal(queue[1].attempts, 1);
    assert.equal(state.completedCases, 1);
    assert.equal(state.activeCaseId, queue[1].id);
    assert.equal(messages.filter((message) => message.type === "RUN_SKILL_CASE").length, 2);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("sends evaluator failures to provider feedback without dispatching the next case", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const firstCaseId = queue[0].id;
    const attemptDir = join(runDir, "cases", firstCaseId, "attempt-1");
    writeRunnerArtifacts(attemptDir, { status: "done", verdict: "pass" });
    const evaluation = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(evaluation.status, 0, evaluation.stderr || evaluation.stdout);
    writeEvaluatorArtifacts(attemptDir, { verdict: "fail", reason: "source evidence did not prove browser-flow ran" });

    const failed = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(failed.status, 0, failed.stderr || failed.stdout);

    const queueAfter = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queueAfter[0].status, "case_failed_needs_provider");
    assert.equal(queueAfter[1].status, "queued");
    assert.equal(state.activeCaseId, firstCaseId);
    assert.equal(state.activeStageId, "provider_feedback");
    assert.equal(messages.filter((message) => message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX").length, 1);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("tells the judgment pane not to treat active evaluation state as failure evidence", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const attemptDir = join(runDir, "cases", queue[0].id, "attempt-1");
    writeRunnerArtifacts(attemptDir, { status: "passed", verdict: "pass" });

    const tick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(tick.status, 0, tick.stderr || tick.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    const evaluation = messages.find((message) => message.type === "EVALUATE_CASE");
    assert.match(evaluation.body.mailboxReplyPath, /mailbox\/(?:JudgmentAgent|EvaluatorAgent)-Model\/reply\//);
    assert.equal(evaluation.body.mailboxReplyContract.role, "judgment");
    const envelope = writeEnvelope(runDir, evaluation);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /The case is expected to be in an evaluation stage while you are writing these artifacts/i);
    assert.match(renderedTask, /Do not use current queue state, active_evaluation, active evaluator status, or the fact that evaluator output is not written yet as failure evidence/i);
    assert.match(renderedTask, /Do not inspect queue\.json, state\.json, messages\.json, station\.log, events\.ndjson, panes\.json, or other station-control files as evaluation evidence/i);
    assert.match(renderedTask, /Keep the evaluation short and evidence-based/i);
    assert.match(renderedTask, /mailbox reply JSON/i);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("routes recovery provisional passes through challenge review before provider fix", () => {
    removeRunsDir();
    const fixture = createPresetRecoveryFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const attemptDir = join(runDir, "cases", queue[0].id, "attempt-1");
    writeRunnerArtifacts(attemptDir, { status: "passed", verdict: "pass" }, { agentName: "RunnerAgent-1-Model" });

    const evalTick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(evalTick.status, 0, evalTick.stderr || evalTick.stdout);
    writeEvaluatorArtifacts(attemptDir, { verdict: "provisional_pass", challenge_question: "Why should this not pass yet?" });

    const challengeTick = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(challengeTick.status, 0, challengeTick.stderr || challengeTick.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.at(-1).type, "CHALLENGE_REVIEW");
    assert.equal(messages.at(-1).stageId, "challenge_review");

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queue[0].status, "active_challenge_review");

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("does not advance while runner artifacts are incomplete", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const firstCaseId = queue[0].id;
    const attemptDir = join(runDir, "cases", firstCaseId, "attempt-1");
    writeFileSync(join(attemptDir, "runner-report.md"), "report\n");
    writeFileSync(join(attemptDir, "runner-metadata.json"), "{}\n");

    const blocked = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
    assert.match(blocked.stdout, /No case dispatched/);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queue[0].status, "active");
    assert.equal(queue[1].status, "queued");
    assert.equal(state.activeCaseId, firstCaseId);
    assert.equal(messages.filter((message) => message.type === "RUN_SKILL_CASE").length, 1);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("rejects a runner attempt that modifies the case folder", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const firstCaseId = queue[0].id;
    const attemptDir = join(runDir, "cases", firstCaseId, "attempt-1");
    writeFileSync(join(queue[0].folder, "prompt-resolved.md"), "derived prompt\n");
    writeRunnerArtifacts(attemptDir, { status: "DONE", verification: { pass: true } });

    const gate = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(gate.status, 0, gate.stderr || gate.stdout);
    assert.match(gate.stdout, /No case dispatched/);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const failure = JSON.parse(readFileSync(join(attemptDir, "loop-station-failure.json"), "utf8"));
    assert.equal(queue[0].status, "case_failed_needs_provider");
    assert.equal(queue[1].status, "queued");
    assert.equal(state.activeCaseId, firstCaseId);
    assert.equal(state.activeStageId, "provider_feedback");
    assert.equal(failure.reason, "case_folder_modified");
    assert.deepEqual(failure.guardViolations, ["case folder file created: prompt-resolved.md"]);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("reports result packages to ProviderCodex-Model and gates failed cases on provider response", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);

    const runDir = latestRunDir();
    const next = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(next.status, 0, next.stderr || next.stdout);
    const queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const caseId = queue[0].id;
    const attemptDir = join(runDir, "cases", caseId, "attempt-1");
    writeFileSync(join(attemptDir, "runner-report.md"), "# Runner report\n\nStatus: failed\n");
    writeFileSync(join(attemptDir, "runner-metadata.json"), "{\"status\":\"failed\"}\n");
    writeFileSync(join(attemptDir, "output-manifest.json"), "{\"status\":\"missing\"}\n");

    const report = runStation(["report-provider", caseId, "failed", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(report.status, 0, report.stderr || report.stdout);

    const messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    const providerMessage = messages.find((message) => message.to === "ProviderCodex-Model");
    assert.equal(providerMessage.type, "REPORT_CASE_RESULT_TO_PROVIDER_CODEX");
    assert.equal(providerMessage.caseId, caseId);
    assert.equal(providerMessage.body.status, "failed");
    assert.match(providerMessage.body.rule, /Loop-station will not patch provider files/);
    assert.ok(providerMessage.body.providerResponses.markdown.endsWith("provider-response.md"));

    const envelope = writeEnvelope(runDir, providerMessage);
    const renderedTask = envelope.controlMessage.body.renderedTask;
    assert.match(renderedTask, /Loop-station verdict/);
    assert.match(renderedTask, /Required completion contract/);
    assert.match(renderedTask, /Loop-station failure summary/);
    assert.match(renderedTask, /fixed/);
    assert.match(renderedTask, /known_unsupported/);
    assert.match(renderedTask, /needs_human/);
    assert.match(renderedTask, /provider-response\.md/);
    assert.match(renderedTask, /provider-response\.json/);
    assert.doesNotMatch(renderedTask, /station recorded|case advanced|loop-station recorded/i);

    const stillActive = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(stillActive.activeCaseId, caseId);
    writeFileSync(join(attemptDir, "provider-response.md"), "# Provider response\n\nResponse: `fixed`\n");
    writeFileSync(join(attemptDir, "provider-response.json"), "{\"response\":\"fixed\"}\n");
    const stateAfterFilesOnly = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const queueAfterFilesOnly = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(stateAfterFilesOnly.activeCaseId, caseId);
    assert.equal(queueAfterFilesOnly[0].status, "active");

    const unsupported = runStation(["provider-response", caseId, "known_unsupported"], { STATION_CONFIG: fixture.configPath });
    assert.equal(unsupported.status, 0, unsupported.stderr || unsupported.stdout);

    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    const queueAfter = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(state.activeCaseId, null);
    assert.equal(state.completedCases, 1);
    assert.equal(queueAfter[0].status, "case_known_unsupported");

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("gates a failed completed attempt on provider response before rerunning same case", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();
    const first = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    let queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    const caseId = queue[0].id;
    writeRunnerArtifacts(join(runDir, "cases", caseId, "attempt-1"), { status: "DONE", verdict: "fail" });

    const gate = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(gate.status, 0, gate.stderr || gate.stdout);
    assert.match(gate.stdout, /No case dispatched/);

    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    let state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    let messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(queue[0].status, "case_failed_needs_provider");
    assert.equal(queue[1].status, "queued");
    assert.equal(state.activeCaseId, caseId);
    assert.equal(state.activeStageId, "provider_feedback");
    assert.equal(messages.filter((message) => message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX").length, 1);

    const repeatedGate = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(repeatedGate.status, 0, repeatedGate.stderr || repeatedGate.stdout);
    messages = JSON.parse(readFileSync(join(runDir, "messages.json"), "utf8"));
    assert.equal(messages.filter((message) => message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX").length, 1);

    const fixed = runStation(["provider-response", caseId, "fixed", "--override"], { STATION_CONFIG: fixture.configPath });
    assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(queue[0].status, "rerun_queued");
    assert.equal(state.activeCaseId, null);
    assert.equal(state.completedCases, 0);

    const rerun = runStation(["run-next", "--dispatch-only"], { STATION_CONFIG: fixture.configPath });
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
    queue = JSON.parse(readFileSync(join(runDir, "queue.json"), "utf8"));
    assert.equal(queue[0].status, "active");
    assert.equal(queue[0].attempts, 2);
    assert.equal(queue[1].status, "queued");

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });

  it("fails loudly instead of spinning silently on an unknown active stage", () => {
    removeRunsDir();
    const fixture = createConfigFixture({ installSkill: true });

    const start = runStation(["boot", "--limit", "4"], { STATION_CONFIG: fixture.configPath });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const runDir = latestRunDir();

    // Force the run into a stage the non-managed tick path does not recognize.
    const statePath = join(runDir, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.activeStageId = "totally-unknown-stage";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const stuck = runStation(["run-next"], { STATION_CONFIG: fixture.configPath });
    assert.notEqual(stuck.status, 0, stuck.stdout);
    assert.match(stuck.stderr, /unknown active stage: totally-unknown-stage/);

    runStation(["cleanup"], { STATION_CONFIG: fixture.configPath });
  });
});

function createConfigFixture({ installSkill }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-test-"));
  const consumerRoot = join(dir, "consumer");
  const providerRoot = join(dir, "provider");
  const releaseRoot = join(dir, "release");
  const skillPath = join(consumerRoot, ".codex", "skills", "example-skill");
  mkdirSync(consumerRoot, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  if (installSkill) {
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest());
  }
  const config = JSON.parse(readFileSync(join(root, "station.json"), "utf8"));
  const caseRoot = join(dir, "cases");
  const caseManifest = join(dir, "cases.json");
  const cases = [];
  for (let index = 1; index <= 4; index += 1) {
    const id = `fixture-case-00${index}`;
    const folder = join(caseRoot, id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "prompt.md"), `prompt ${index}\n`);
    cases.push({
      id,
      folder,
      prompt: join(folder, "prompt.md"),
      optionalInputs: [],
      evaluationMode: "prompt-grounded"
    });
  }
  writeFileSync(caseManifest, `${JSON.stringify(cases, null, 2)}\n`);
  config.targetSkillName = "$example-skill";
  config.caseManifest = caseManifest;
  config.sessionPrefix = `loop-station-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  config.locations = {
    ...config.locations,
    providerRoot,
    releaseRoot,
    consumerRoot,
    consumerInstallTarget: consumerRoot,
    targetSkillInstallPath: skillPath
  };
  const configPath = join(dir, "station.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath, skillPath, consumerRoot };
}

function createMultiSkillConfigFixture() {
  const fixture = createConfigFixture({ installSkill: false });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  config.targetSkillName = null;
  config.targetSkills = [
    { name: "$browser-flow" },
    { name: "$sheet-ops" }
  ];
  config.stageContracts = [
    {
      id: "collect-coupang-results",
      skill: "$browser-flow",
      input: "Open Coupang and collect visible search results.",
      outputs: ["coupang-zero-drink-results.json"],
      evidence: ["browser transcript", "visible product URLs"]
    },
    {
      id: "create-workbook",
      skill: "$sheet-ops",
      input: "Create workbook from coupang-zero-drink-results.json.",
      outputs: ["workbook-request.md", "xlsx workbook"],
      evidence: ["workbook path", "sheet name"]
    }
  ];
  for (const name of ["browser-flow", "sheet-ops"]) {
    const skillPath = join(fixture.consumerRoot, ".codex", "skills", name);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest({ name, description: `${name} fixture.` }));
  }
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function createManagedConfigFixture({ installSkill, runnerCount, evaluatorCount, providerCount }) {
  const fixture = createConfigFixture({ installSkill });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  config.layout = {
    mode: "full-team-visible",
    splitFallback: "new-window",
    operatorPanePolicy: "retain-left",
    sectionDirection: "vertical",
    groupOrder: ["control", "runners", "evaluators", "providers", "monitors", "custom"],
    groups: [
      { role: "orchestrator", count: 1, visible: true, cwd: "stationRoot", inputs: [], requiredArtifacts: [] },
      { role: "station-control", count: 1, visible: true, cwd: "stationRoot", inputs: [], requiredArtifacts: [] },
      { role: "runner", count: runnerCount, visible: true, cwd: "consumerRoot", inputs: ["RUN_SKILL_CASE"], requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json"] },
      { role: "evaluator", count: evaluatorCount, visible: true, cwd: "stationRoot", inputs: ["EVALUATE_CASE"], requiredArtifacts: ["eval-report.md", "eval-verdict.json"] },
      { role: "provider", count: providerCount, visible: true, cwd: "providerRoot", inputs: ["REPORT_CASE_RESULT_TO_PROVIDER_CODEX", "FOLLOW_UP_PROVIDER_RESPONSE"], requiredArtifacts: ["provider-response.md", "provider-response.json"] }
    ]
  };
  config.runtime = { autoDispatch: false };
  delete config.agents;
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function createActionPipelineFixture() {
  const fixture = createConfigFixture({ installSkill: false });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  config.targetSkillName = null;
  config.targetSkills = [];
  config.locations = {
    ...config.locations,
    consumerInstallTarget: null,
    targetSkillInstallPath: null
  };
  config.pipelineMode = "action-stages";
  config.agents = [
    { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
    { name: "Runner1-Model", role: "runner", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true, inputs: ["RUN_ACTION_STAGE"], requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"] },
    { name: "Runner2-Model", role: "runner", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true, inputs: ["RUN_ACTION_STAGE"], requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "summary.json", "summary.md"] },
    { name: "EvaluatorAgent-Model", role: "evaluator", kind: "model", cwd: "stationRoot", lifecycle: "attempt-scoped", visible: true, inputs: ["EVALUATE_CASE"], requiredArtifacts: ["eval-report.md", "eval-verdict.json"] }
  ];
  config.stageContracts = [
    {
      id: "extract-entities",
      skill: "$entity-extractor",
      installPath: join(fixture.consumerRoot, ".codex", "skills", "entity-extractor"),
      agentName: "Runner1-Model",
      messageType: "RUN_ACTION_STAGE",
      input: "Extract structured entities from the case input.",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"],
      artifactSchemas: {
        "entities.json": {
          type: "object",
          required: ["entities"],
          properties: {
            entities: {
              type: "array",
              minItems: 1
            }
          }
        }
      }
    },
    {
      id: "summarize-entities",
      skill: "$entity-summarizer",
      installPath: join(fixture.consumerRoot, ".codex", "skills", "entity-summarizer"),
      agentName: "Runner2-Model",
      messageType: "RUN_ACTION_STAGE",
      input: "Summarize the extracted entities into summary outputs.",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "summary.json", "summary.md"],
      artifactSchemas: {
        "summary.json": {
          type: "object",
          required: ["entity_count", "total_count", "category_totals", "ids"],
          properties: {
            entity_count: { type: "number" },
            total_count: { type: "number" },
            category_totals: { type: "array", minItems: 1 },
            ids: { type: "array", minItems: 1 }
          }
        }
      }
    }
  ];
  for (const name of ["entity-extractor", "entity-summarizer"]) {
    const skillPath = join(fixture.consumerRoot, ".codex", "skills", name);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest({ name, description: `${name} fixture.` }));
  }
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function createPresetRecoveryFixture({ installSkill }) {
  const fixture = createConfigFixture({ installSkill });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
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
  config.locations.consumerInstallTarget = config.locations.targetSkillInstallPath;
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function createPresetEvaluationFixture({ installSkill }) {
  const fixture = createConfigFixture({ installSkill });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  delete config.agents;
  config.profileMode = "preset";
  config.loopProfile = "evaluation-loop";
  config.topologyPreset = "evaluation-visible";
  config.roleCounts = {
    runner: 1,
    judgment: 1
  };
  config.phaseGraph = ["run", "judgment"];
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function writeRunnerArtifacts(attemptDir, manifest, metadata = {}) {
  const provenance = {
    messageId: "test-message",
    agentName: "RunnerAgent-Model",
    phaseEvidence: [{ id: "run", status: "done" }],
    skillRuntimeEvidence: [{ skill: "$example-skill", evidence: "public skill invocation" }],
    ...metadata
  };
  writeFileSync(join(attemptDir, "runner-report.md"), "report\n");
  writeFileSync(join(attemptDir, "runner-metadata.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  writeFileSync(join(attemptDir, "output-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeMailboxReplyFromDispatch(join(attemptDir, "dispatch.json"), {
    status: ["pass", "passed"].includes(String(manifest.verdict ?? "").toLowerCase()) ? "done" : "failed",
    summary: `runner ${manifest.verdict ?? manifest.status ?? "completed"}`,
    artifactPaths: ["runner-report.md", "runner-metadata.json", "output-manifest.json"]
  });
}

function writeEvaluatorArtifacts(attemptDir, verdict) {
  writeFileSync(join(attemptDir, "eval-report.md"), "# Evaluator Report\n");
  writeFileSync(join(attemptDir, "eval-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  writeMailboxReplyFromDispatch(join(attemptDir, "evaluation-dispatch.json"), {
    status: ["pass", "passed", "provisional_pass"].includes(String(verdict.verdict ?? "").toLowerCase()) ? "done" : (String(verdict.verdict ?? "").toLowerCase() === "needs_human" ? "needs_human" : "failed"),
    summary: `judgment ${verdict.verdict ?? "completed"}`,
    artifactPaths: ["eval-report.md", "eval-verdict.json"]
  });
}

function writeStageRuntimeEvidence(stageDir, messageId, stageSkill) {
  writeFileSync(join(stageDir, ".station-runtime-evidence.json"), `${JSON.stringify({
    messageId,
    paneId: "%1",
    stageId: stageDir.split("/").at(-1),
    stageSkill,
    acceptedAt: new Date().toISOString(),
    source: "test"
  }, null, 2)}\n`);
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

function skillManifest({ name = "example-skill", description = "Fixture skill for run-next tests." } = {}) {
  return `---
name: ${name}
description: ${description}
---

# ${name}
`;
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
  if (safeReadDir(runsDir).length > 0) runStation(["cleanup"]);
  removeRunsDir();
}

function safeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
