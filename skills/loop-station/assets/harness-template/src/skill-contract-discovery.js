import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function discoverSkillProfile({ name, installPath, requestText = "" }) {
  const slug = skillSlug(name);
  const profile = {
    name: slug ? `$${slug}` : name,
    slug,
    installPath,
    publicEntryDocs: [],
    allowedPublicRuntimeCalls: [],
    forbiddenBypasses: [
      "hidden launchers",
      "provider binaries",
      "ad hoc scripts",
      "curl scraping",
      "direct spreadsheet libraries"
    ],
    phases: [],
    inputs: [],
    outputs: [],
    evidenceArtifacts: [],
    requiredEvidence: [],
    humanCheckpoints: [],
    llmDelegableCheckpoints: [],
    deterministicSteps: [],
    capabilityGaps: [],
    downstreamContract: null,
    requiresDataExtract: false,
    runnerMayFinalizeUnsupported: true
  };
  if (!installPath || !existsSync(installPath)) return profile;

  const skillText = readDoc(profile, installPath, "SKILL.md");
  const manifest = readManifest(installPath);
  const promptPath = manifest?.prompt ?? discoverPromptPath(skillText);
  const promptText = promptPath ? readDoc(profile, installPath, promptPath) : "";
  for (const ref of manifest?.references ?? []) readDoc(profile, installPath, ref);

  const combined = [skillText, promptText].filter(Boolean).join("\n");
  profile.allowedPublicRuntimeCalls = discoverAllowedRuntimeCalls(combined);
  profile.phases = discoverPhases(combined, requestText);
  profile.requiresDataExtract = profile.phases.some((phase) => phase.id === "extract");
  profile.requiredEvidence = discoverRequiredEvidence(combined, profile);
  profile.evidenceArtifacts = profile.requiredEvidence;
  profile.humanCheckpoints = discoverHumanCheckpoints(combined);
  profile.llmDelegableCheckpoints = discoverDelegableCheckpoints(combined);
  profile.deterministicSteps = profile.allowedPublicRuntimeCalls.map((call) => ({ kind: "public-runtime-call", call }));
  profile.capabilityGaps = discoverCapabilityGaps(combined, requestText);
  if (profile.capabilityGaps.length > 0) profile.runnerMayFinalizeUnsupported = false;
  profile.downstreamContract = downstreamContractFor(profile, requestText);
  return profile;
}

export function requestNeedsDataExtract(text = "") {
  return /(?:top\s*\d+|current|latest|prices?|rows?|lists?|table|values?|collect(?:ing)?|reading|checking values|검색\s*결과|목록|리스트|표|가격|현재|수집|조회)/i.test(text);
}

export function enrichStageContractsWithProfiles(stageContracts = [], skillProfiles = [], requestText = "") {
  return stageContracts.map((stage) => {
    const profile = skillProfiles.find((item) => item.name === stage.skill || item.slug === skillSlug(stage.skill));
    if (!profile) return stage;
    return {
      ...stage,
      phaseContracts: profile.phases,
      allowedPublicRuntimeCalls: profile.allowedPublicRuntimeCalls,
      humanCheckpoints: profile.humanCheckpoints,
      llmDelegableCheckpoints: profile.llmDelegableCheckpoints,
      deterministicSteps: profile.deterministicSteps,
      requiredEvidence: profile.requiredEvidence,
      capabilityGaps: profile.capabilityGaps,
      downstreamContract: profile.downstreamContract,
      requestRequiresDataExtract: requestNeedsDataExtract(requestText)
    };
  });
}

function readDoc(profile, installPath, relativePath) {
  const path = join(installPath, relativePath);
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  if (!profile.publicEntryDocs.some((doc) => doc.relativePath === relativePath)) {
    profile.publicEntryDocs.push({ relativePath, path });
  }
  return text;
}

function readManifest(installPath) {
  const path = join(installPath, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function discoverPromptPath(skillText) {
  const match = skillText.match(/Load\s+`?([A-Za-z0-9_.-]*prompt\.md)`?/i);
  return match?.[1] ?? null;
}

function discoverAllowedRuntimeCalls(text) {
  const calls = new Set();
  const runtimePath = text.match(/`([^`]*bundle\/runtime\/scripts\/cli\.mjs)`/);
  if (runtimePath) calls.add(runtimePath[1]);
  for (const match of text.matchAll(/node\s+([^\s`]*bundle\/runtime\/scripts\/cli\.mjs)(?:\s+[^\n`]*)?/g)) {
    calls.add(match[0].trim());
    calls.add(match[1].trim());
  }
  return [...calls];
}

function discoverPhases(text, requestText) {
  const phaseNames = [
    ["capture", /Phase\s+1\s+[^A-Za-z0-9]+Capture/i],
    ["analyze", /Phase\s+2\s+[^A-Za-z0-9]+Analyze/i],
    ["generate", /Phase\s+3\s+[^A-Za-z0-9]+Generate/i],
    ["verify", /Phase\s+4\s+[^A-Za-z0-9]+Verify/i],
    ["extract", /Phase\s+5\s+[^A-Za-z0-9]+Extract/i]
  ];
  const phases = phaseNames
    .filter(([id, pattern]) => pattern.test(text) && (id !== "extract" || requestNeedsDataExtract(requestText)))
    .map(([id]) => ({
      id,
      actor: id === "extract" ? "skill-orchestrator" : `${id}-phase`,
      allowedActor: allowedActorForPhase(id),
      kind: id === "extract" ? "llm-plus-runtime" : "public-runtime",
      captureMode: id === "capture" ? "human_manual" : null,
      checkpoint: id === "capture" ? "awaiting_capture" : null,
      requiredEvidence: requiredEvidenceForPhase(id),
      mayAdvanceWhen: mayAdvanceWhenForPhase(id)
    }));
  return phases;
}

function allowedActorForPhase(id) {
  if (id === "capture") return "human_user";
  if (id === "extract") return "runner_model";
  return "skill_runtime";
}

function requiredEvidenceForPhase(id) {
  if (id === "capture") return ["human_checkpoint_evidence"];
  if (id === "verify") return ["reports/verification.json"];
  if (id === "extract") return ["extract-result.json"];
  return [];
}

function mayAdvanceWhenForPhase(id) {
  if (id === "capture") return "human_capture_completed";
  if (id === "verify") return "verification_passed";
  if (id === "extract") return "extract_result_ready";
  return "phase_artifact_ready";
}

function discoverRequiredEvidence(text, profile) {
  const evidence = new Set();
  if (/verification\.json/i.test(text) || profile.phases.some((phase) => phase.id === "verify")) {
    evidence.add("reports/verification.json");
  }
  if (/extract-result\.json/i.test(text) || profile.phases.some((phase) => phase.id === "extract")) {
    evidence.add("extract-result.json");
  }
  if (/path\.yaml/i.test(text)) evidence.add("analysis/path.yaml");
  if (/recipe\.yaml/i.test(text)) evidence.add("analysis/recipe.yaml");
  return [...evidence];
}

function discoverHumanCheckpoints(text) {
  const checkpoints = [];
  if (/await(?:ing)?_capture|await_capture/i.test(text)) {
    checkpoints.push({
      id: "awaiting_capture",
      decision: "human_operates_visible_browser",
      requiredActor: "human_user",
      handoffInstruction: "Open visible Chrome and let the user perform the browser workflow before continuing.",
      completionSignal: "capture_done",
      alternatives: ["automation_driven_capture", "needs_human"]
    });
  }
  return checkpoints;
}

function discoverDelegableCheckpoints(text) {
  const checkpoints = [];
  if (/automation-driven capture|--headless/i.test(text)) {
    checkpoints.push({
      id: "automation_driven_capture",
      decision: "llm_may_operate_when_user_requested_or_station_config_allows"
    });
  }
  return checkpoints;
}

function discoverCapabilityGaps(text, requestText) {
  const gaps = [];
  if (/`?write_values`?\s+is\s+not\s+a\s+public\s+agent\s+capability/i.test(text) && /(?:xlsx|workbook|row|rows|write|엑셀|워크북|행)/i.test(requestText)) {
    gaps.push({
      capability: "write_values",
      status: "not_public",
      handling: "provider_required"
    });
  }
  return gaps;
}

function downstreamContractFor(profile, requestText) {
  if (profile.slug === "browser-flow" && requestNeedsDataExtract(requestText)) {
    return {
      outputArtifact: "extract-result.json",
      handoff: "rows[] with source URL, captured timestamp, and evidence references"
    };
  }
  if (profile.slug === "sheet-ops") {
    return {
      outputArtifact: "UseEnvelopeV2 or provider-required capability gap evidence",
      handoff: "typed workbook request plus deterministic execution evidence"
    };
  }
  return null;
}

function skillSlug(name) {
  if (!name) return null;
  return String(name).replace(/^\$/, "");
}
