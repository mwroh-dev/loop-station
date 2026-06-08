import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyPresetSelections,
  loadPresetCatalog,
  materializePresetRecommendation,
  recommendRolePresets,
  scoreRolePreset
} from "../skills/loop-station/presets/catalog.js";
import { ROLE_PRESET_DEFINITIONS, ROLE_TYPE_ORDER, SHARED_TRAIT_PACKS } from "../skills/loop-station/presets/definitions.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const presetRoot = join(root, "skills", "loop-station", "presets");
const sharedRoot = join(presetRoot, "shared");
const roleRoot = join(presetRoot, "roles");

describe("preset generated artifacts", () => {
  it("keeps generated JSON synchronized with preset definitions", () => {
    assert.deepEqual(Object.keys(SHARED_TRAIT_PACKS).sort(), [...ROLE_TYPE_ORDER].sort());
    for (const role of ROLE_TYPE_ORDER) {
      assert.deepEqual(readSharedPack(role), SHARED_TRAIT_PACKS[role]);
      const generatedPresets = expectedPresetNames(role).map((presetName) => readRolePreset(role, presetName));
      assert.deepEqual(generatedPresets, ROLE_PRESET_DEFINITIONS[role]);
      for (const preset of ROLE_PRESET_DEFINITIONS[role]) {
        assertPromptReferenceExists(preset.promptReference);
      }
    }
  });
});

describe("preset catalog shared trait packs", () => {
  const expected = {
    orchestrator: {
      id: "orchestrator.shared",
      forbidden: ["runner_artifact_fabrication", "provider_source_patch", "raw_control_json_exposure_without_debug_mode"],
      evidence: ["mailboxStarted", "mailboxReply", "judgmentVerdict"],
      signals: ["transitionStyle", "failurePath"]
    },
    runner: {
      id: "runner.shared",
      forbidden: ["final_judgment", "station_advance", "target_skill_bypass", "human_checkpoint_replacement"],
      evidence: ["messageId", "agentName", "phaseEvidence", "skillRuntimeEvidence"],
      signals: ["workUnitShape", "runtimeBoundary", "mutationBoundary"]
    },
    judgment: {
      id: "judgment.shared",
      forbidden: ["runner_task_execution", "runner_artifact_fabrication", "station_advance", "chat_only_completion_acceptance"],
      evidence: ["activeRunId", "caseId", "messageId", "eval-verdict.json"],
      signals: ["evidenceStrictness", "comparisonNeed"]
    }
  };

  for (const [role, expectation] of Object.entries(expected)) {
    it(`defines a Level 3 shared trait pack for ${role}`, () => {
      const pack = readSharedPack(role);
      assert.equal(pack.id, expectation.id);
      assert.equal(pack.role, role);
      assert.equal(pack.level, 3);
      assert.equal(typeof pack.purpose, "string");
      assert.ok(pack.purpose.length > 20);
      assertNonEmptyArray(pack.authority, "authority");
      assertNonEmptyArray(pack.forbiddenResponsibilities, "forbiddenResponsibilities");
      assertNonEmptyArray(pack.requiredEvidence, "requiredEvidence");
      assertNonEmptyArray(pack.lifecycleDefaults, "lifecycleDefaults");
      assertNonEmptyArray(pack.selfReviewChecklist, "selfReviewChecklist");
      assert.equal(typeof pack.recommendationSignals, "object");
      assert.equal(typeof pack.scoringHints, "object");
      assert.equal(pack.scoringHints.authorityFitMinimum, 20);
      assertNonEmptyArray(pack.scoringHints.hardRejects, "scoringHints.hardRejects");
      for (const forbidden of expectation.forbidden) {
        assert.ok(pack.forbiddenResponsibilities.includes(forbidden), `${role} missing forbidden responsibility ${forbidden}`);
      }
      for (const evidence of expectation.evidence) {
        assert.ok(pack.requiredEvidence.includes(evidence), `${role} missing evidence ${evidence}`);
      }
      for (const signal of expectation.signals) {
        assertNonEmptyArray(pack.recommendationSignals[signal], `recommendationSignals.${signal}`);
      }
    });
  }
});

describe("preset catalog role specializations", () => {
  const expected = {
    orchestrator: {
      inherits: "orchestrator.shared",
      files: ["strict-sequential", "human-gated", "multi-stage", "recovery-rerun", "parallel-capacity"],
      roleFamily: "manager",
      sharedForbidden: ["runner_task_execution", "runner_artifact_fabrication", "judgment_verdict_fabrication"],
      requiredCapabilityPrefix: "compatible"
    },
    runner: {
      inherits: "runner.shared",
      files: ["artifact-producing", "stage-bound-action", "human-checkpoint", "parallel-candidate"],
      roleFamily: "performer",
      sharedForbidden: ["final_judgment", "station_advance", "target_skill_bypass"],
      requiredCapabilityPrefix: "requires"
    },
    judgment: {
      inherits: "judgment.shared",
      files: ["artifact-contract", "process-evidence", "comparative", "verifier-backed", "challenge-review"],
      roleFamily: "evaluator",
      sharedForbidden: ["runner_task_execution", "runner_artifact_fabrication", "station_advance"],
      requiredCapabilityPrefix: "requires"
    }
  };

  for (const [role, expectation] of Object.entries(expected)) {
    it(`defines Level 3 ${role} role presets with autonomy metadata`, () => {
      const sharedPack = readSharedPack(role);
      assert.equal(sharedPack.roleFamily, expectation.roleFamily);
      assert.equal(typeof sharedPack.autonomyLevel, "number");
      assertNonEmptyArray(sharedPack.autonomyEvidence, "shared.autonomyEvidence");
      assertNonEmptyArray(sharedPack.autonomyLimits, "shared.autonomyLimits");
      for (const presetName of expectation.files) {
        const preset = readRolePreset(role, presetName);
        assert.equal(preset.id, `${role}.${presetName}`);
        assert.equal(preset.role, role);
        assert.equal(preset.roleFamily, expectation.roleFamily);
        assert.equal(preset.inherits, expectation.inherits);
        assert.equal(preset.level, 3);
        assert.equal(typeof preset.autonomyLevel, "number");
        assert.ok(preset.autonomyLevel >= 0 && preset.autonomyLevel <= 5);
        assertNonEmptyArray(preset.autonomyEvidence, "autonomyEvidence");
        assertNonEmptyArray(preset.autonomyLimits, "autonomyLimits");
        assert.equal(preset.specialization, presetName);
        assert.ok(preset.purpose.length > 30);
        assertNonEmptyObject(preset.signals, "signals");
        assertNonEmptyArray(preset.authority.adds, "authority.adds");
        assertNonEmptyArray(preset.authority.forbids, "authority.forbids");
        assertNonEmptyArray(preset.artifacts.required, "artifacts.required");
        assert.equal(preset.artifacts.provenanceRequired, true);
        assertRecommendationShape(preset.recommendation);
        assertNonEmptyObject(preset.compatibility, "compatibility");
        assert.ok(
          Object.keys(preset.compatibility).some((key) => key.startsWith(expectation.requiredCapabilityPrefix)),
          `${preset.id} should name ${expectation.requiredCapabilityPrefix} compatibility`
        );
        assertPromptReferenceExists(preset.promptReference);
        assertNonEmptyArray(preset.selfReviewChecklist, "selfReviewChecklist");
        for (const forbidden of expectation.sharedForbidden) {
          assert.ok(!preset.authority.adds.includes(forbidden), `${preset.id} adds shared forbidden responsibility ${forbidden}`);
        }
        assert.ok(
          sharedPack.recommendationSignals == null || Object.keys(preset.signals).some((signal) => signal in sharedPack.recommendationSignals),
          `${preset.id} should use at least one shared recommendation signal`
        );
      }
    });
  }
});

describe("preset recommendation scoring", () => {
  it("selects human-gated role presets when setup signals require a human checkpoint", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["human-checkpoint"],
      transitionStyle: ["human-gated"],
      failurePath: ["human-pause"],
      runtimeBoundary: ["human-owned-runtime", "public-skill-only"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["human-evidence-required", "provenance-required"],
      requiredArtifacts: [
        "checkpoint-request.json",
        "checkpoint-evidence.json",
        "runner-report.md",
        "runner-metadata.json",
        "output-manifest.json",
        "eval-report.md",
        "eval-verdict.json"
      ],
      peerCapabilities: [
        "human_checkpoint_stop",
        "checkpoint_evidence_recording",
        "human_checkpoint_pause",
        "checkpoint_evidence_gate",
        "skill_runtime_evidence",
        "provenance"
      ]
    });

    assert.equal(recommendations.orchestrator.selected.preset.id, "orchestrator.human-gated");
    assert.equal(recommendations.runner.selected.preset.id, "runner.human-checkpoint");
    assert.equal(recommendations.judgment.selected.preset.id, "judgment.process-evidence");
    assert.ok(recommendations.orchestrator.selected.score >= 80);
    assert.ok(recommendations.runner.selected.score >= 80);
    assert.ok(recommendations.judgment.selected.score >= 60);
  });

  it("selects multi-stage and stage-bound presets for ordered stage contracts", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["ordered-stage"],
      transitionStyle: ["multi-stage", "strict-sequential"],
      failurePath: ["retry"],
      runtimeBoundary: ["public-skill-only", "allowed-runtime-call"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["artifacts-only", "schema-validated", "provenance-required"],
      comparisonNeed: ["none"],
      requiredArtifacts: ["stage-contract.json", "runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json"],
      peerCapabilities: [
        "execute_one_stage",
        "stop_after_assigned_stage",
        "stage_order_gate",
        "single_active_stage",
        "runner_artifacts",
        "judgment_required_advance"
      ]
    });

    assert.equal(recommendations.orchestrator.selected.preset.id, "orchestrator.multi-stage");
    assert.equal(recommendations.runner.selected.preset.id, "runner.stage-bound-action");
    assert.equal(recommendations.judgment.selected.preset.id, "judgment.artifact-contract");
    assert.equal(recommendations.orchestrator.selected.confidence, "high");
    assert.equal(recommendations.runner.selected.confidence, "high");
  });

  it("selects comparative judgment when multiple runner candidates must be compared", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["parallel-candidate", "single-case"],
      transitionStyle: ["strict-sequential"],
      runtimeBoundary: ["public-skill-only"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["artifacts-only", "schema-validated", "provenance-required"],
      comparisonNeed: ["runner-candidates"],
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json", "comparison-matrix.json"],
      requestedAutonomy: { orchestrator: 4, runner: 4, judgment: 4 },
      peerCapabilities: ["candidate_output_identity", "runner_artifacts", "parallel_lane_capacity_gate", "candidate_identity_gate", "comparative_judgment_gate", "judgment_required_advance"]
    });

    assert.equal(recommendations.orchestrator.selected.preset.id, "orchestrator.parallel-capacity");
    assert.equal(recommendations.runner.selected.preset.id, "runner.parallel-candidate");
    assert.equal(recommendations.judgment.selected.preset.id, "judgment.comparative");
    assert.ok(recommendations.judgment.alternates.some((candidate) => candidate.preset.id === "judgment.challenge-review"));
  });

  it("selects recovery rerun manager when setup signals require provider handoff and rerun gates", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["single-case", "repeated-case"],
      transitionStyle: ["recovery", "strict-sequential"],
      failurePath: ["provider-handoff", "deploy-verify", "retry", "stop"],
      runtimeBoundary: ["public-skill-only", "allowed-runtime-call"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["artifacts-only", "provenance-required", "verifier-required"],
      comparisonNeed: ["none"],
      requestedAutonomy: { orchestrator: 3, runner: 2, judgment: 4 },
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json", "reports/verification.json"],
      peerCapabilities: ["failure_evidence_router", "retry_rerun_gate", "provider_handoff_gate", "runner_artifacts", "skill_runtime_evidence", "provenance", "verifier_backed"]
    });

    assert.equal(recommendations.orchestrator.selected.preset.id, "orchestrator.recovery-rerun");
  });

  it("includes verifier-backed judgment when verifier, schema, and provenance evidence are required", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["ordered-stage"],
      transitionStyle: ["multi-stage", "strict-sequential"],
      failurePath: ["retry", "stop"],
      runtimeBoundary: ["public-skill-only", "allowed-runtime-call"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["artifacts-only", "schema-validated", "provenance-required", "verifier-required"],
      comparisonNeed: ["none"],
      requestedAutonomy: { orchestrator: 2, runner: 2, judgment: 4 },
      requiredArtifacts: ["stage-contract.json", "runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json", "reports/verification.json"],
      peerCapabilities: ["execute_one_stage", "stop_after_assigned_stage", "stage_order_gate", "single_active_stage", "runner_artifacts", "skill_runtime_evidence", "provenance", "judgment_required_advance"]
    });

    const judgmentCandidates = [recommendations.judgment.selected, ...recommendations.judgment.alternates].map((candidate) => candidate.preset.id);
    assert.ok(judgmentCandidates.includes("judgment.verifier-backed"));
  });

  it("hard rejects a candidate that adds a shared forbidden responsibility", () => {
    const catalog = loadPresetCatalog();
    const unsafeRunner = {
      ...readRolePreset("runner", "artifact-producing"),
      id: "runner.unsafe-final-judgment",
      authority: {
        adds: ["execute_one_case_attempt", "final_judgment"],
        forbids: []
      }
    };

    const score = scoreRolePreset(unsafeRunner, catalog.shared.runner, {
      workUnitShape: ["single-case"],
      requiredArtifacts: ["runner-report.md"]
    });

    assert.equal(score.rejected, true);
    assert.equal(score.score, 0);
    assert.equal(score.confidence, "notRecommended");
    assert.match(score.rejectionReasons.join("\n"), /final_judgment/);
  });

  it("maps close candidates into selected and alternate recommendation slots", () => {
    const recommendations = recommendRolePresets({
      workUnitShape: ["single-case", "repeated-case"],
      transitionStyle: ["strict-sequential"],
      failurePath: ["retry"],
      runtimeBoundary: ["public-skill-only", "allowed-runtime-call"],
      mutationBoundary: ["consumer-output"],
      evidenceStrictness: ["artifacts-only", "provenance-required"],
      comparisonNeed: ["none"],
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json"],
      peerCapabilities: ["single_active_dispatch", "judgment_required_advance", "runner_artifacts"]
    });

    assert.equal(recommendations.runner.selected.preset.id, "runner.artifact-producing");
    assert.ok(recommendations.runner.alternates.length > 0);
    assert.ok(recommendations.runner.alternates.every((candidate) => candidate.score <= recommendations.runner.selected.score));
  });

  it("reports missing recommended defaults separately from unknown explicit selections", () => {
    assert.throws(
      () => applyPresetSelections({ runner: { selected: null, alternates: [] } }),
      /No recommended preset available for role: runner/
    );
    assert.throws(
      () => applyPresetSelections({ runner: null }),
      /No recommended preset available for role: runner/
    );
    assert.throws(
      () => applyPresetSelections({ runner: { selected: null, alternates: [] } }, { roles: { runner: "runner.missing" } }),
      /Unknown runner preset selection: runner\.missing/
    );
  });
});

describe("preset materialization", () => {
  it("writes station-local editable preset copies without changing station config", () => {
    const stationRoot = mkdtempSync(join(tmpdir(), "loop-station-presets-"));
    const recommendation = recommendRolePresets(stageSignals());
    const summary = materializePresetRecommendation({
      stationRoot,
      recommendation,
      signals: stageSignals()
    });

    assert.equal(summary.roles.orchestrator.sourcePresetId, "orchestrator.multi-stage");
    assert.equal(summary.roles.runner.sourcePresetId, "runner.stage-bound-action");
    assert.equal(summary.roles.judgment.sourcePresetId, "judgment.artifact-contract");
    assert.equal(existsSync(join(stationRoot, "station.json")), false);

    const recommendationFile = readJson(join(stationRoot, "presets", "recommendation.json"));
    const runnerFile = readJson(join(stationRoot, "presets", "roles", "runner.json"));

    assert.equal(recommendationFile.roles.runner.sourcePresetId, "runner.stage-bound-action");
    assert.equal(recommendationFile.decisionFlow.length, 3);
    assert.equal(runnerFile.resolvedSharedTraits.id, "runner.shared");
    assert.equal(runnerFile.roleFamily, "performer");
    assert.equal(typeof runnerFile.autonomyLevel, "number");
    assertNonEmptyArray(runnerFile.autonomyEvidence, "runnerFile.autonomyEvidence");
    assertNonEmptyArray(runnerFile.autonomyLimits, "runnerFile.autonomyLimits");
    assert.equal(runnerFile.resolvedSpecialization.specialization, "stage-bound-action");
    assert.equal(runnerFile.resolvedSpecialization.roleFamily, "performer");
    assert.equal(runnerFile.selectedBecause.confidence, "high");
    assert.match(runnerFile.selectedBecause.reason, /Because this setup says/);
    assert.equal(runnerFile.stationLocalEditing.editableAfterSetup, true);
    assert.equal(existsSync(join(stationRoot, "preset-overrides")), false);
  });

  it("applies explicit role selections before materialization", () => {
    const stationRoot = mkdtempSync(join(tmpdir(), "loop-station-selected-presets-"));
    const recommendation = applyPresetSelections(recommendRolePresets(stageSignals()), {
      roles: {
        orchestrator: "strict-sequential",
        runner: "artifact-producing",
        judgment: "process-evidence"
      }
    });

    const summary = materializePresetRecommendation({ stationRoot, recommendation, signals: stageSignals() });
    assert.equal(summary.roles.orchestrator.sourcePresetId, "orchestrator.strict-sequential");
    assert.equal(summary.roles.runner.sourcePresetId, "runner.artifact-producing");
    assert.equal(summary.roles.judgment.sourcePresetId, "judgment.process-evidence");
    assert.equal(summary.decisionFlow.every((decision) => decision.decision.mode === "explicit-selection"), true);
  });
});

function readSharedPack(role) {
  return JSON.parse(readFileSync(join(sharedRoot, `${role}.json`), "utf8"));
}

function readRolePreset(role, presetName) {
  return JSON.parse(readFileSync(join(roleRoot, role, `${presetName}.json`), "utf8"));
}

function expectedPresetNames(role) {
  return ROLE_PRESET_DEFINITIONS[role].map((preset) => preset.specialization);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertNonEmptyArray(value, label) {
  assert.ok(Array.isArray(value), `${label} should be an array`);
  assert.ok(value.length > 0, `${label} should not be empty`);
}

function assertNonEmptyObject(value, label) {
  assert.equal(typeof value, "object", `${label} should be an object`);
  assert.ok(value !== null, `${label} should not be null`);
  assert.ok(Object.keys(value).length > 0, `${label} should not be empty`);
}

function assertRecommendationShape(recommendation) {
  assert.equal(typeof recommendation, "object");
  assert.ok(["high", "medium", "low"].includes(recommendation.defaultConfidence));
  assertNonEmptyArray(recommendation.preferredWhen, "recommendation.preferredWhen");
  assertNonEmptyArray(recommendation.avoidWhen, "recommendation.avoidWhen");
}

function assertPromptReferenceExists(promptReference) {
  assert.equal(typeof promptReference, "string");
  assert.ok(promptReference.endsWith(".md"), "promptReference should point to markdown guidance");
  assert.ok(existsSync(join(presetRoot, promptReference)), `missing promptReference ${promptReference}`);
}

function stageSignals() {
  return {
    workUnitShape: ["ordered-stage"],
    transitionStyle: ["multi-stage", "strict-sequential"],
    failurePath: ["retry"],
    runtimeBoundary: ["public-skill-only", "allowed-runtime-call"],
    mutationBoundary: ["consumer-output"],
    evidenceStrictness: ["artifacts-only", "schema-validated", "provenance-required"],
    comparisonNeed: ["none"],
    requestedAutonomy: { orchestrator: 2, runner: 2, judgment: 2 },
    requiredArtifacts: ["stage-contract.json", "runner-report.md", "runner-metadata.json", "output-manifest.json", "eval-report.md", "eval-verdict.json"],
    peerCapabilities: [
      "execute_one_stage",
      "stop_after_assigned_stage",
      "stage_order_gate",
      "single_active_stage",
      "runner_artifacts",
      "judgment_required_advance"
    ]
  };
}
