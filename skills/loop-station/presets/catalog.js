import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const catalogRoot = dirname(fileURLToPath(import.meta.url));
const roles = ["orchestrator", "runner", "judgment"];
const weights = {
  signalMatch: 35,
  authorityFit: 20,
  evidenceFit: 20,
  compatibility: 15,
  maturityLevel: 10
};

export function loadPresetCatalog(root = catalogRoot) {
  const shared = {};
  const rolePresets = {};
  for (const role of roles) {
    shared[role] = readJson(join(root, "shared", `${role}.json`));
    rolePresets[role] = readdirSync(join(root, "roles", role))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => readJson(join(root, "roles", role, file)));
  }
  return { root, roles: [...roles], shared, rolePresets };
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
    const candidates = [bundle.selected, ...(bundle.alternates ?? [])].filter(Boolean);
    const selected = requested
      ? candidates.find((candidate) => candidate.preset.id === requested || candidate.preset.specialization === requested)
      : bundle.selected;
    if (!selected) {
      throw new Error(`Unknown ${role} preset selection: ${requested}`);
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

  const presetRoot = join(stationRoot, "presets");
  const roleRoot = join(presetRoot, "roles");
  mkdirSync(roleRoot, { recursive: true });

  const summary = {
    recommendationId,
    generatedAt: new Date().toISOString(),
    source: "skills/loop-station/presets",
    signals,
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

function materializedRolePreset({ role, candidate, sharedPack, naturalReason }) {
  return {
    sourcePresetId: candidate.preset.id,
    role,
    level: candidate.preset.level,
    resolvedSharedTraits: {
      id: sharedPack.id,
      purpose: sharedPack.purpose,
      authority: sharedPack.authority,
      forbiddenResponsibilities: sharedPack.forbiddenResponsibilities,
      requiredEvidence: sharedPack.requiredEvidence,
      lifecycleDefaults: sharedPack.lifecycleDefaults
    },
    resolvedSpecialization: {
      specialization: candidate.preset.specialization,
      purpose: candidate.preset.purpose,
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

function scoreMaturityLevel(preset) {
  return ratioScore(Math.min(preset.level ?? 0, 5), 5, weights.maturityLevel);
}

function compareCandidateScores(left, right) {
  if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.dimensions.authorityFit !== left.dimensions.authorityFit) return right.dimensions.authorityFit - left.dimensions.authorityFit;
  if (right.dimensions.evidenceFit !== left.dimensions.evidenceFit) return right.dimensions.evidenceFit - left.dimensions.evidenceFit;
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
  return reasons;
}

export function explainRoleRecommendation(role, candidate, signals = {}) {
  const presetName = candidate.preset.title ?? candidate.preset.id;
  const context = setupContextSentence(signals);
  if (role === "orchestrator") {
    return `${context} The orchestrator should use ${presetName} because it is the role that controls when work moves from one station step to the next, and this preset matches the transition gates the setup needs before any runner or judgment work can be trusted.`;
  }
  if (role === "runner") {
    return `${context} The runner should use ${presetName} because the assigned work shape and runtime boundary require an executor that produces artifacts for exactly its assigned unit of work without deciding the final station verdict.`;
  }
  if (role === "judgment") {
    return `${context} The judgment role should use ${presetName} because the setup needs verdict artifacts based on the runner's evidence, provenance, and freshness rather than relying on runner self-report.`;
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
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function flattenSignalValues(source) {
  const values = [];
  for (const [key, value] of Object.entries(source ?? {})) {
    if (ignoredSignalKey(key)) continue;
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values.push(String(value));
  }
  return values;
}

function ignoredSignalKey(key) {
  return [
    "blockedPresetIds",
    "blockedResponsibilities",
    "discouragedResponsibilities",
    "peerCapabilities",
    "requiredArtifacts",
    "normalizedSignals"
  ].includes(key);
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
    maturityLevel: 0
  };
}

function unique(values) {
  return [...new Set(values)];
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
