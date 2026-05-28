import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "station");

function runStation(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("station validate", () => {
  it("keeps smoke runs out of the harness template source tree", () => {
    const sourceRuns = join(root, "runs");
    rmSync(sourceRuns, { recursive: true, force: true });

    const result = runStation(["smoke-run-one"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(sourceRuns), false);
  });

  it("validates config, case manifest, and target skill install path", () => {
    const fixture = createConfigFixture({ installSkill: true });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.config.ok, true);
    assert.equal(report.checks.caseManifest.ok, true);
    assert.equal(report.checks.targetSkill.ok, true);
  });

  it("validates preset recovery configs without raw agents or groups", () => {
    const fixture = createPresetRecoveryConfigFixture({ installSkill: true });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.profile.ok, true);
    assert.equal(report.checks.profile.loopProfile, "recovery-loop");
    assert.equal(report.checks.profile.profileMode, "preset");
  });

  it("fails validation when a preset config injects raw agents", () => {
    const fixture = createPresetRecoveryConfigFixture({ installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.agents = [
      { name: "RunnerAgent-Model", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true }
    ];
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.profile.ok, false);
    assert.equal(report.checks.profile.reason, "preset_raw_agents_forbidden");
  });

  it("resolves target skills under consumer .codex/skills by default", () => {
    const fixture = createConfigFixture({ installSkill: true, explicitTargetSkillPath: false });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.targetSkill.ok, true);
    assert.match(report.checks.targetSkill.installPath, /\.codex\/skills\/example-skill$/);
    assert.equal(report.checks.targetSkill.manifest.name, "example-skill");
  });

  it("fails validation before dispatch when target skill install is missing", () => {
    const fixture = createConfigFixture({ installSkill: false });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.targetSkill.ok, false);
  });

  it("fails validation when target skill manifest front matter is missing", () => {
    const fixture = createConfigFixture({ installSkill: true, skillMarkdown: "# example skill\n" });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.targetSkill.ok, false);
    assert.equal(report.checks.targetSkill.reason, "target skill SKILL.md is missing YAML front matter");
  });

  it("fails validation when target skill manifest name does not match targetSkillName", () => {
    const fixture = createConfigFixture({
      installSkill: true,
      skillMarkdown: skillManifest({ name: "wrong-skill", description: "Fixture skill for validation." })
    });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.targetSkill.ok, false);
    assert.equal(report.checks.targetSkill.reason, "target skill manifest name does not match targetSkillName");
  });

  it("validates every configured target skill in a multi-skill pipeline", () => {
    const fixture = createMultiSkillConfigFixture({ missingSkill: null });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.targetSkill.ok, true);
    assert.deepEqual(report.checks.targetSkill.skills.map((skill) => skill.name), ["browser-flow", "sheet-ops"]);
    assert.deepEqual(report.checks.targetSkill.skills.map((skill) => skill.ok), [true, true]);
  });

  it("fails validation when any configured target skill in a multi-skill pipeline is missing", () => {
    const fixture = createMultiSkillConfigFixture({ missingSkill: "sheet-ops" });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.targetSkill.ok, false);
    const sheetOps = report.checks.targetSkill.skills.find((skill) => skill.name === "sheet-ops");
    assert.equal(sheetOps.ok, false);
    assert.match(sheetOps.reason, /missing/);
  });

  it("fails validation when single and multi target skill config are mixed", () => {
    const fixture = createMultiSkillConfigFixture({ missingSkill: null });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.targetSkillName = "$browser-flow";
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.targetSkill.ok, false);
    assert.equal(report.checks.targetSkill.reason, "targetSkillName cannot be combined with targetSkills");
  });

  it("fails validation when the required evaluator agent is missing", () => {
    const fixture = createConfigFixture({ installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.agents = config.agents.filter((agent) => agent.name !== "EvaluatorAgent-Model");
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.agents.ok, false);
    assert.equal(report.checks.agents.reason, "missing_required_agent");
    assert.equal(report.checks.agents.agentName, "JudgmentAgent-Model|EvaluatorAgent-Model|JudgeAgent-Model");
  });

  it("fails validation when the deterministic observer surface is missing", () => {
    const fixture = createConfigFixture({ installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.agents = config.agents.filter((agent) => agent.name !== "StationControl");
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.observer.ok, false);
    assert.equal(report.checks.observer.reason, "missing_required_observer");
  });

  it("fails validation for consumer action stages without wrapper skills", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: false, includeSchema: true, installSkill: false });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "generic_action_stage_forbidden");
  });

  it("ignores allowGenericActionStages in consumer validation", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: false, includeSchema: true, installSkill: false });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.runtimePolicy.allowGenericActionStages = true;
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "generic_action_stage_forbidden");
  });

  it("fails validation when an action-stage wrapper skill is missing", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: true, includeSchema: true, installSkill: false });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "stage_skill_invalid");
  });

  it("fails validation when an action-stage JSON artifact schema is missing", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: true, includeSchema: false, installSkill: true });

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "missing_artifact_schema");
  });

  it("fails validation when an action-stage phase actor is invalid", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: true, includeSchema: true, installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.stageContracts[0].phaseContracts = [{ id: "run", allowedActor: "provider_model" }];
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "stage_authority_contract_invalid");
    assert.equal(report.checks.actionStages.stageId, "extract-entities");
    assert.deepEqual(report.checks.actionStages.violations, ["phaseContracts[0].allowedActor invalid: provider_model"]);
  });

  it("fails validation when manual capture lacks awaiting_capture checkpoint", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: true, includeSchema: true, installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.stageContracts[0].phaseContracts = [{ id: "capture", allowedActor: "human_user", captureMode: "human_manual" }];
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.actionStages.ok, false);
    assert.equal(report.checks.actionStages.reason, "stage_authority_contract_invalid");
    assert.equal(report.checks.actionStages.stageId, "extract-entities");
    assert.deepEqual(report.checks.actionStages.violations, ["manual capture requires awaiting_capture human checkpoint"]);
  });

  it("fails validation when runner forbidden patterns are invalid", () => {
    const fixture = createActionPipelineConfigFixture({ includeSkill: true, includeSchema: true, installSkill: true });
    const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
    config.runnerForbiddenPatterns = ["form\\\\.submit\\\\s*\\\\("];
    writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = runStation(["validate", "--json", "--skip-tools"], { STATION_CONFIG: fixture.configPath });

    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.runnerGuards.ok, false);
    assert.equal(report.checks.runnerGuards.reason, "runner_guard_pattern_invalid");
    assert.equal(report.checks.runnerGuards.invalid[0].index, 0);
  });
});

function createConfigFixture({ installSkill, explicitTargetSkillPath = true, skillMarkdown = skillManifest() }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-validate-"));
  const consumerRoot = join(dir, "consumer");
  const skillPath = join(consumerRoot, ".codex", "skills", "example-skill");
  const providerRoot = join(dir, "provider");
  const releaseRoot = join(dir, "release");
  const caseRoot = join(dir, "cases");
  const caseFolder = join(caseRoot, "case-001");
  const caseManifest = join(dir, "cases.json");
  mkdirSync(caseFolder, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  if (installSkill) {
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillMarkdown);
  }
  writeFileSync(join(caseFolder, "prompt.md"), "Create output.txt\n");
  writeFileSync(caseManifest, `${JSON.stringify([{
    id: "case-001",
    folder: caseFolder,
    prompt: join(caseFolder, "prompt.md"),
    optionalInputs: [],
    evaluationMode: "prompt-grounded"
  }], null, 2)}\n`);
  const config = JSON.parse(readFileSync(join(root, "station.json"), "utf8"));
  config.targetSkillName = "$example-skill";
  config.caseManifest = caseManifest;
  config.locations = {
    ...config.locations,
    providerRoot,
    releaseRoot,
    consumerRoot,
    targetSkillInstallPath: explicitTargetSkillPath ? skillPath : null
  };
  const configPath = join(dir, "station.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath };
}

function createPresetRecoveryConfigFixture({ installSkill }) {
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
  config.layout = {
    mode: "full-team-visible",
    splitFallback: "new-window",
    operatorPanePolicy: "retain-left",
    sectionDirection: "vertical"
  };
  config.locations.consumerInstallTarget = config.locations.targetSkillInstallPath;
  writeFileSync(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return fixture;
}

function skillManifest({ name = "example-skill", description = "Fixture skill for validation." } = {}) {
  return `---
name: ${name}
description: ${description}
---

# ${name}

Fixture body.
`;
}

function createMultiSkillConfigFixture({ missingSkill }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-multi-skill-"));
  const consumerRoot = join(dir, "consumer");
  const providerRoot = join(dir, "provider");
  const releaseRoot = join(dir, "release");
  const caseRoot = join(dir, "cases");
  const caseFolder = join(caseRoot, "case-001");
  const caseManifest = join(dir, "cases.json");
  mkdirSync(caseFolder, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  for (const name of ["browser-flow", "sheet-ops"]) {
    if (name === missingSkill) continue;
    const skillPath = join(consumerRoot, ".codex", "skills", name);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest({ name, description: `${name} fixture.` }));
  }
  writeFileSync(join(caseFolder, "prompt.md"), "Run the pipeline\n");
  writeFileSync(caseManifest, `${JSON.stringify([{
    id: "case-001",
    folder: caseFolder,
    prompt: join(caseFolder, "prompt.md"),
    optionalInputs: [],
    evaluationMode: "prompt-grounded"
  }], null, 2)}\n`);
  const config = JSON.parse(readFileSync(join(root, "station.json"), "utf8"));
  config.targetSkillName = null;
  config.targetSkills = [
    { name: "$browser-flow" },
    { name: "$sheet-ops" }
  ];
  config.caseManifest = caseManifest;
  config.locations = {
    ...config.locations,
    providerRoot,
    releaseRoot,
    consumerRoot,
    targetSkillInstallPath: null
  };
  const configPath = join(dir, "station.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath };
}

function createActionPipelineConfigFixture({ includeSkill, includeSchema, installSkill }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-action-validate-"));
  const consumerRoot = join(dir, "consumer");
  const providerRoot = join(dir, "provider");
  const releaseRoot = join(dir, "release");
  const caseRoot = join(dir, "cases");
  const caseFolder = join(caseRoot, "case-001");
  const caseManifest = join(dir, "cases.json");
  mkdirSync(caseFolder, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(join(caseFolder, "prompt.md"), "Run the pipeline\n");
  writeFileSync(caseManifest, `${JSON.stringify([{
    id: "case-001",
    folder: caseFolder,
    prompt: join(caseFolder, "prompt.md"),
    optionalInputs: [],
    evaluationMode: "prompt-grounded"
  }], null, 2)}\n`);

  const stageSkillPath = join(consumerRoot, ".codex", "skills", "entity-extractor");
  if (installSkill) {
    mkdirSync(stageSkillPath, { recursive: true });
    writeFileSync(join(stageSkillPath, "SKILL.md"), skillManifest({ name: "entity-extractor", description: "Action-stage wrapper." }));
  }

  const config = JSON.parse(readFileSync(join(root, "station.json"), "utf8"));
  config.targetSkillName = null;
  config.targetSkills = [];
  config.pipelineMode = "action-stages";
  config.caseManifest = caseManifest;
  config.runtimePolicy = { attachRequired: true, allowDetached: false };
  config.locations = {
    ...config.locations,
    providerRoot,
    releaseRoot,
    consumerRoot,
    targetSkillInstallPath: null
  };
  config.agents = [
    { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
    { name: "Runner1-Model", role: "runner", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true, inputs: ["RUN_ACTION_STAGE"], requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"] },
    { name: "EvaluatorAgent-Model", role: "evaluator", kind: "model", cwd: "stationRoot", lifecycle: "attempt-scoped", visible: true, inputs: ["EVALUATE_CASE"], requiredArtifacts: ["eval-report.md", "eval-verdict.json"] }
  ];
  config.stageContracts = [
    {
      id: "extract-entities",
      ...(includeSkill ? { skill: "$entity-extractor", installPath: stageSkillPath } : {}),
      agentName: "Runner1-Model",
      messageType: "RUN_ACTION_STAGE",
      input: "Extract entities.",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"],
      ...(includeSchema ? {
        artifactSchemas: {
          "entities.json": {
            type: "object",
            required: ["entities"],
            properties: {
              entities: { type: "array", minItems: 1 }
            }
          }
        }
      } : {})
    }
  ];
  const configPath = join(dir, "station.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath };
}
