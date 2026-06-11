import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_TYPE_ORDER } from "./definitions.js";

const catalogRoot = dirname(fileURLToPath(import.meta.url));
const weights = {
  signalMatch: 30,
  authorityFit: 20,
  evidenceFit: 20,
  compatibility: 15,
  autonomyFit: 10,
  maturityLevel: 5
};

export function loadPresetCatalog(root = catalogRoot) {
  const shared = {};
  const rolePresets = {};
  for (const role of ROLE_TYPE_ORDER) {
    shared[role] = readJson(join(root, "shared", `${role}.json`));
    rolePresets[role] = readdirSync(join(root, "roles", role))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => readJson(join(root, "roles", role, file)));
  }
  return { root, roles: [...ROLE_TYPE_ORDER], shared, rolePresets };
}

export function recommendRolePresets(signals = {}, catalog = loadPresetCatalog()) {
  const recommended = {};
  for (const role of catalog.roles) {
    const candidates = catalog.rolePresets[role]
      .map((preset) => scoreRolePreset(preset, catalog.shared[role], signals))
      .sort(compareCandidateScores);
    const recommendable = candidates.filter((candidate) => !candidate.rejected);
    recommended[role] = {
      selected: recommendable[0] ?? null,
      alternates: recommendable.slice(1, 3),
      rejected: candidates.filter((candidate) => candidate.rejected)
    };
  }
  return recommended;
}

export function applyPresetSelections(recommendation, selections = {}) {
  const next = {};
  for (const [role, bundle] of Object.entries(recommendation ?? {})) {
    const requested = selections.roles?.[role] ?? selections[role] ?? null;
    const candidates = [bundle?.selected, ...(bundle?.alternates ?? [])].filter(Boolean);
    const selected = requested
      ? candidates.find((candidate) => candidate.preset?.id === requested || candidate.preset?.specialization === requested)
      : bundle?.selected;
    if (!selected) {
      if (requested) {
        throw new Error(`Unknown ${role} preset selection: ${requested}`);
      }
      throw new Error(`No recommended preset available for role: ${role}`);
    }
    next[role] = {
      ...bundle,
      selected,
      alternates: candidates.filter((candidate) => candidate.preset.id !== selected.preset.id).slice(0, 2),
      decision: {
        selectedPresetId: selected.preset.id,
        mode: requested ? "explicit-selection" : "recommended-default"
      }
    };
  }
  return next;
}

export function scoreRolePreset(preset, sharedPack, signals = {}) {
  const rejectionReasons = hardRejectReasons(preset, sharedPack, signals);
  if (rejectionReasons.length > 0) {
    return {
      preset,
      score: 0,
      confidence: "notRecommended",
      rejected: true,
      rejectionReasons,
      dimensions: zeroDimensions()
    };
  }

  const dimensions = {
    signalMatch: scoreSignalMatch(preset, signals),
    authorityFit: scoreAuthorityFit(preset, sharedPack, signals),
    evidenceFit: scoreEvidenceFit(preset, signals),
    compatibility: scoreCompatibility(preset, signals),
    autonomyFit: scoreAutonomyFit(preset, signals),
    maturityLevel: scoreMaturityLevel(preset)
  };
  const score = Math.round(Object.values(dimensions).reduce((sum, value) => sum + value, 0));
  return {
    preset,
    score,
    confidence: confidenceForScore(score),
    rejected: false,
    rejectionReasons: [],
    dimensions,
    reasons: explainScore(preset, dimensions)
  };
}

export function confidenceForScore(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "notRecommended";
}

export function materializePresetRecommendation({ stationRoot, recommendation, signals = {}, catalog = loadPresetCatalog(), recommendationId = "rec-001" }) {
  if (!stationRoot) throw new Error("stationRoot is required");
  const selected = selectedCandidates(recommendation);
  const compatibilityReport = analyzePresetRecommendationCompatibility({ recommendation, signals });

  const presetRoot = join(stationRoot, "presets");
  const roleRoot = join(presetRoot, "roles");
  mkdirSync(roleRoot, { recursive: true });

  const summary = {
    recommendationId,
    generatedAt: new Date().toISOString(),
    source: "skills/loop-station/presets",
    signals,
    compatibilityReport,
    roles: {},
    decisionFlow: []
  };

  for (const role of catalog.roles) {
    const candidate = selected[role];
    if (!candidate) continue;
    const materialized = materializedRolePreset({
      role,
      candidate,
      sharedPack: catalog.shared[role],
      naturalReason: explainRoleRecommendation(role, candidate, signals)
    });
    writeJson(join(roleRoot, `${role}.json`), materialized);
    summary.roles[role] = {
      sourcePresetId: candidate.preset.id,
      score: candidate.score,
      confidence: candidate.confidence,
      reason: materialized.selectedBecause.reason,
      materializedPath: `presets/roles/${role}.json`
    };
    summary.decisionFlow.push({
      role,
      selectedPresetId: candidate.preset.id,
      score: candidate.score,
      confidence: candidate.confidence,
      reason: materialized.selectedBecause.reason,
      alternates: (recommendation[role]?.alternates ?? []).map((alternate) => ({
        presetId: alternate.preset.id,
        score: alternate.score,
        confidence: alternate.confidence
      })),
      decision: recommendation[role]?.decision ?? null
    });
  }

  writeJson(join(presetRoot, "recommendation.json"), summary);
  return summary;
}

export function analyzePresetRecommendationCompatibility({ recommendation, signals = {} }) {
  const selected = selectedCandidates(recommendation);
  const signalCapabilities = new Set(signals.peerCapabilities ?? []);
  const selectedCapabilities = selectedRoleCapabilities(selected);
  const warnings = [];
  const errors = [];

  for (const [role, candidate] of Object.entries(selected)) {
    for (const [key, values] of Object.entries(candidate.preset.compatibility ?? {})) {
      if (!key.startsWith("requires")) continue;
      const peerRole = compatibilityPeerRole(key);
      const available = new Set([
        ...signalCapabilities,
        ...(peerRole ? Array.from(selectedCapabilities[peerRole] ?? []) : [])
      ]);
      const missing = values.filter((value) => !available.has(value));
      if (missing.length > 0) {
        warnings.push({
          role,
          presetId: candidate.preset.id,
          check: key,
          missing,
          message: `${candidate.preset.id} expects ${key} ${missing.join(", ")}. Confirm the selected peers or setup signals provide this before treating the recommendation as executable.`
        });
      }
    }
  }

  const runner = selected.runner?.preset;
  const judgment = selected.judgment?.preset;
  if (judgment && ["comparative", "challenge-review"].includes(judgment.specialization)) {
    const hasCandidateRunner = runner?.specialization === "parallel-candidate"
      || (signals.comparisonNeed ?? []).includes("runner-candidates")
      || signalCapabilities.has("candidate_output_identity");
    if (!hasCandidateRunner) {
      warnings.push({
        role: "judgment",
        presetId: judgment.id,
        check: "comparative-runner-candidate-pairing",
        missing: ["parallel runner candidate evidence"],
        message: `${judgment.id} compares or challenges candidate outputs, but the selected runner/signals do not clearly provide parallel candidate identity.`
      });
    }
  }

  return {
    ok: errors.length === 0,
    executable: false,
    authority: "setup-risk-report-only",
    warnings,
    errors
  };
}

function hardRejectReasons(preset, sharedPack, signals) {
  const reasons = [];
  const forbidden = new Set(sharedPack?.forbiddenResponsibilities ?? []);
  for (const added of preset.authority?.adds ?? []) {
    if (forbidden.has(added)) {
      reasons.push(`adds shared forbidden responsibility: ${added}`);
    }
  }

  const blockedPresetIds = new Set(signals.blockedPresetIds ?? []);
  if (blockedPresetIds.has(preset.id)) {
    reasons.push(`blocked preset id: ${preset.id}`);
  }

  const blockedResponsibilities = new Set(signals.blockedResponsibilities ?? []);
  for (const responsibility of [...(preset.authority?.adds ?? []), ...(preset.authority?.forbids ?? [])]) {
    if (blockedResponsibilities.has(responsibility)) {
      reasons.push(`blocked responsibility: ${responsibility}`);
    }
  }

  return reasons;
}

function selectedCandidates(recommendation) {
  const selected = {};
  for (const [role, bundle] of Object.entries(recommendation ?? {})) {
    if (bundle?.selected) selected[role] = bundle.selected;
  }
  return selected;
}

function selectedRoleCapabilities(selected) {
  const capabilities = {};
  for (const [role, candidate] of Object.entries(selected)) {
    capabilities[role] = new Set([
      candidate.preset.specialization,
      candidate.preset.specialization?.replaceAll("-", "_"),
      ...(candidate.preset.authority?.adds ?? [])
    ].filter(Boolean));
  }
  return capabilities;
}

function compatibilityPeerRole(key) {
  if (key.includes("Runner")) return "runner";
  if (key.includes("Judgment")) return "judgment";
  if (key.includes("Orchestrator")) return "orchestrator";
  return null;
}

function materializedRolePreset({ role, candidate, sharedPack, naturalReason }) {
  return {
    sourcePresetId: candidate.preset.id,
    role,
    roleFamily: candidate.preset.roleFamily,
    level: candidate.preset.level,
    autonomyLevel: candidate.preset.autonomyLevel,
    autonomyEvidence: candidate.preset.autonomyEvidence,
    autonomyLimits: candidate.preset.autonomyLimits,
    resolvedSharedTraits: {
      id: sharedPack.id,
      roleFamily: sharedPack.roleFamily,
      purpose: sharedPack.purpose,
      autonomyLevel: sharedPack.autonomyLevel,
      autonomyEvidence: sharedPack.autonomyEvidence,
      autonomyLimits: sharedPack.autonomyLimits,
      authority: sharedPack.authority,
      forbiddenResponsibilities: sharedPack.forbiddenResponsibilities,
      requiredEvidence: sharedPack.requiredEvidence,
      lifecycleDefaults: sharedPack.lifecycleDefaults
    },
    resolvedSpecialization: {
      specialization: candidate.preset.specialization,
      purpose: candidate.preset.purpose,
      roleFamily: candidate.preset.roleFamily,
      autonomyLevel: candidate.preset.autonomyLevel,
      autonomyEvidence: candidate.preset.autonomyEvidence,
      autonomyLimits: candidate.preset.autonomyLimits,
      signals: candidate.preset.signals,
      authority: candidate.preset.authority,
      artifacts: candidate.preset.artifacts,
      compatibility: candidate.preset.compatibility,
      promptReference: candidate.preset.promptReference
    },
    selectedBecause: {
      score: candidate.score,
      confidence: candidate.confidence,
      dimensions: candidate.dimensions,
      reason: naturalReason,
      reasons: candidate.reasons ?? []
    },
    stationLocalEditing: {
      editableAfterSetup: true,
      guidance: "Edit this materialized preset directly when the station needs local wording, artifact, prompt, or compatibility changes. Do not edit the built-in catalog copy."
    },
    selfReview: {
      completedAtSetup: true,
      findings: candidate.rejected ? candidate.rejectionReasons : []
    }
  };
}

function scoreSignalMatch(preset, signals) {
  const presetSignals = Object.entries(preset.signals ?? {});
  if (presetSignals.length === 0) return 0;

  const normalized = new Set(signals.normalizedSignals ?? []);
  let matches = 0;
  for (const [key, values] of presetSignals) {
    const requestedValues = new Set([...(signals[key] ?? []), ...normalized]);
    if ((values ?? []).some((value) => requestedValues.has(value))) {
      matches += 1;
    }
  }
  return ratioScore(matches, presetSignals.length, weights.signalMatch);
}

function scoreAuthorityFit(preset, sharedPack, signals) {
  const minimum = sharedPack?.scoringHints?.authorityFitMinimum ?? weights.authorityFit;
  const blocked = new Set(signals.discouragedResponsibilities ?? []);
  const responsibilities = [...(preset.authority?.adds ?? []), ...(preset.authority?.forbids ?? [])];
  const discouragedCount = responsibilities.filter((responsibility) => blocked.has(responsibility)).length;
  const penalty = Math.min(weights.authorityFit - minimum, discouragedCount * 5);
  return Math.max(minimum, weights.authorityFit - penalty);
}

function scoreEvidenceFit(preset, signals) {
  const required = new Set([...(signals.requiredArtifacts ?? []), ...(signals.evidenceStrictness ?? [])]);
  const presetArtifacts = preset.artifacts?.required ?? [];
  const artifactMatches = presetArtifacts.filter((artifact) => required.has(artifact)).length;
  const artifactScore = presetArtifacts.length === 0 ? 0 : ratioScore(artifactMatches, presetArtifacts.length, 12);

  let provenanceScore = 0;
  if (preset.artifacts?.provenanceRequired) {
    provenanceScore = required.has("provenance-required") || required.has("provenance") ? 8 : 4;
  }
  return Math.min(weights.evidenceFit, artifactScore + provenanceScore);
}

function scoreCompatibility(preset, signals) {
  const available = new Set(signals.peerCapabilities ?? []);
  const requiredValues = Object.entries(preset.compatibility ?? {})
    .filter(([key]) => key.startsWith("requires"))
    .flatMap(([, value]) => value);
  const compatibleValues = Object.entries(preset.compatibility ?? {})
    .filter(([key]) => key.startsWith("compatible"))
    .flatMap(([, value]) => value);
  const values = requiredValues.length > 0 ? requiredValues : compatibleValues;
  if (values.length === 0) return 0;
  const matches = values.filter((value) => available.has(value)).length;
  return ratioScore(matches, values.length, weights.compatibility);
}

function scoreAutonomyFit(preset, signals) {
  const requested = signals.requestedAutonomy?.[preset.role] ?? signals.requestedAutonomy?.[preset.roleFamily];
  if (requested == null) return ratioScore(Math.min(preset.autonomyLevel ?? 0, 5), 5, weights.autonomyFit);
  const level = preset.autonomyLevel ?? 0;
  const distance = Math.abs(level - requested);
  if (distance === 0) return weights.autonomyFit;
  if (level > requested && distance === 1) return Math.round(weights.autonomyFit * 0.8);
  if (level < requested && distance === 1) return Math.round(weights.autonomyFit * 0.6);
  if (level > requested) return Math.round(weights.autonomyFit * 0.4);
  return Math.round(weights.autonomyFit * 0.2);
}

function scoreMaturityLevel(preset) {
  return ratioScore(Math.min(preset.level ?? 0, 5), 5, weights.maturityLevel);
}

function compareCandidateScores(left, right) {
  if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.dimensions.authorityFit !== left.dimensions.authorityFit) return right.dimensions.authorityFit - left.dimensions.authorityFit;
  if (right.dimensions.evidenceFit !== left.dimensions.evidenceFit) return right.dimensions.evidenceFit - left.dimensions.evidenceFit;
  if (right.dimensions.autonomyFit !== left.dimensions.autonomyFit) return right.dimensions.autonomyFit - left.dimensions.autonomyFit;
  if ((right.preset.level ?? 0) !== (left.preset.level ?? 0)) return (right.preset.level ?? 0) - (left.preset.level ?? 0);
  return left.preset.id.localeCompare(right.preset.id);
}

function explainScore(preset, dimensions) {
  const reasons = [];
  const strongest = Object.entries(dimensions).sort(([, left], [, right]) => right - left)[0];
  if (strongest) {
    reasons.push(`${strongest[0]} contributed ${strongest[1]} points`);
  }
  if (preset.recommendation?.defaultConfidence) {
    reasons.push(`catalog default confidence is ${preset.recommendation.defaultConfidence}`);
  }
  if (preset.autonomyLevel != null) {
    reasons.push(`autonomy level is ${preset.autonomyLevel}; maturity level is ${preset.level}`);
  }
  return reasons;
}

export function explainRoleRecommendation(role, candidate, signals = {}) {
  const presetName = candidate.preset.title ?? candidate.preset.id;
  const context = setupContextSentence(signals);
  const autonomy = `It is autonomy level ${candidate.preset.autonomyLevel} while catalog maturity level remains ${candidate.preset.level}.`;
  if (role === "orchestrator") {
    return `${context} The orchestrator should use ${presetName} because it is the manager family role that controls when work moves from one station step to the next, and this preset matches the transition gates the setup needs before any runner or judgment work can be trusted. ${autonomy}`;
  }
  if (role === "runner") {
    return `${context} The runner should use ${presetName} because it is the performer family role and the assigned work shape and runtime boundary require an executor that produces artifacts for exactly its assigned unit of work without deciding the final station verdict. ${autonomy}`;
  }
  if (role === "judgment") {
    return `${context} The judgment role should use ${presetName} because it is the evaluator family role and the setup needs verdict artifacts based on the runner's evidence, provenance, and freshness rather than relying on runner self-report. ${autonomy}`;
  }
  return `${context} ${presetName} is the highest scoring preset for this role.`;
}

function setupContextSentence(signals) {
  const work = sentenceList(signals.workUnitShape);
  const evidence = sentenceList(signals.evidenceStrictness);
  const transition = sentenceList(signals.transitionStyle);
  const runtime = sentenceList(signals.runtimeBoundary);
  const parts = [];
  if (work) parts.push(`the work is shaped as ${work}`);
  if (transition) parts.push(`the station transition style is ${transition}`);
  if (evidence) parts.push(`the evidence requirement is ${evidence}`);
  if (runtime) parts.push(`the runner boundary is ${runtime}`);
  return `Because this setup says ${parts.join(", ") || "the role boundaries should stay explicit"}.`;
}

function sentenceList(values = []) {
  if (!Array.isArray(values) || values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function ratioScore(matches, total, max) {
  if (total <= 0) return 0;
  return Math.round((matches / total) * max);
}

function zeroDimensions() {
  return {
    signalMatch: 0,
    authorityFit: 0,
    evidenceFit: 0,
    compatibility: 0,
    autonomyFit: 0,
    maturityLevel: 0
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  // Atomic write-then-rename, with temp cleanup on failure (matches harness fs.writeJson).
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tempPath, filePath);
  } catch (error) {
    try { rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}
