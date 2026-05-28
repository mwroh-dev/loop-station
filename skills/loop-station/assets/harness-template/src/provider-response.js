import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emit } from "./events.js";
import { readJson, writeJson } from "./fs.js";
import { saveQueue, saveState } from "./run-store.js";
import { targetSkillInstallPath, targetSkillSlug } from "./target-skill.js";
import { isRecoveryLoop } from "./profiles.js";

const VALID_RESPONSES = new Set(["fixed", "known_unsupported", "needs_human"]);
const INSTALL_PROOF_PATTERNS = [
  /installed\s+[\w-]*\s*skill\s+to/i,
  /reinstalled\s+[\w-]*\s*skill/i,
  /consumer\s+skill\s+(?:updated|installed|reinstalled)/i,
  /consumer\s+install(?:ation)?\s+(?:completed|succeeded|ok|done)/i,
  /install(?:ed|ation)?\s+(?:completed|succeeded|ok|done)/i,
  /hash\s+match(?:es|ed)?/i
];
const INSTALL_FAILURE_PATTERNS = [
  /Go was not found/i,
  /requires Go/i,
  /command not found/i,
  /could not complete/i,
  /\bblocked\b/i,
  /\bfailed\b/i,
  /No consumer install/i
];

export function inspectProviderResponse(attemptDir, context = {}) {
  const markdown = join(attemptDir, "provider-response.md");
  const json = join(attemptDir, "provider-response.json");
  const missing = [
    ["provider-response.md", markdown],
    ["provider-response.json", json]
  ].filter(([, path]) => !existsSync(path)).map(([name]) => name);
  if (missing.length > 0) {
    return { complete: false, reason: "missing_response_files", missing, paths: { markdown, json } };
  }

  let payload;
  try {
    payload = readJson(json);
  } catch (error) {
    return { complete: false, reason: "invalid_provider_response_json", error: error.message, paths: { markdown, json } };
  }

  const response = String(payload.response ?? "");
  if (!VALID_RESPONSES.has(response)) {
    return { complete: false, reason: "invalid_provider_response_value", response, paths: { markdown, json }, payload };
  }

  if (response === "fixed") {
    const fixedValidation = validateFixedInstall(payload, { ...context, attemptDir });
    if (!fixedValidation.ok) {
      return {
        complete: false,
        reason: "fixed_install_not_verified",
        response,
        payload,
        paths: { markdown, json },
        ...fixedValidation
      };
    }
    return {
      complete: true,
      response,
      payload,
      paths: { markdown, json },
      ...fixedValidation
    };
  }

  return { complete: true, response, payload, paths: { markdown, json } };
}

export function validateFixedInstall(payload, context = {}) {
  if (isRecoveryLoop(context.config ?? {})) {
    return validateRecoveryFixedInstall(payload, context);
  }
  const evidence = flattenEvidence([
    payload.reason,
    payload.provider_changes,
    payload.release_update_install,
    payload.verification
  ]);
  const installProof = evidence.filter((item) => INSTALL_PROOF_PATTERNS.some((pattern) => pattern.test(item)));
  const installFailures = evidence.filter((item) => INSTALL_FAILURE_PATTERNS.some((pattern) => pattern.test(item)));
  const hashCheck = compareReleaseAndConsumerSkill(context.config ?? {});
  const hashRequired = Boolean(hashCheck.releaseSkillPath && hashCheck.consumerSkillPath);
  const hashOk = hashRequired ? hashCheck.hashMatch === true : true;
  return {
    ok: installProof.length > 0 && installFailures.length === 0 && hashOk,
    installProof,
    installFailures,
    hashMatch: hashCheck.hashMatch,
    releaseSkillPath: hashCheck.releaseSkillPath,
    consumerSkillPath: hashCheck.consumerSkillPath
  };
}

function validateRecoveryFixedInstall(payload, context = {}) {
  const evidence = flattenEvidence([
    payload.reason,
    payload.provider_changes,
    payload.release_update_install,
    payload.verification
  ]);
  const installProof = evidence.filter((item) => INSTALL_PROOF_PATTERNS.some((pattern) => pattern.test(item)));
  const installFailures = evidence.filter((item) => INSTALL_FAILURE_PATTERNS.some((pattern) => pattern.test(item)));
  const hashCheck = compareReleaseAndConsumerSkill(context.config ?? {});
  const installArtifacts = inspectRecoveryInstallArtifacts(context.attemptDir ?? context.paths?.attemptDir ?? null);
  const hashRequired = Boolean(hashCheck.releaseSkillPath && hashCheck.consumerSkillPath);
  const hashOk = hashRequired ? hashCheck.hashMatch === true : true;
  const installArtifactsVerified = installArtifacts.providerFix.ok && installArtifacts.consumerInstall.ok;
  const deployVerificationVerified = installArtifacts.deployVerify.ok;
  return {
    ok: installArtifactsVerified && installProof.length > 0 && installFailures.length === 0 && hashOk,
    installProof,
    installFailures,
    hashMatch: hashCheck.hashMatch,
    releaseSkillPath: hashCheck.releaseSkillPath,
    consumerSkillPath: hashCheck.consumerSkillPath,
    installArtifactsVerified,
    deployVerificationVerified,
    deployVerificationPending: installArtifactsVerified && !deployVerificationVerified,
    recoveryArtifacts: installArtifacts
  };
}

function flattenEvidence(values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value.flatMap((item) => flattenEvidence([item]));
    if (value && typeof value === "object") return Object.values(value).flatMap((item) => flattenEvidence([item]));
    if (value === null || value === undefined) return [];
    return [String(value)];
  });
}

function compareReleaseAndConsumerSkill(config) {
  const slug = targetSkillSlug(config);
  const releaseRoot = config.locations?.releaseRoot;
  const releaseSkillPath = releaseRoot && slug ? join(releaseRoot, "skills", slug, "SKILL.md") : null;
  const consumerRootSkillPath = targetSkillInstallPath(config);
  const consumerSkillPath = consumerRootSkillPath ? join(consumerRootSkillPath, "SKILL.md") : null;
  if (!releaseSkillPath || !consumerSkillPath || !existsSync(releaseSkillPath) || !existsSync(consumerSkillPath)) {
    return { releaseSkillPath, consumerSkillPath, hashMatch: false };
  }
  return {
    releaseSkillPath,
    consumerSkillPath,
    hashMatch: sha256(releaseSkillPath) === sha256(consumerSkillPath)
  };
}

function inspectRecoveryInstallArtifacts(attemptDir) {
  if (!attemptDir) {
    return {
      providerFix: { ok: false, reason: "missing_attempt_dir" },
      consumerInstall: { ok: false, reason: "missing_attempt_dir" },
      deployVerify: { ok: false, reason: "missing_attempt_dir" }
    };
  }
  return {
    providerFix: inspectStructuredArtifact(attemptDir, "provider-fix-report.md", "provider-fix.json", ["completed", "done", "fixed"]),
    consumerInstall: inspectStructuredArtifact(attemptDir, "consumer-install-report.md", "consumer-install.json", ["completed", "done", "installed"]),
    deployVerify: inspectStructuredArtifact(attemptDir, "deploy-verify-report.md", "deploy-verify.json", ["pass", "passed", "completed"], {
      predicate: (payload) => payload.pass === true || payload.hashMatch === true
    })
  };
}

function inspectStructuredArtifact(attemptDir, markdownName, jsonName, successValues, options = {}) {
  const markdownPath = join(attemptDir, markdownName);
  const jsonPath = join(attemptDir, jsonName);
  if (!existsSync(markdownPath) || !existsSync(jsonPath)) {
    return { ok: false, markdownPath, jsonPath, reason: "missing_structured_artifact" };
  }
  let payload;
  try {
    payload = readJson(jsonPath);
  } catch (error) {
    return { ok: false, markdownPath, jsonPath, reason: "invalid_structured_artifact_json", error: error.message };
  }
  const status = String(payload.status ?? payload.result ?? payload.verdict ?? "").toLowerCase();
  const statusOk = successValues.includes(status) || options.predicate?.(payload) === true;
  return {
    ok: statusOk,
    markdownPath,
    jsonPath,
    payload,
    reason: statusOk ? null : "structured_artifact_not_success"
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function applyProviderResponse(runDir, ctx, caseId, response, payload = {}) {
  const queueItem = ctx.queue.find((item) => item.id === caseId);
  if (!queueItem) throw new Error(`Unknown case id: ${caseId}`);
  if (!VALID_RESPONSES.has(response)) throw new Error(`Invalid provider response: ${response}`);

  if (response === "fixed") {
    queueItem.status = "rerun_queued";
    ctx.state.activeCaseId = null;
    ctx.state.activeStageId = null;
  } else if (response === "known_unsupported") {
    queueItem.status = "case_known_unsupported";
    ctx.state.activeCaseId = null;
    ctx.state.activeStageId = null;
    ctx.state.completedCases += 1;
  } else {
    queueItem.status = "needs_human";
    ctx.state.status = "needs_human";
  }

  saveQueue(runDir, ctx.queue);
  saveState(runDir, ctx.state);
  emit(runDir, "provider_response_recorded", { caseId, response, source: payload.source ?? "provider-response-files" });
  return { caseId, response, queueItem };
}

export function providerResponseAttemptDir(runDir, queueItem) {
  const attempt = Math.max(queueItem.attempts, 1);
  return join(runDir, "cases", queueItem.id, `attempt-${attempt}`);
}
