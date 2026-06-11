import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { evidenceIncludesSkill, validateStageArtifacts } from "./artifact-schema.js";
import { readJson } from "./fs.js";

export function inspectRunnerAttempt(attemptDir, options = {}) {
  const required = {
    runnerReport: join(attemptDir, "runner-report.md"),
    runnerMetadata: join(attemptDir, "runner-metadata.json"),
    outputManifest: join(attemptDir, "output-manifest.json")
  };
  const missing = Object.entries(required)
    .filter(([, path]) => !isNonEmptyFile(path))
    .map(([name]) => name);
  if (missing.length > 0) {
    return { complete: false, passed: false, failed: false, missing, required };
  }

  let manifest;
  let metadata = {};
  try {
    manifest = readJson(required.outputManifest);
  } catch (error) {
    return { complete: false, passed: false, failed: true, reason: "invalid_output_manifest", error: error.message, required };
  }
  try {
    metadata = readJson(required.runnerMetadata);
  } catch {
    metadata = {};
  }

  const guardViolations = listGuardViolations(attemptDir, options);
  if (guardViolations.length > 0) {
    return {
      complete: true,
      passed: false,
      failed: true,
      reason: "runner_bypass_artifacts_detected",
      guardViolations,
      manifest,
      required
    };
  }

  const status = String(manifest.status ?? manifest.state ?? metadata.status ?? metadata.state ?? "").toLowerCase();
  const verdict = String(manifest.verdict ?? manifest.result ?? manifest.outcome ?? metadata.verdict ?? metadata.result ?? metadata.outcome ?? "").toLowerCase();
  const verificationPass = manifest.verification?.pass === true || metadata.verification?.pass === true || metadata.verification_pass === true;
  const explicitFailure = ["fail", "failed", "failure", "error", "errored"].includes(verdict);
  const terminalFailure = ["ambiguous", "blocked", "failed", "failure", "error", "errored", "unsupported", "known_unsupported"].includes(status);
  const done = ["done", "passed", "pass", "success", "succeeded"].includes(status) || terminalFailure;
  const passed = done && !terminalFailure && !explicitFailure && (verificationPass || verdict === "" || ["pass", "passed", "success", "succeeded"].includes(verdict));
  const provenanceFailure = passed ? inspectAttemptProvenance(attemptDir, manifest, metadata, options) : null;
  if (provenanceFailure) {
    return {
      complete: true,
      passed: false,
      failed: true,
      manifest,
      required,
      ...provenanceFailure
    };
  }
  return {
    complete: done,
    passed,
    failed: done && !passed,
    reason: done ? (passed ? "runner_attempt_passed" : "runner_attempt_failed") : "runner_attempt_not_done",
    manifest,
    required
  };
}

export function inspectActionStageAttempt(stageDir, stage = {}, options = {}) {
  const dispatchPath = options.dispatchPath ?? join(stageDir, "dispatch.json");
  const base = inspectRunnerAttempt(stageDir, { ...options, dispatchPath });
  if (!base.complete || !base.passed) return base;

  const extraRequired = (stage.requiredArtifacts ?? [])
    .filter((name) => !["runner-report.md", "runner-metadata.json", "output-manifest.json"].includes(name))
    .map((name) => join(stageDir, name));
  const missingExtra = extraRequired.filter((path) => !isNonEmptyFile(path));
  if (missingExtra.length > 0) {
    return {
      complete: false,
      passed: false,
      failed: false,
      missing: missingExtra,
      required: {
        ...(base.required ?? {}),
        extraArtifacts: extraRequired
      }
    };
  }

  const schemaViolations = validateStageArtifacts(stageDir, stage);
  if (schemaViolations.length > 0) {
    return {
      complete: true,
      passed: false,
      failed: true,
      reason: "artifact_schema_violation",
      guardViolations: schemaViolations,
      manifest: base.manifest,
      required: base.required
    };
  }

  const metadataPath = join(stageDir, "runner-metadata.json");
  let metadata = {};
  try {
    metadata = readJson(metadataPath);
  } catch {}
  if (stage.skill && !evidenceIncludesSkill(metadata.skillRuntimeEvidence, stage.skill)) {
    return {
      complete: true,
      passed: false,
      failed: true,
      reason: "missing_stage_skill_evidence",
      guardViolations: [`stage skill evidence missing for ${stage.skill}`],
      manifest: base.manifest,
      required: base.required
    };
  }

  const dispatchEvidencePath = join(stageDir, ".station-dispatch-evidence.json");
  const legacyRuntimeEvidencePath = join(stageDir, ".station-runtime-evidence.json");
  let dispatchEvidence = null;
  try {
    dispatchEvidence = readJson(dispatchEvidencePath);
  } catch {
    try {
      dispatchEvidence = readJson(legacyRuntimeEvidencePath);
    } catch {}
  }
  let dispatchRecordId = null;
  try {
    dispatchRecordId = readJson(dispatchPath).id;
  } catch {}
  if (!dispatchEvidence || !evidenceIncludesSkill(dispatchEvidence.stageSkill, stage.skill) || dispatchEvidence.messageId !== dispatchRecordId) {
    return {
      complete: true,
      passed: false,
      failed: true,
      reason: "missing_mailbox_activation_evidence",
      guardViolations: [`mailbox activation evidence missing or mismatched for ${stage.skill}`],
      manifest: base.manifest,
      required: base.required
    };
  }

  return base;
}

function inspectAttemptProvenance(attemptDir, manifest, metadata, options = {}) {
  const dispatchPath = options.dispatchPath ?? join(attemptDir, "dispatch.json");
  if (!existsSync(dispatchPath)) return null;
  let dispatch;
  try {
    dispatch = readJson(dispatchPath);
  } catch {
    return { reason: "missing_phase_provenance", missingProvenance: ["dispatch"] };
  }
  const body = dispatch.body ?? {};
  if (!requiresProvenance(body, options)) return null;
  const missing = [];
  if (!metadata.messageId) missing.push("messageId");
  if (!metadata.agentName) missing.push("agentName");
  if (evidenceItems(metadata.phaseEvidence).length === 0) missing.push("phaseEvidence");
  if (evidenceItems(metadata.skillRuntimeEvidence).length === 0) missing.push("skillRuntimeEvidence");
  if (missing.length > 0) return { reason: "missing_phase_provenance", missingProvenance: missing };

  const layerAuthorityViolations = layerAuthorityViolationsForAttempt(attemptDir, body, manifest, metadata);
  if (layerAuthorityViolations.length > 0) {
    return { reason: "layer_authority_violation", layerAuthorityViolations };
  }
  return null;
}

function evidenceItems(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") return Object.keys(value).length > 0 ? [value] : [];
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function requiresProvenance(body, options) {
  if (options.requireProvenance === false) return false;
  if (options.requireProvenance === true) return true;
  return Array.isArray(body.stageContracts) && body.stageContracts.length > 0;
}

function layerAuthorityViolationsForAttempt(attemptDir, body, manifest, metadata) {
  const violations = [];
  const stages = body.stageContracts ?? [];
  const humanCaptureStages = stages.filter((stage) => (
    hasHumanManualCapture(stage)
  ));
  if (humanCaptureStages.length === 0) return violations;

  const humanEvidence = Array.isArray(metadata.humanCheckpointEvidence) ? metadata.humanCheckpointEvidence : [];
  if (!humanEvidence.some((item) => item?.id === "awaiting_capture" || item?.checkpoint === "awaiting_capture")) {
    violations.push("manual capture requires human_checkpoint_evidence before advancing capture");
  }

  if (humanCaptureStages.some((stage) => stageRequestsSearchInput(stage)) && browserFlowRunsForAttempt(attemptDir, manifest, metadata).some(hasOnlyDirectGotoSearchUrl)) {
    violations.push("manual browser-flow capture was replaced by direct goto URL");
  }
  return [...new Set(violations)];
}

function hasHumanManualCapture(stage) {
  const phases = stage.phaseContracts ?? [];
  return phases.some((phase) => (
    phase.id === "capture"
    && (phase.allowedActor === "human_user" || phase.captureMode === "human_manual" || phase.checkpoint === "awaiting_capture")
  ));
}

function stageRequestsSearchInput(stage) {
  return /(?:search box|search input|type|submit|검색창|검색\s*버튼|입력|검색)/i.test(String(stage.input ?? ""));
}

function browserFlowRunsForAttempt(attemptDir, manifest, metadata) {
  const paths = new Set();
  for (const item of metadata.skillRuntimeEvidence ?? []) {
    if (typeof item?.path === "string") paths.add(item.path);
    if (typeof item?.runPath === "string") paths.add(item.runPath);
  }
  for (const item of manifest.outputs ?? []) {
    if (typeof item?.path === "string" && /browser-flow|artifacts\/runs/.test(item.path)) paths.add(item.path);
  }
  return [...paths]
    .map((path) => path.startsWith("/") ? path : join(attemptDir, path))
    .map((path) => {
      try {
        return readJson(join(path, "analysis", "workflow.json"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function hasOnlyDirectGotoSearchUrl(workflow) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  return workflow.fixture === "manual"
    && steps.length === 1
    && steps[0]?.action === "goto"
    && /[?&](?:q|query|keyword|search)=/i.test(String(steps[0]?.url ?? workflow.startUrl ?? workflow.finalUrl ?? ""));
}

export function inspectEvaluatorAttempt(attemptDir, options = {}) {
  const required = {
    evalReport: options.reportPath ?? join(attemptDir, "eval-report.md"),
    evalVerdict: options.verdictPath ?? join(attemptDir, "eval-verdict.json")
  };
  const missing = Object.entries(required)
    .filter(([, path]) => !isNonEmptyFile(path))
    .map(([name]) => name);
  if (missing.length > 0) {
    return { complete: false, passed: false, failed: false, missing, required };
  }

  let verdictPayload;
  try {
    verdictPayload = readJson(required.evalVerdict);
  } catch (error) {
    return { complete: true, passed: false, failed: true, reason: "invalid_eval_verdict", error: error.message, required };
  }

  const verdict = String(
    verdictPayload.verdict
    ?? verdictPayload.result
    ?? verdictPayload.outcome
    ?? verdictPayload.status
    ?? ""
  ).toLowerCase();
  const passed = verdictPayload.pass === true || ["pass", "passed", "success", "succeeded"].includes(verdict);
  const challengeRequired = verdict === "provisional_pass";
  const failed = !passed;
  return {
    complete: true,
    passed,
    failed,
    challengeRequired,
    reason: passed ? "evaluator_attempt_passed" : (challengeRequired ? "judgment_provisional_pass" : "evaluator_attempt_failed"),
    verdict: verdictPayload,
    required
  };
}

function isNonEmptyFile(path) {
  // Single stat in a guard: avoids the double statSync and the race where the
  // file vanishes between existsSync and statSync (which would throw ENOENT).
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function listGuardViolations(attemptDir, options = {}) {
  const fileViolations = readdirSync(attemptDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (
      name === "codex"
      || /(^|[-_])fixture(s)?(\.|[-_])/.test(name)
      || name.endsWith("-fixture.json")
      || name.includes("_FIXTURE")
    ));
  const contentViolations = readdirSync(attemptDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap((entry) => scanGuardViolationsInFile(join(attemptDir, entry.name), entry.name, options));
  return [...new Set([...fileViolations, ...contentViolations])];
}

function scanGuardViolationsInFile(path, label, options = {}) {
  const stat = statSync(path);
  if (stat.size > 1024 * 1024) return [];
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return detectRunnerBypassViolations(text, label, options);
}

export function detectRunnerBypassViolations(text, label = "transcript", options = {}) {
  const patterns = [
    /\.codex\/skills\/[^\s"'`]+\/agent-system\/bin\/[^\s"'`)]+/,
    /\.codex\/skills\/[^\s"'`]+\/bin\/[^\s"'`)]+/,
    /(^|[\s"'`])agent-system\/bin\/[^\s"'`)]+/,
    /node_repl\.js/,
    /(?:^|\n)\s*(?:•\s*)?Ran (?!(?:rg|grep)\b)(?:go run|node|npm|pnpm|yarn|\.\/|sh|bash)[^\n]*(?:provider|launcher|wrapper|prepare|executor)[^\n]*/
  ];
  const violations = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !isAllowedPublicRuntimeEvidence(match[0], options)) violations.push(`${label}: ${match[0].trim()}`);
  }
  for (const violation of customPatternViolations(text, label, options)) violations.push(violation);
  return [...new Set(violations)];
}

export function validateRunnerForbiddenPatterns(patterns = []) {
  const invalid = [];
  customPatterns(patterns, { invalid });
  return {
    ok: invalid.length === 0,
    invalid
  };
}

function customPatternViolations(text, label, options) {
  const invalid = [];
  const patterns = customPatterns(options.forbiddenPatterns ?? options.runnerForbiddenPatterns ?? [], { invalid });
  const violations = [];
  for (const item of invalid) {
    violations.push(`${label}: invalid forbidden pattern ${item.pattern}: ${item.error}`);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!isExecutionEvidenceLine(line)) continue;
    if (isAllowedPublicRuntimeEvidence(line, options)) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      violations.push(`${label}: ${reportedViolation(line, match[0])}`);
    }
  }
  return violations;
}

function isExecutionEvidenceLine(line) {
  return /(?:^|\s)(?:•\s*)?Ran\s+/.test(line)
    || /(?:^|\s)(?:•\s*)?Called\s+/.test(line)
    || /(?:^|\s)(?:•\s*)?Added\s+/.test(line)
    || /(?:^|\s)Search\s+/.test(line)
    || /^\s*\+?\s*import\s+/.test(line)
    || /\+\s*import\s+/.test(line);
}

function reportedViolation(line, match) {
  const trimmed = line.trim().replace(/^•\s*/, "");
  return /^(Ran|Called)\s+/.test(trimmed) ? trimmed : match.trim();
}

function isAllowedPublicRuntimeEvidence(text, options) {
  const calls = options.allowedPublicRuntimeCalls ?? options.allowedPublicRuntimePatterns ?? [];
  return calls.some((call) => {
    if (call instanceof RegExp) return call.test(text);
    const normalized = String(call).replace(/^node\s+/, "").trim();
    return normalized && text.includes(normalized);
  });
}

function customPatterns(patterns, { invalid = [] } = {}) {
  return patterns.flatMap((pattern, index) => {
    try {
      if (pattern instanceof RegExp) return [pattern];
      if (typeof pattern === "string") return [new RegExp(pattern)];
      if (pattern?.pattern) return [new RegExp(pattern.pattern, pattern.flags ?? "")];
      throw new Error(`Invalid runner forbidden pattern: ${JSON.stringify(pattern)}`);
    } catch (error) {
      invalid.push({
        index,
        pattern: typeof pattern === "string" ? pattern : JSON.stringify(pattern),
        error: error.message
      });
      return [];
    }
  });
}

export function snapshotCaseFolder(caseDir) {
  const files = {};
  for (const path of listCaseFiles(caseDir)) {
    const rel = relative(caseDir, path);
    files[rel] = hashFile(path);
  }
  return {
    caseDir,
    files
  };
}

export function detectCaseFolderChanges(caseDir, snapshot) {
  const before = snapshot?.files ?? {};
  const after = snapshotCaseFolder(caseDir).files;
  const changes = [];
  for (const rel of Object.keys(after).sort()) {
    if (!Object.prototype.hasOwnProperty.call(before, rel)) {
      changes.push(`case folder file created: ${rel}`);
    } else if (before[rel] !== after[rel]) {
      changes.push(`case folder file changed: ${rel}`);
    }
  }
  for (const rel of Object.keys(before).sort()) {
    if (!Object.prototype.hasOwnProperty.call(after, rel)) {
      changes.push(`case folder file deleted: ${rel}`);
    }
  }
  return changes;
}

function listCaseFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === ".DS_Store") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listCaseFiles(path);
    if (entry.isFile()) return [path];
    return [];
  }).sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
