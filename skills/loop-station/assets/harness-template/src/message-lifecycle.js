import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emit } from "./events.js";
import { ensureDir, readJson, writeJson } from "./fs.js";

export const MESSAGE_STATES = [
  "created",
  "pending",
  "submitted",
  "accepted_by_pane",
  "processing",
  "idle_observed",
  "artifact_waiting",
  "artifact_ready",
  "verified",
  "completed",
  "blocked",
  "stuck",
  "transport_submit_not_started",
  "timeout",
  "dead",
  "failed"
];

const MAILBOX_REPLY_MESSAGE_TYPES = new Set([
  "RUN_SKILL_CASE",
  "RUN_ACTION_STAGE",
  "EVALUATE_CASE",
  "CHALLENGE_REVIEW",
  "REPORT_CASE_RESULT_TO_PROVIDER_CODEX",
  "DEPLOY_VERIFY"
]);

export function createMessage(runDir, input) {
  const now = new Date().toISOString();
  const message = {
    id: input.id ?? randomUUID(),
    runId: input.runId,
    from: input.from ?? "Orchestrator",
    to: input.to,
    type: input.type,
    caseId: input.caseId ?? null,
    attempt: input.attempt ?? null,
    stageId: input.stageId ?? null,
    createdAt: now,
    updatedAt: now,
    state: "created",
    body: input.body ?? {},
    artifactPaths: input.artifactPaths ?? [],
    transitions: [{ state: "created", at: now }]
  };
  if (shouldPersistMailboxRequest(message)) {
    message.body = {
      ...message.body,
      mailboxRequestPath: mailboxRequestPath(runDir, message),
      mailboxStartedPath: mailboxStartedPath(runDir, message),
      mailboxStartedContract: mailboxStartedContract(message)
    };
    ensureDir(dirname(message.body.mailboxRequestPath));
    ensureDir(dirname(message.body.mailboxStartedPath));
  }
  if (shouldRequireMailboxReply(message)) {
    message.body = {
      ...message.body,
      mailboxReplyPath: mailboxReplyPath(runDir, message),
      mailboxReplyContract: mailboxReplyContract(message)
    };
    ensureDir(dirname(message.body.mailboxReplyPath));
  }
  persistMailboxMessage(runDir, message);
  upsertMessage(runDir, message);
  emit(runDir, "message_created", { messageId: message.id, to: message.to, type: message.type });
  return message;
}

const PROTECTED_MESSAGE_FIELDS = new Set([
  "id",
  "runId",
  "from",
  "to",
  "type",
  "caseId",
  "attempt",
  "stageId",
  "createdAt",
  "updatedAt",
  "state",
  "body",
  "artifactPaths",
  "transitions"
]);

export function transitionMessage(runDir, messageId, state, body = {}) {
  if (!MESSAGE_STATES.includes(state)) throw new Error(`Unknown message state: ${state}`);
  // Tolerate an explicit null/non-object body the same way `...body` always did.
  const safeBody = (body && typeof body === "object") ? body : {};
  for (const key of Object.keys(safeBody)) {
    if (PROTECTED_MESSAGE_FIELDS.has(key)) {
      throw new Error(`transitionMessage body must not contain protected message field: ${key}`);
    }
  }
  const messages = readMessages(runDir);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) throw new Error(`Unknown message: ${messageId}`);
  const now = new Date().toISOString();
  const message = {
    ...messages[index],
    state,
    updatedAt: now,
    ...safeBody,
    transitions: [...(messages[index].transitions ?? []), { state, at: now, body: safeBody }]
  };
  messages[index] = message;
  writeJson(messagesPath(runDir), messages);
  emit(runDir, "message_state_changed", { messageId, state, to: message.to, type: message.type });
  return message;
}

export function failMessage(runDir, messageId, state, reason) {
  if (!["blocked", "stuck", "transport_submit_not_started", "timeout", "dead", "failed"].includes(state)) {
    throw new Error(`Invalid failure state: ${state}`);
  }
  return transitionMessage(runDir, messageId, state, { failureReason: reason });
}

export function readMessages(runDir) {
  const path = messagesPath(runDir);
  if (!existsSync(path)) return [];
  // A corrupted messages.json must surface instead of being treated as an
  // empty history: returning [] here would let the next upsert overwrite the
  // entire dispatch record.
  return readJson(path);
}

export function writeEnvelope(runDir, message) {
  const path = join(runDir, "locks", `${message.id}.message.txt`);
  ensureDir(join(runDir, "locks"));
  const controlMessage = mailboxControlMessage(message);
  const requestPath = controlMessage.body?.mailboxRequestPath ?? join(runDir, "locks", `${message.id}.message.json`);
  writeJson(requestPath, modelMailboxRequest(controlMessage));
  const text = mailboxEnvelopeText(controlMessage);
  writeFileSync(path, text);
  return {
    path,
    text,
    controlMessage
  };
}

export function mailboxRequestPath(runDir, message) {
  return join(runDir, "mailbox", message.to, "request", `${message.id}.json`);
}

export function mailboxReplyPath(runDir, message) {
  return join(runDir, "mailbox", message.to, "reply", `${message.id}.json`);
}

export function mailboxStartedPath(runDir, message) {
  return join(runDir, "mailbox", message.to, "started", `${message.id}.json`);
}

export function mailboxStartedContract(message) {
  return {
    messageId: message.id,
    agentName: message.to,
    role: replyRoleForMessage(message),
    caseId: message.caseId ?? null,
    attempt: message.attempt ?? null,
    stageId: message.stageId ?? null,
    requiredKeys: ["messageId", "agentName", "role", "caseId", "attempt", "stageId", "status", "summary"]
  };
}

export function mailboxReplyContract(message) {
  return {
    messageId: message.id,
    agentName: message.to,
    role: replyRoleForMessage(message),
    caseId: message.caseId ?? null,
    attempt: message.attempt ?? null,
    stageId: message.stageId ?? null,
    allowedStatuses: allowedReplyStatuses(message),
    requiredKeys: ["messageId", "agentName", "role", "caseId", "attempt", "stageId", "status", "summary", "artifactPaths"]
  };
}

export function inspectMailboxStarted(message) {
  const startedPath = message?.body?.mailboxStartedPath;
  if (!startedPath || !existsSync(startedPath)) {
    return { started: false, reason: "missing_mailbox_started", startedPath };
  }
  let payload;
  try {
    payload = readJson(startedPath);
  } catch (error) {
    return { started: false, reason: "invalid_mailbox_started_json", error: error.message, startedPath };
  }
  const contract = message.body?.mailboxStartedContract ?? mailboxStartedContract(message);
  const missing = contract.requiredKeys.filter((key) => !(key in payload));
  if (missing.length > 0) {
    return { started: false, reason: "mailbox_started_missing_fields", missing, payload, startedPath };
  }
  if (payload.messageId !== contract.messageId) {
    return { started: false, reason: "mailbox_started_message_mismatch", payload, startedPath };
  }
  if (payload.agentName !== contract.agentName || payload.role !== contract.role) {
    return { started: false, reason: "mailbox_started_agent_mismatch", payload, startedPath };
  }
  if (payload.caseId !== contract.caseId || payload.attempt !== contract.attempt || payload.stageId !== contract.stageId) {
    return { started: false, reason: "mailbox_started_context_mismatch", payload, startedPath };
  }
  if (payload.status !== "started") {
    return { started: false, reason: "mailbox_started_invalid_status", payload, startedPath };
  }
  return { started: true, payload, startedPath };
}

export function inspectMailboxReply(message) {
  const replyPath = message?.body?.mailboxReplyPath;
  if (!replyPath || !existsSync(replyPath)) {
    return { complete: false, reason: "missing_mailbox_reply", replyPath };
  }
  let payload;
  try {
    payload = readJson(replyPath);
  } catch (error) {
    return { complete: false, reason: "invalid_mailbox_reply_json", error: error.message, replyPath };
  }
  const contract = message.body?.mailboxReplyContract ?? mailboxReplyContract(message);
  const missing = contract.requiredKeys.filter((key) => !(key in payload));
  if (missing.length > 0) {
    return { complete: false, reason: "mailbox_reply_missing_fields", missing, payload, replyPath };
  }
  if (payload.messageId !== contract.messageId) {
    return { complete: false, reason: "mailbox_reply_message_mismatch", payload, replyPath };
  }
  if (payload.caseId !== contract.caseId || payload.attempt !== contract.attempt || payload.stageId !== contract.stageId) {
    return { complete: false, reason: "mailbox_reply_context_mismatch", payload, replyPath };
  }
  if (!contract.allowedStatuses.includes(payload.status)) {
    return { complete: false, reason: "mailbox_reply_invalid_status", payload, replyPath };
  }
  if (!Array.isArray(payload.artifactPaths)) {
    return { complete: false, reason: "mailbox_reply_artifact_paths_invalid", payload, replyPath };
  }
  return { complete: true, payload, replyPath };
}

export function recordMailboxActivation(runDir, message, payload = {}) {
  const now = new Date().toISOString();
  const type = activationEventType(message);
  const activation = {
    id: `${message.id}:${type}`,
    runId: message.runId,
    from: message.to,
    to: "Orchestrator",
    type,
    caseId: message.caseId ?? null,
    attempt: message.attempt ?? null,
    stageId: message.stageId ?? null,
    createdAt: now,
    body: payload
  };
  const fileName = `${now.replaceAll(/[:.]/g, "")}-${activation.id.replaceAll(/[:/]/g, "_")}.json`;
  writeJson(join(runDir, "mailbox", activation.to, "inbox", fileName), activation);
  writeJson(join(runDir, "mailbox", activation.from, "outbox", fileName), activation);
  emit(runDir, type, { caseId: activation.caseId, attempt: activation.attempt, stageId: activation.stageId, from: activation.from });
  return activation;
}

export function recordMailboxCompletion(runDir, message, type, payload = {}) {
  const now = new Date().toISOString();
  const completion = {
    id: `${message.id}:${type}`,
    runId: message.runId,
    from: message.to,
    to: "Orchestrator",
    type,
    caseId: message.caseId ?? null,
    attempt: message.attempt ?? null,
    stageId: message.stageId ?? null,
    createdAt: now,
    body: payload
  };
  const fileName = `${now.replaceAll(/[:.]/g, "")}-${completion.id.replaceAll(/[:/]/g, "_")}.json`;
  writeJson(join(runDir, "mailbox", completion.to, "inbox", fileName), completion);
  writeJson(join(runDir, "mailbox", completion.from, "outbox", fileName), completion);
  emit(runDir, type, { caseId: completion.caseId, attempt: completion.attempt, stageId: completion.stageId, from: completion.from });
  return completion;
}

function renderedTaskText(message) {
  if (message.type === "RUN_SKILL_CASE" && Array.isArray(message.body?.targetSkills) && message.body.targetSkills.length > 0 && !message.body?.targetSkillName) {
    return multiSkillRunEnvelope(message);
  }
  if (message.type === "RUN_SKILL_CASE" && message.body?.targetSkillName) {
    const body = message.body;
    const promptText = body.promptPath && existsSync(body.promptPath)
      ? readFileSync(body.promptPath, "utf8").trim()
      : `Read the prompt file at ${body.promptPath}`;
    if (body.loopProfile === "evaluation-loop") {
      return `${body.targetSkillName}

Simple Loop Station case.

Case prompt:
${promptText}

Output directory:
${body.outputDir}

Write exactly these files:
- echo.txt or the requested task output
- runner-report.md
- runner-metadata.json
- output-manifest.json
- mailbox reply JSON: ${body.mailboxReplyPath}

output-manifest.json contract:
- success: "status": "DONE" or "passed", "verdict": "pass", "verification": { "pass": true }
- failure: "status": "blocked" | "failed" | "ambiguous" | "unsupported", "verdict": "fail", "reason": "<short reason>"

runner-metadata.json must include:
- messageId
- agentName
- phaseEvidence
- skillRuntimeEvidence

Mailbox reply JSON contract:
{
  "messageId": "${body.mailboxReplyContract?.messageId ?? message.id}",
  "agentName": "${body.mailboxReplyContract?.agentName ?? message.to}",
  "role": "${body.mailboxReplyContract?.role ?? "runner"}",
  "caseId": "${body.mailboxReplyContract?.caseId ?? message.caseId}",
  "attempt": ${body.mailboxReplyContract?.attempt ?? message.attempt ?? 1},
  "stageId": "${body.mailboxReplyContract?.stageId ?? message.stageId ?? "run"}",
  "status": "done | blocked | failed | needs_human",
  "summary": "short summary",
  "artifactPaths": ["..."]
}

Use only the visible ${body.targetSkillName} skill flow in this Codex session.
Do not answer only in chat. Write the files, write the mailbox reply JSON, then stop.
`;
    }
    return `${body.targetSkillName}

${promptText}

Optional input path(s): ${(body.optionalInputs ?? []).join(", ") || "(none)"}
Write all generated outputs under: ${body.outputDir}

Required station artifacts:
- runner-report.md: ${body.requiredOutputs?.runnerReport}
- runner-metadata.json: ${body.requiredOutputs?.runnerMetadata}
- output-manifest.json: ${body.requiredOutputs?.outputManifest}
- mailbox reply JSON: ${body.mailboxReplyPath}

output-manifest.json contract:
- For a successful pass candidate, write:
  - "status": "DONE" or "passed"
  - "verdict": "pass"
  - "verification": { "pass": true }
- For a blocked or failed attempt, write:
  - "status": "blocked" | "failed" | "ambiguous" | "unsupported"
  - "verdict": "fail"
  - "reason": "<short reason>"
- Include any produced output files under an "outputs" array.

Write these files even if the task is blocked, ambiguous, unsupported, or failed.
Do not finish with chat-only status. If you cannot complete the task, write the three files with a blocked or failed status and a clear reason.
runner-metadata.json must include messageId, agentName, phaseEvidence, and skillRuntimeEvidence. Include humanCheckpointEvidence before advancing any human-owned checkpoint.
After writing artifacts, write the mailbox reply JSON at the provided path and then stop.

Important:
- Treat this as one normal $skill request inside this Codex session.
- Invoke only the visible ${body.targetSkillName} skill flow. Do not inspect or invoke hidden provider internals as a substitute.
- Do not run files from .codex/skills/.../bin/, agent-system directories, compatibility wrappers, legacy launchers, installers, or case-local mirrors.
- Do not use alternate execution paths such as direct scripts, hidden launchers, provider binaries, or ad hoc runtimes outside ${body.targetSkillName}.
- Do not modify provider source, release source, or case input files.
- Stop after this one request.
`;
  }
  if (message.type === "REPORT_CASE_RESULT_TO_PROVIDER_CODEX") {
    return providerHandoffEnvelope(message);
  }
  if (message.type === "FOLLOW_UP_PROVIDER_RESPONSE") {
    return providerResponseFollowUpEnvelope(message);
  }
  if (message.type === "RUN_ACTION_STAGE") {
    return actionStageEnvelope(message);
  }
  if (message.type === "CHALLENGE_REVIEW") {
    return challengeReviewEnvelope(message);
  }
  if (message.type === "DEPLOY_VERIFY") {
    return deployVerifyEnvelope(message);
  }
  if (message.type === "EVALUATE_CASE") {
    return evaluatorEnvelope(message);
  }
  return `A Loop Station task is available for this Codex session.

Task kind: ${taskKindForMessage(message)}
Case: ${message.caseId ?? "(none)"}
Attempt: ${message.attempt ?? "(none)"}

Write the required artifacts listed by the station, then stop and wait.
Do not bypass the visible Codex session with provider entrypoints, hidden launchers, installers, or legacy wrappers.
If this task kind is unsupported by the current prompt renderer, write a blocked artifact explaining that the station template needs a human-readable renderer for this public task kind.
`;
}

function mailboxControlMessage(message) {
  return {
    ...message,
    body: {
      ...message.body,
      renderedTask: `${activationInstruction(message)}\n\n${renderedTaskText(message)}`
    }
  };
}

function modelMailboxRequest(message) {
  return {
    taskId: message.id,
    agentName: message.to,
    role: replyRoleForMessage(message),
    caseId: message.caseId ?? null,
    attempt: message.attempt ?? null,
    stageId: message.stageId ?? null,
    taskKind: taskKindForMessage(message),
    mailbox: mailboxRequestContract(message),
    artifactPaths: message.artifactPaths ?? [],
    renderedTask: message.body?.renderedTask ?? `${activationInstruction(message)}\n\n${renderedTaskText(message)}`
  };
}

function mailboxRequestContract(message) {
  const body = message.body ?? {};
  return {
    requestPath: body.mailboxRequestPath ?? null,
    ...(body.mailboxStartedPath ? {
      startedPath: body.mailboxStartedPath,
      startedContract: body.mailboxStartedContract ?? mailboxStartedContract(message)
    } : {}),
    ...(body.mailboxReplyPath ? {
      replyPath: body.mailboxReplyPath,
      replyContract: body.mailboxReplyContract ?? mailboxReplyContract(message)
    } : {})
  };
}

function mailboxEnvelopeText(message) {
  const requestPath = message.body?.mailboxRequestPath ?? "(missing)";
  const startedPart = message.body?.mailboxStartedPath ? ` MAILBOX_STARTED=${message.body.mailboxStartedPath}` : "";
  const replyPart = message.body?.mailboxReplyPath ? ` MAILBOX_REPLY=${message.body.mailboxReplyPath}` : "";
  return `You are ${message.to}. Read the mailbox request file, immediately write the mailbox started JSON, execute exactly that task, write the required artifacts, then write the mailbox reply JSON if requested and stop. Treat MAILBOX_* values as literal file paths in this prompt, not shell environment variables. Do not read queue or station control files unless the mailbox request file explicitly names them. MAILBOX_REQUEST=${requestPath}${startedPart}${replyPart}\n`;
}

function activationInstruction(message) {
  const body = message.body ?? {};
  if (!body.mailboxStartedPath) return "";
  const contract = body.mailboxStartedContract ?? mailboxStartedContract(message);
  return `Activation mailbox JSON:
- Write this file before doing any task work: ${body.mailboxStartedPath}
- The mailbox paths are literal file paths from the prompt/request, not shell environment variables.
- Use exactly this shape:
{
  "messageId": "${contract.messageId}",
  "agentName": "${contract.agentName}",
  "role": "${contract.role}",
  "caseId": ${JSON.stringify(contract.caseId)},
  "attempt": ${JSON.stringify(contract.attempt)},
  "stageId": ${JSON.stringify(contract.stageId)},
  "status": "started",
  "summary": "Started reading the mailbox request."
}`;
}

function actionStageEnvelope(message) {
  const body = message.body ?? {};
  const stage = body.stage ?? {};
  const promptText = body.promptText
    ?? (body.promptPath && existsSync(body.promptPath)
      ? readFileSync(body.promptPath, "utf8").trim()
      : `Read the prompt file at ${body.promptPath}`);
  const upstream = Array.isArray(body.upstreamArtifacts) ? body.upstreamArtifacts : [];
  const requiredArtifacts = Array.isArray(body.requiredArtifacts) ? body.requiredArtifacts : [];
  const skillPrefix = stage.skill ? `${stage.skill}\n\n` : "";
  const skillBlock = stage.skill
    ? `Public stage skill:
- skill: ${stage.skill}
- install path: ${stage.installPath ?? "(unknown)"}
- invoke only this public skill entry for the stage

`
    : "";
  return `${skillPrefix}Run this Loop Station action stage in this Codex session.

Case prompt:
${promptText}

Stage:
- id: ${stage.id ?? message.stageId ?? "(unknown)"}
- objective: ${body.input ?? stage.input ?? "(none)"}

${skillBlock}Stage instructions:
${(body.instructions ?? stage.instructions ?? []).map((line) => `- ${line}`).join("\n") || "- (none)"}

Optional input path(s): ${(body.optionalInputs ?? []).join(", ") || "(none)"}
Upstream artifact path(s):
${upstream.map((item) => `- ${item.stageId}: ${item.path}`).join("\n") || "- (none)"}

Write all generated stage artifacts under: ${body.stageDir ?? body.attemptDir ?? "(unknown)"}

Required station artifacts:
${requiredArtifacts.map((path) => `- ${path}`).join("\n") || "- (none)"}

Important:
- Execute only this stage.
- ${stage.skill ? `Use only the public ${stage.skill} skill flow for this stage.` : "Use only the stage instructions for this stage."}
- Do not run local Node scripts, shell scripts, ad hoc tools, provider launchers, or alternate runtimes unless the public ${stage.skill ?? "stage skill"} entry explicitly documents that runtime as part of the public skill flow.
- Read only the case prompt, optional inputs, and upstream artifacts listed above.
- Do not use alternate execution paths, ad hoc scripts, hidden launchers, or extra work outside this stage contract.
- Do not modify case input files.
- Do not answer only in chat.
- Write every required artifact even if the stage is blocked or failed, then stop and wait.
`;
}

function evaluatorEnvelope(message) {
  const body = message.body ?? {};
  const evidence = body.evidencePaths ?? {};
  const outputs = body.requiredOutputs ?? {};
  if (body.loopProfile === "evaluation-loop") {
    const promptText = body.promptPath && existsSync(body.promptPath)
      ? readFileSync(body.promptPath, "utf8").trim()
      : `Read the prompt file at ${body.promptPath}`;
    return `Evaluate this simple Loop Station case.

Case: ${message.caseId}
Attempt: ${message.attempt}

Case prompt:
${promptText}

Read only these files:
- Runner report: ${evidence.runnerReport ?? "(missing)"}
- Runner metadata: ${evidence.runnerMetadata ?? "(missing)"}
- Output manifest: ${evidence.outputManifest ?? "(missing)"}
- Dispatch record: ${evidence.dispatch ?? "(missing)"}
${(body.targetSkills ?? []).map((skill) => `- Public skill doc: ${skill.name} at ${skill.installPath}`).join("\n") || "- Public skill doc: (none)"}

Required evaluator artifacts:
- eval-report.md: ${outputs.evalReport}
- eval-verdict.json: ${outputs.evalVerdict}
- mailbox reply JSON: ${body.mailboxReplyPath}

Pass only if:
- the runner artifacts are complete
- the output-manifest is a pass candidate
- the produced output matches the case prompt
- the runner metadata shows public skill invocation evidence

Important:
- The case is expected to be in an evaluation stage while you are writing these artifacts.
- Do not use queue state, active_evaluation, messages.json, state.json, station.log, events.ndjson, panes.json, or missing evaluator output as failure evidence.
- Keep the report short and concrete.
- Do not explore unrelated repo files.

eval-verdict.json must contain:
{
  "verdict": "pass | fail | needs_human",
  "reason": "short reason",
  "evidence": []
}

Write the mailbox reply JSON after the evaluator artifacts, then stop.
`;
  }
  return `Evaluate this Loop Station case attempt.

Case: ${message.caseId}
Attempt: ${message.attempt}

Required evaluator artifacts:
- eval-report.md: ${outputs.evalReport}
- eval-verdict.json: ${outputs.evalVerdict}
- mailbox reply JSON: ${body.mailboxReplyPath}

Evidence paths:
- Runner report: ${evidence.runnerReport ?? "(missing)"}
- Runner metadata: ${evidence.runnerMetadata ?? "(missing)"}
- Output manifest: ${evidence.outputManifest ?? "(missing)"}
- Dispatch record: ${evidence.dispatch ?? "(missing)"}

Target public skill entries:
${(body.targetSkills ?? []).map((skill) => `- ${skill.name} at ${skill.installPath}`).join("\n") || "- (none)"}

Evaluation rules:
- Pass only when the runner artifacts are complete, the expected public skill entries were invoked, and the output provenance is credible for the case.
- Evaluate both result and process: the runner must follow each skill profile's phase contract, required evidence, human checkpoint handling, and allowed public runtime boundary.
- The case is expected to be in an evaluation stage while you are writing these artifacts.
- Do not use current queue state, active_evaluation, active evaluator status, or the fact that evaluator output is not written yet as failure evidence.
- Read only the listed evidence paths, the case prompt, and the referenced public skill docs needed to judge the attempt.
- Do not inspect queue.json, state.json, messages.json, station.log, events.ndjson, panes.json, or other station-control files as evaluation evidence.
- Use capability_gap when a public skill contract is followed but the current provider capability is insufficient. Use provider_required when provider-side implementation or release/install work is needed.
- Use layer_authority_violation when a runner or skill runtime performed a human-owned browser action, replaced a required user interaction with a synthesized URL, or advanced past a human checkpoint without provenance.
- Use transport_submit_not_started when the pane received a prompt but execution never started. Use awaiting_human_capture when the correct next step is visible-browser user action. Use missing_phase_provenance when runner artifacts lack message, agent, phase, runtime, or required human checkpoint evidence.
- Fail if evidence shows fake data, ad hoc collection where a browser skill was required, direct spreadsheet libraries where a workbook skill was required, hidden provider launchers, or missing source evidence.
- Do not modify provider source, case inputs, or runner outputs.
- Keep the evaluation short and evidence-based. Do not expand the task into general repository analysis.

eval-verdict.json must contain:
{
  "verdict": "pass | fail | needs_human | capability_gap | provider_required",
  "reason": "short reason",
  "evidence": []
}

Write the mailbox reply JSON after the evaluator artifacts, then stop.
`;
}

function challengeReviewEnvelope(message) {
  const body = message.body ?? {};
  const outputs = body.requiredOutputs ?? {};
  return `Challenge-review this Loop Station case attempt.

Case: ${message.caseId}
Attempt: ${message.attempt}

Prior verdict:
${JSON.stringify(body.priorVerdict ?? {}, null, 2)}

Challenge question:
${body.challengeQuestion ?? "Find the strongest reason this case should not pass yet."}

Required challenge artifacts:
- challenge-report.md: ${outputs.challengeReport}
- challenge-verdict.json: ${outputs.challengeVerdict}
- mailbox reply JSON: ${body.mailboxReplyPath}

Challenge rules:
- Do not repeat the previous verdict mechanically.
- Pass only if the prior provisional result still holds after adversarial review.
- If any important weakness remains, fail and make the repair direction concrete.
- Do not modify provider source, case inputs, or runner outputs.

challenge-verdict.json must contain:
{
  "verdict": "pass | fail | needs_human",
  "reason": "short reason",
  "evidence": []
}

Write the mailbox reply JSON after the challenge artifacts, then stop.
`;
}

function deployVerifyEnvelope(message) {
  const body = message.body ?? {};
  const outputs = body.requiredOutputs ?? {};
  return `Run Loop Station deploy verification for this case.

Case: ${message.caseId}
Attempt: ${message.attempt}

Verification target:
- releaseRoot: ${body.releaseRoot ?? "(missing)"}
- consumerRoot: ${body.consumerRoot ?? "(missing)"}
- consumerInstallTarget: ${body.consumerInstallTarget ?? "(missing)"}
- targetSkillInstallPath: ${body.targetSkillInstallPath ?? "(missing)"}

Required deploy verification artifacts:
- deploy-verify-report.md: ${outputs.deployVerifyReport}
- deploy-verify.json: ${outputs.deployVerifyVerdict}
- mailbox reply JSON: ${body.mailboxReplyPath}

Verification rules:
- Confirm the consumer-installed skill surface was updated from the provider-owned release/install path.
- Record whether the relevant release and consumer skill files match.
- If verification fails, explain the exact mismatch or missing install state.
- Do not modify provider source, case inputs, or runner outputs.

deploy-verify.json must contain:
{
  "verdict": "pass | fail | needs_human",
  "status": "passed | failed | needs_human",
  "hashMatch": true,
  "reason": "short reason",
  "evidence": []
}

Write the mailbox reply JSON after the deploy verification artifacts, then stop.
`;
}

function multiSkillRunEnvelope(message) {
  const body = message.body;
  const promptText = body.promptPath && existsSync(body.promptPath)
    ? readFileSync(body.promptPath, "utf8").trim()
    : `Read the prompt file at ${body.promptPath}`;
  const skills = body.targetSkills ?? [];
  const stages = body.stageContracts ?? [];
  const profiles = body.skillProfiles ?? [];
  return `Run this Loop Station case as a normal Codex user would use the public project-local skill entries.

Case prompt:
${promptText}

Public skill entries to use, in order:
${skills.map((skill, index) => `${index + 1}. ${skill.name} at ${skill.installPath}`).join("\n")}

Stage contracts:
${stages.map((stage, index) => `${index + 1}. ${stage.id ?? stage.skill}: use ${stage.skill}; input: ${readableList(stage.input)}; output(s): ${readableList(stage.outputs)}; evidence: ${readableList(stage.evidence)}; phases: ${readablePhaseList(stage.phaseContracts)}; required evidence: ${readableList(stage.requiredEvidence)}; capability gaps: ${readableCapabilityGaps(stage.capabilityGaps)}`).join("\n")}

Allowed public runtime boundaries:
${profiles.flatMap((profile) => (profile.allowedPublicRuntimeCalls ?? []).map((call) => `- ${profile.name}: ${call}`)).join("\n") || "- none discovered; use only the public skill entry docs"}

Human and LLM-delegable checkpoints:
${profiles.flatMap((profile) => [
  ...(profile.humanCheckpoints ?? []).map((checkpoint) => `- ${profile.name}: ${checkpoint.id} requires ${checkpoint.decision}`),
  ...(profile.llmDelegableCheckpoints ?? []).map((checkpoint) => `- ${profile.name}: ${checkpoint.id} can be delegated when station/user policy allows`)
]).join("\n") || "- none discovered"}

Optional input path(s): ${(body.optionalInputs ?? []).join(", ") || "(none)"}
Write all generated station artifacts under: ${body.outputDir}

Required station artifacts:
- runner-report.md: ${body.requiredOutputs?.runnerReport}
- runner-metadata.json: ${body.requiredOutputs?.runnerMetadata}
- output-manifest.json: ${body.requiredOutputs?.outputManifest}

output-manifest.json contract:
- For a successful pass candidate, write:
  - "status": "DONE" or "passed"
  - "verdict": "pass"
  - "verification": { "pass": true }
- For a blocked or failed attempt, write:
  - "status": "blocked" | "failed" | "ambiguous" | "unsupported"
  - "verdict": "fail"
  - "reason": "<short reason>"
- Include produced output files under an "outputs" array.

runner-metadata.json must record invokedSkills, publicDocsRead, producedArtifacts, and sourceEvidence.
runner-metadata.json must also include messageId, agentName, phaseEvidence, and skillRuntimeEvidence. Include humanCheckpointEvidence for every human-owned checkpoint before advancing past it.
Write these files even if the task is blocked, ambiguous, unsupported, or failed.
Do not finish with chat-only status. If a target skill appears to lack a public capability, write capability_gap evidence and stop for evaluator/provider review instead of making the final unsupported decision yourself.

Important:
- Read only each public SKILL.md and public references that the skill itself asks you to read.
- Invoke the visible public skill entry for each stage and follow the allowed public runtime boundaries discovered from that entry.
- For human-owned browser capture, call only the public prepare step, hand off the visible browser to the user, write awaiting_human_capture / needs_human evidence, and stop. Do not synthesize search-result URLs, type into pages, call done, analyze, generate, verify, or extract until human capture completion is proven.
- Do not inspect or invoke hidden provider internals as a substitute for the public entry.
- Do not invent alternate execution paths outside the discovered public boundaries.
- Do not modify provider source, release source, or case input files.
- Stop after this one case attempt.
`;
}

function readableList(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (value === undefined || value === null || value === "") return "(none)";
  return String(value);
}

function readablePhaseList(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return "(none discovered)";
  return phases.map((phase) => {
    if (typeof phase === "string") return phase;
    return `${phase.id}${phase.allowedActor ? `[${phase.allowedActor}]` : ""}${phase.checkpoint ? `@${phase.checkpoint}` : ""}`;
  }).join(" -> ");
}

function readableCapabilityGaps(gaps) {
  if (!Array.isArray(gaps) || gaps.length === 0) return "(none)";
  return gaps.map((gap) => `${gap.capability}:${gap.handling ?? gap.status}`).join(", ");
}

function providerHandoffEnvelope(message) {
  const body = message.body ?? {};
  const evidence = body.evidencePaths ?? {};
  const responses = body.providerResponses ?? {};
  const runnerSummary = readableFileExcerpt(evidence.runnerReport, 1600);
  const loopStationFailure = readableFileExcerpt(evidence.loopStationFailureReport, 1200)
    || readableFileExcerpt(evidence.loopStationFailure, 1200);
  const manifestSummary = readableFileExcerpt(evidence.outputManifest, 1200);
  const evalSummary = readableFileExcerpt(evidence.evalReport, 1200);
  const recoveryArtifacts = body.loopProfile === "recovery-loop"
    ? `
Structured recovery artifacts are required for fixed:
- provider-fix-report.md
- provider-fix.json
- consumer-install-report.md
- consumer-install.json
- deploy-verify-report.md
- deploy-verify.json
`
    : "";
  return `Loop-station verdict:
- Case: ${message.caseId}
- Attempt: ${message.attempt}
- Observed status: ${body.status ?? "unknown"}
- This case is paused until provider response files are written and validated.

Required completion contract:
- Do not answer only in chat.
- You are not done until both response files exist.
- provider-response.json must parse and contain one of: fixed, known_unsupported, needs_human.
- Use fixed only when provider-owned release/update/install is complete and the consumer-installed skill has been updated.
- ${body.loopProfile === "recovery-loop" ? "For this recovery loop, fixed also requires the structured repair/install/deploy artifacts." : "Structured repair artifacts are optional unless the active profile requires them."}
- Minimum JSON shape:
{
  "response": "fixed | known_unsupported | needs_human",
  "reason": "short reason",
  "provider_changes": [],
  "release_update_install": [],
  "verification": []
}

Write exactly these response files:
- ${responses.markdown ?? "provider-response.md"}
- ${responses.json ?? "provider-response.json"}
${recoveryArtifacts}
Mailbox reply JSON:
- ${body.mailboxReplyPath ?? "(missing)"}

Case context:
Case folder: ${body.case?.folder ?? "(unknown)"}
Prompt path: ${body.case?.prompt ?? "(unknown)"}
Provider root: ${body.providerRoot ?? "(unknown)"}
Release root: ${body.releaseRoot ?? "(unknown)"}
Consumer root: ${body.consumerRoot ?? "(unknown)"}
Consumer install target: ${body.consumerInstallTarget ?? "(unknown)"}
Target skill install path: ${body.targetSkillInstallPath ?? "(unknown)"}

Evidence paths:
- Runner report: ${evidence.runnerReport ?? "(missing)"}
- Runner metadata: ${evidence.runnerMetadata ?? "(missing)"}
- Output manifest: ${evidence.outputManifest ?? "(missing)"}
- Loop-station failure: ${evidence.loopStationFailure ?? "(optional/missing)"}
- Loop-station failure report: ${evidence.loopStationFailureReport ?? "(optional/missing)"}
- Evaluator report: ${evidence.evalReport ?? "(optional/missing)"}
- Evaluator verdict: ${evidence.evalVerdict ?? "(optional/missing)"}

Loop-station failure summary:
${loopStationFailure ? `${loopStationFailure}\n\nRunner summary:\n` : ""}
${runnerSummary || "- No runner report was available. Inspect the evidence paths below."}

Output manifest summary:
${manifestSummary || "- No output manifest was available."}

Evaluator summary:
${evalSummary || "- No evaluator report was available."}

Your task:
Review the evidence from this provider repository. Decide whether provider behavior should change, the case is known unsupported, or a human decision is needed. If you change provider files, also perform any provider-owned release/update/install steps needed before a rerun.

Boundaries:
- Do not modify loop-station source.
- Do not edit case input files as a substitute for fixing provider behavior.
- Do not claim that station state, queue state, or next-case progress has been recorded. Only write your response files and state your provider-side result.
- After writing provider artifacts, write the mailbox reply JSON and then stop.
`;
}

function providerResponseFollowUpEnvelope(message) {
  const body = message.body ?? {};
  const responses = body.providerResponses ?? {};
  return `Provider response files are still missing or invalid.

Reason: ${body.reason ?? "unknown"}
${body.missing?.length ? `Missing: ${body.missing.join(", ")}\n` : ""}${body.error ? `JSON error: ${body.error}\n` : ""}${body.invalidResponse ? `Invalid response value: ${body.invalidResponse}\n` : ""}
${body.reason === "fixed_install_not_verified" ? `A fixed response was found, but release/install verification is incomplete.
Install proof: ${(body.installProof ?? []).join("; ") || "(none)"}
Install failures: ${(body.installFailures ?? []).join("; ") || "(none)"}
Release/consumer skill hash match: ${body.hashMatch === null ? "(not checked)" : String(body.hashMatch)}
Release SKILL.md: ${body.releaseSkillPath ?? "(missing)"}
Consumer SKILL.md: ${body.consumerSkillPath ?? "(missing)"}
Structured install artifacts verified: ${body.installArtifactsVerified === undefined ? "(not checked)" : String(body.installArtifactsVerified)}
Deploy verification already passed: ${body.deployVerificationVerified === undefined ? "(not checked)" : String(body.deployVerificationVerified)}

Complete the provider-owned release/update/install and rewrite provider-response.json, or change the response to needs_human if install cannot be completed.
` : ""}
Write both files now:
- ${responses.markdown ?? "provider-response.md"}
- ${responses.json ?? "provider-response.json"}

provider-response.json must contain:
{
  "response": "fixed | known_unsupported | needs_human",
  "reason": "short reason",
  "provider_changes": [],
  "release_update_install": [],
  "verification": []
}

Mailbox reply JSON:
- ${body.mailboxReplyPath ?? "(missing)"}

Do not answer only in chat. The handoff is complete only after both files exist, the JSON response value is valid, and the mailbox reply JSON is written.
`;
}

function shouldRequireMailboxReply(message) {
  return MAILBOX_REPLY_MESSAGE_TYPES.has(message.type);
}

function shouldPersistMailboxRequest(message) {
  return /-Model$/.test(String(message.to ?? ""));
}

function taskKindForMessage(message) {
  switch (message.type) {
    case "RUN_SKILL_CASE":
      return "skill_case";
    case "RUN_ACTION_STAGE":
      return "action_stage";
    case "EVALUATE_CASE":
      return "evaluation";
    case "CHALLENGE_REVIEW":
      return "challenge_review";
    case "REPORT_CASE_RESULT_TO_PROVIDER_CODEX":
      return "provider_handoff";
    case "DEPLOY_VERIFY":
      return "deploy_verify";
    case "FOLLOW_UP_PROVIDER_RESPONSE":
      return "provider_response_follow_up";
    default:
      return "model_task";
  }
}

function replyRoleForMessage(message) {
  switch (message.type) {
    case "RUN_SKILL_CASE":
    case "RUN_ACTION_STAGE":
      return "runner";
    case "EVALUATE_CASE":
    case "CHALLENGE_REVIEW":
      return "judgment";
    case "REPORT_CASE_RESULT_TO_PROVIDER_CODEX":
      return "provider_engineer";
    case "DEPLOY_VERIFY":
      return "deploy_verifier";
    default:
      return "model";
  }
}

function allowedReplyStatuses(message) {
  switch (message.type) {
    case "RUN_SKILL_CASE":
    case "RUN_ACTION_STAGE":
    case "EVALUATE_CASE":
    case "CHALLENGE_REVIEW":
    case "DEPLOY_VERIFY":
      return ["done", "blocked", "failed", "needs_human"];
    case "REPORT_CASE_RESULT_TO_PROVIDER_CODEX":
      return ["done", "blocked", "failed", "needs_human"];
    default:
      return ["done", "blocked", "failed", "needs_human"];
  }
}

function activationEventType(message) {
  switch (message.type) {
    case "RUN_SKILL_CASE":
    case "RUN_ACTION_STAGE":
      return "RUNNER_STARTED";
    case "EVALUATE_CASE":
    case "CHALLENGE_REVIEW":
      return "JUDGMENT_STARTED";
    case "REPORT_CASE_RESULT_TO_PROVIDER_CODEX":
      return "PROVIDER_STARTED";
    case "DEPLOY_VERIFY":
      return "DEPLOY_VERIFY_STARTED";
    default:
      return "MODEL_STARTED";
  }
}

function readableFileExcerpt(path, maxChars) {
  if (!path || !existsSync(path)) return "";
  const text = readFileSync(path, "utf8").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
}

function persistMailboxMessage(runDir, message) {
  const fileName = `${message.createdAt.replaceAll(/[:.]/g, "")}-${message.id}.json`;
  if (message.body?.mailboxRequestPath) writeJson(message.body.mailboxRequestPath, modelMailboxRequest(mailboxControlMessage(message)));
  writeJson(join(runDir, "mailbox", message.to, "inbox", fileName), message);
  writeJson(join(runDir, "mailbox", message.from, "outbox", fileName), message);
}

function upsertMessage(runDir, message) {
  const messages = readMessages(runDir);
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    messages.push(message);
  } else {
    messages[index] = message;
  }
  writeJson(messagesPath(runDir), messages);
}

function messagesPath(runDir) {
  return join(runDir, "messages.json");
}
