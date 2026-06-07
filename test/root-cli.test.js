import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "loop-station");

describe("loop-station root CLI", () => {
  it("installs a project-local loop-station skill without creating .loop-station", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-skill-project-"));

    const result = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    const skillRoot = join(project, ".codex", "skills", "loop-station");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(skillRoot, "SKILL.md")), true);
    assert.equal(existsSync(join(skillRoot, "agents", "openai.yaml")), true);
    assert.equal(existsSync(join(skillRoot, "references", "interview.md")), true);
    assert.equal(existsSync(join(skillRoot, "assets", "harness-template", "station.json")), true);
    assert.equal(existsSync(join(project, ".loop-station")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("preserves an existing project-local loop-station skill during install-skill", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-skill-existing-"));
    const skillRoot = join(project, ".codex", "skills", "loop-station");

    const first = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(skillRoot, "SKILL.md"), "custom skill\n");
    const second = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /Existing loop-station skill install/);
    assert.equal(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), "custom skill\n");

    rmSync(project, { recursive: true, force: true });
  });

  it("replaces an existing project-local loop-station skill when requested", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-skill-replace-"));
    const skillRoot = join(project, ".codex", "skills", "loop-station");

    const first = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(skillRoot, "SKILL.md"), "legacy skill\n");
    writeFileSync(join(skillRoot, "legacy-sentinel.txt"), "old skill\n");
    const second = spawnSync(process.execPath, [bin, "install-skill", "--replace", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /Replaced loop-station skill/);
    assert.equal(existsSync(join(skillRoot, "legacy-sentinel.txt")), false);
    assert.notEqual(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), "legacy skill\n");

    rmSync(project, { recursive: true, force: true });
  });

  it("shell install helper installs the project-local skill bundle", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-skill-shell-"));

    const result = spawnSync("sh", [join(root, "bin", "install-skill.sh"), project], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(project, ".codex", "skills", "loop-station", "SKILL.md")), true);
    assert.equal(existsSync(join(project, ".loop-station")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("installs a project-local .loop-station harness", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-project-"));

    const result = spawnSync(process.execPath, [bin, "install", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    const stationRoot = join(project, ".loop-station");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(stationRoot, "bin", "station")), true);
    assert.equal(existsSync(join(stationRoot, "station.json")), true);
    assert.equal(existsSync(join(stationRoot, "runs")), true);
    assert.deepEqual(readdirSync(join(stationRoot, "runs")), []);
    assert.equal(existsSync(join(stationRoot, "test")), false);
    assert.equal(existsSync(join(stationRoot, "config")), false);
    assert.equal(existsSync(join(stationRoot, "eval")), false);

    const config = JSON.parse(readFileSync(join(stationRoot, "station.json"), "utf8"));
    assert.equal(config.locations.stationRoot, ".");
    assert.equal(config.locations.consumerRoot, "..");
    assert.equal(config.caseManifest, "cases.json");

    rmSync(project, { recursive: true, force: true });
  });

  it("preserves an existing .loop-station station.json during install", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-existing-"));
    const stationRoot = join(project, ".loop-station");

    const first = spawnSync(process.execPath, [bin, "install", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(stationRoot, "station.json"), "{\"name\":\"custom-station\"}\n");
    const second = spawnSync(process.execPath, [bin, "install", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /Existing loop-station install/);
    assert.equal(readFileSync(join(stationRoot, "station.json"), "utf8"), "{\"name\":\"custom-station\"}\n");

    rmSync(project, { recursive: true, force: true });
  });

  it("replaces an existing .loop-station without leaving a backup when requested", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-replace-"));
    const stationRoot = join(project, ".loop-station");

    const first = spawnSync(process.execPath, [bin, "install", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(stationRoot, "station.json"), "{\"name\":\"legacy-station\"}\n");
    writeFileSync(join(stationRoot, "legacy-sentinel.txt"), "old harness\n");
    const second = spawnSync(process.execPath, [bin, "install", "--replace", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /Replaced loop-station install/);
    assert.equal(existsSync(join(stationRoot, "bin", "station")), true);
    assert.equal(existsSync(join(stationRoot, "legacy-sentinel.txt")), false);
    assert.notEqual(readFileSync(join(stationRoot, "station.json"), "utf8"), "{\"name\":\"legacy-station\"}\n");
    assert.deepEqual(readdirSync(project).filter((entry) => entry.startsWith(".loop-station")), [".loop-station"]);

    rmSync(project, { recursive: true, force: true });
  });

  it("installed station validates using .loop-station/station.json by default", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-validate-project-"));

    const install = spawnSync(process.execPath, [bin, "install", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(install.status, 0, install.stderr || install.stdout);

    const stationBin = join(project, ".loop-station", "bin", "station");
    const validate = spawnSync(process.execPath, [stationBin, "validate", "--json", "--skip-tools"], {
      cwd: project,
      encoding: "utf8"
    });

    assert.equal(validate.status, 0, validate.stderr || validate.stdout);
    const report = JSON.parse(validate.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.config.path, "station.json");
    assert.equal(report.checks.caseManifest.ok, true);

    rmSync(project, { recursive: true, force: true });
  });

  it("initializes a harness directory from the bundled template", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-init-"));
    const destination = join(dir, "station");

    const result = spawnSync(process.execPath, [bin, "init", destination], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(destination, "bin", "station")), true);
    assert.equal(existsSync(join(destination, "station.json")), true);
    assert.equal(existsSync(join(destination, "config")), false);
    assert.match(readFileSync(join(destination, "package.json"), "utf8"), /loop-station-harness/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("setup generates a preset recovery station config", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-project-"));
    const home = mkdtempSync(join(tmpdir(), "loop-station-home-"));
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n');
    const skillInstall = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, HOME: home }
    });
    assert.equal(skillInstall.status, 0, skillInstall.stderr || skillInstall.stdout);
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "skill-improvement",
      targetSkills: ["$example-skill"],
      layout: { sectionDirection: "horizontal" },
      roles: {
        runner: 2,
        evaluator: 1,
        provider: 1,
        monitor: 1
      }
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, HOME: home }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = JSON.parse(readFileSync(join(project, ".loop-station", "station.json"), "utf8"));
    assert.equal(config.profileMode, "preset");
    assert.equal(config.loopProfile, "recovery-loop");
    assert.equal(config.topologyPreset, "legacy-aligned-visible");
    assert.deepEqual(config.phaseGraph, [
      "run",
      "judgment",
      "challenge_review",
      "provider_fix",
      "consumer_install",
      "deploy_verify",
      "rerun_gate"
    ]);
    assert.equal(config.layout.operatorPanePolicy, "retain-left");
    assert.equal(config.layout.sectionDirection, "horizontal");
    assert.equal(Array.isArray(config.layout.groups), false);
    assert.equal(Array.isArray(config.agents), false);
    assert.deepEqual(config.roleCounts, {
      runner: 2,
      judgment: 1,
      observer: 1,
      provider_engineer: 1,
      deploy_verifier: 1
    });
    assert.equal(config.runtime.autoDispatch, true);
    assert.equal(config.targetSkillName, "$example-skill");
    assert.deepEqual(config.runtimePolicy, { attachRequired: true, allowDetached: false, allowGenericActionStages: false });
    assert.equal(config.codexRuntime.invokerDefault.model, "gpt-5.4");
    assert.equal(config.codexRuntime.invokerDefault.model_reasoning_effort, "xhigh");

    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("setup scaffolds stage wrapper skills for action-stage consumer pipelines", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-action-project-"));
    const skillInstall = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(skillInstall.status, 0, skillInstall.stderr || skillInstall.stdout);
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "action-pipeline",
      roles: {
        runner: 2,
        evaluator: 1
      },
      stageContracts: [
        {
          id: "extract-entities",
          skill: "$entity-extractor",
          agentName: "Runner1-Model",
          messageType: "RUN_ACTION_STAGE",
          input: "Extract entities.",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"],
          artifactSchemas: {
            "entities.json": {
              type: "object",
              required: ["entities"],
              properties: {
                entities: { type: "array", minItems: 1 }
              }
            }
          }
        }
      ]
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const wrapperSkill = join(project, ".codex", "skills", "entity-extractor", "SKILL.md");
    assert.equal(existsSync(wrapperSkill), true);
    const config = JSON.parse(readFileSync(join(project, ".loop-station", "station.json"), "utf8"));
    assert.equal(config.pipelineMode, "action-stages");
    assert.equal(config.targetSkillName, null);
    assert.equal(config.targetSkills[0].name, "$entity-extractor");
    assert.equal(config.stageContracts[0].skill, "$entity-extractor");
    assert.ok(config.stageContracts[0].artifactSchemas["entities.json"]);
    const recommendation = JSON.parse(readFileSync(join(project, ".loop-station", "presets", "recommendation.json"), "utf8"));
    const orchestratorPreset = JSON.parse(readFileSync(join(project, ".loop-station", "presets", "roles", "orchestrator.json"), "utf8"));
    const runnerPreset = JSON.parse(readFileSync(join(project, ".loop-station", "presets", "roles", "runner.json"), "utf8"));
    const judgmentPreset = JSON.parse(readFileSync(join(project, ".loop-station", "presets", "roles", "judgment.json"), "utf8"));
    assert.equal(recommendation.recommendationId, "setup-default");
    assert.equal(recommendation.roles.orchestrator.sourcePresetId, "orchestrator.multi-stage");
    assert.equal(recommendation.roles.runner.sourcePresetId, "runner.stage-bound-action");
    assert.equal(recommendation.roles.judgment.sourcePresetId, "judgment.artifact-contract");
    assert.equal(recommendation.decisionFlow.length, 3);
    assert.match(recommendation.decisionFlow[0].reason, /orchestrator/i);
    assert.equal(orchestratorPreset.resolvedSharedTraits.id, "orchestrator.shared");
    assert.equal(runnerPreset.resolvedSpecialization.specialization, "stage-bound-action");
    assert.equal(judgmentPreset.selectedBecause.confidence, "high");
    assert.equal(runnerPreset.stationLocalEditing.editableAfterSetup, true);
    assert.equal(existsSync(join(project, ".loop-station", "preset-overrides")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("setup applies explicit role preset selections from the setup spec", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-selected-preset-"));
    const skillInstall = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(skillInstall.status, 0, skillInstall.stderr || skillInstall.stdout);
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "action-pipeline",
      stageContracts: [
        {
          id: "extract-entities",
          skill: "$entity-extractor",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"]
        }
      ],
      presetSelections: {
        roles: {
          orchestrator: "strict-sequential",
          runner: "artifact-producing",
          judgment: "process-evidence"
        }
      }
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const recommendation = JSON.parse(readFileSync(join(project, ".loop-station", "presets", "recommendation.json"), "utf8"));
    assert.equal(recommendation.roles.orchestrator.sourcePresetId, "orchestrator.strict-sequential");
    assert.equal(recommendation.roles.runner.sourcePresetId, "runner.artifact-producing");
    assert.equal(recommendation.roles.judgment.sourcePresetId, "judgment.process-evidence");
    assert.equal(recommendation.decisionFlow.every((decision) => decision.decision.mode === "explicit-selection"), true);

    rmSync(project, { recursive: true, force: true });
  });

  it("setup fails when the project-local loop-station skill is missing", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-missing-skill-"));
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "skill-benchmark",
      targetSkills: ["$example-skill"]
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /install-skill --project/);
    assert.equal(existsSync(join(project, ".loop-station")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("setup rejects mutable targets inside the installed loop-station bundle", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-readonly-"));
    const skillInstall = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(skillInstall.status, 0, skillInstall.stderr || skillInstall.stdout);
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "skill-benchmark",
      targetSkills: ["$example-skill"],
      locations: {
        stationRoot: ".codex/skills/loop-station/assets/harness-template/src"
      }
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /read-only|installed loop-station bundle|\.loop-station\/\*\*/);
    assert.equal(existsSync(join(project, ".loop-station")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("setup rejects stage wrapper install paths inside the installed loop-station bundle", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-setup-stage-readonly-"));
    const skillInstall = spawnSync(process.execPath, [bin, "install-skill", "--project", project], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(skillInstall.status, 0, skillInstall.stderr || skillInstall.stdout);
    const specPath = join(project, "setup-spec.json");
    writeFileSync(specPath, `${JSON.stringify({
      loopType: "action-pipeline",
      stageContracts: [
        {
          id: "bad-stage",
          skill: "$bad-skill",
          installPath: ".codex/skills/loop-station/assets/harness-template/src/bad-skill",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "bad.json"],
          artifactSchemas: {
            "bad.json": { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
          }
        }
      ]
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [bin, "setup", "--project", project, "--spec", specPath], {
      cwd: root,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stageContracts\[0\]\.installPath|read-only|wrapper skills/);
    assert.equal(existsSync(join(project, ".loop-station")), false);

    rmSync(project, { recursive: true, force: true });
  });

  it("interview prompts for target skill installation, evaluator gates, and tmux layout", () => {
    const result = spawnSync(process.execPath, [bin, "interview"], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /loop profile|recovery-loop|evaluation-loop|action-pipeline/i);
    assert.match(result.stdout, /target skill/i);
    assert.match(result.stdout, /project-local/i);
    assert.match(result.stdout, /judgment|observer|provider engineer|deploy verifier/i);
    assert.match(result.stdout, /managed section|operator pane|panes stack/i);
    assert.match(result.stdout, /managed section on the right|operator pane stay on the left/i);
    assert.match(result.stdout, /visible|attached Terminal|attach/i);
    assert.match(result.stdout, /setup proposal/i);
    assert.match(result.stdout, /install-skill/i);
    assert.match(result.stdout, /loop-station setup/i);
    assert.match(result.stdout, /Skill-install-only/i);
  });
});
