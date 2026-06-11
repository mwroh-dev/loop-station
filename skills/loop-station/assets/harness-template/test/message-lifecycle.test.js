import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  createMessage,
  inspectMailboxReply,
  inspectMailboxStarted,
  readMessages,
  transitionMessage,
  writeEnvelope
} from "../src/message-lifecycle.js";

describe("mailbox lifecycle", () => {
  it("writes model envelopes with request, started, and reply paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-envelope-"));
    const message = createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });

    const envelope = writeEnvelope(dir, message);
    const request = JSON.parse(readFileSync(message.body.mailboxRequestPath, "utf8"));

    assert.match(envelope.text, /MAILBOX_REQUEST=/);
    assert.match(envelope.text, /MAILBOX_STARTED=/);
    assert.match(envelope.text, /MAILBOX_REPLY=/);
    assert.equal(envelope.text.includes("STATION_MESSAGE_JSON"), false);
    assert.equal(envelope.text.includes("MAILBOX_JSON="), false);
    assert.equal(envelope.controlMessage.body.mailboxRequestPath, message.body.mailboxRequestPath);
    assert.equal(envelope.controlMessage.body.mailboxStartedPath, message.body.mailboxStartedPath);
    assert.equal(envelope.controlMessage.body.mailboxReplyPath, message.body.mailboxReplyPath);
    assert.equal(request.taskId, "message-1");
    assert.equal(request.agentName, "RunnerAgent-Model");
    assert.equal(request.role, "runner");
    assert.equal(request.caseId, "case-1");
    assert.equal(request.attempt, 1);
    assert.equal(request.stageId, "run");
    assert.equal(request.taskKind, "skill_case");
    assert.equal(request.mailbox.requestPath, message.body.mailboxRequestPath);
    assert.equal(request.mailbox.startedPath, message.body.mailboxStartedPath);
    assert.equal(request.mailbox.replyPath, message.body.mailboxReplyPath);
    assert.ok(request.renderedTask.includes("Activation mailbox JSON"));
    assert.deepEqual(Object.keys(request).sort(), [
      "agentName",
      "artifactPaths",
      "attempt",
      "caseId",
      "mailbox",
      "renderedTask",
      "role",
      "stageId",
      "taskId",
      "taskKind"
    ]);
    assert.equal("type" in request, false);
    assert.equal("from" in request, false);
    assert.equal("to" in request, false);
    assert.equal("body" in request, false);
    assert.equal("transitions" in request, false);
    assert.doesNotMatch(JSON.stringify(request), /RUN_SKILL_CASE|REPORT_CASE_RESULT_TO_PROVIDER_CODEX/);
  });

  it("validates a matching started artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-started-"));
    const message = createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });
    writeJsonFile(message.body.mailboxStartedPath, {
      messageId: "message-1",
      agentName: "RunnerAgent-Model",
      role: "runner",
      caseId: "case-1",
      attempt: 1,
      stageId: "run",
      status: "started",
      summary: "Started reading the mailbox request."
    });

    const result = inspectMailboxStarted(message);

    assert.equal(result.started, true);
    assert.equal(result.payload.status, "started");
  });

  it("rejects malformed or mismatched started artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-started-invalid-"));
    const message = createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });

    assert.equal(inspectMailboxStarted(message).reason, "missing_mailbox_started");

    writeJsonFile(message.body.mailboxStartedPath, {
      messageId: "other-message",
      agentName: "RunnerAgent-Model",
      role: "runner",
      caseId: "case-1",
      attempt: 1,
      stageId: "run",
      status: "started",
      summary: "wrong message"
    });
    assert.equal(inspectMailboxStarted(message).reason, "mailbox_started_message_mismatch");

    writeJsonFile(message.body.mailboxStartedPath, {
      messageId: "message-1",
      agentName: "RunnerAgent-Model",
      role: "runner",
      caseId: "case-1",
      attempt: 1,
      stageId: "run",
      status: "done",
      summary: "wrong status"
    });
    assert.equal(inspectMailboxStarted(message).reason, "mailbox_started_invalid_status");
  });

  it("does not treat a valid reply as activation evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-reply-only-"));
    const message = createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });
    writeJsonFile(message.body.mailboxReplyPath, {
      messageId: "message-1",
      agentName: "RunnerAgent-Model",
      role: "runner",
      caseId: "case-1",
      attempt: 1,
      stageId: "run",
      status: "done",
      summary: "completed",
      artifactPaths: []
    });

    assert.equal(inspectMailboxReply(message).complete, true);
    assert.equal(inspectMailboxStarted(message).started, false);
    assert.equal(inspectMailboxStarted(message).reason, "missing_mailbox_started");
  });

  it("rejects transition bodies that would overwrite protected message fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-protected-"));
    const message = createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });

    for (const key of ["id", "state", "caseId", "transitions", "body"]) {
      assert.throws(
        () => transitionMessage(dir, message.id, "pending", { [key]: "tampered" }),
        /protected message field/
      );
    }

    const transitioned = transitionMessage(dir, message.id, "pending", { failureReason: null, paneId: "%1" });
    assert.equal(transitioned.id, "message-1");
    assert.equal(transitioned.state, "pending");
    assert.equal(transitioned.paneId, "%1");

    // A null/omitted body must not crash (it behaves like the old `...body` no-op).
    assert.doesNotThrow(() => transitionMessage(dir, message.id, "submitted", null));
    assert.equal(transitionMessage(dir, message.id, "accepted_by_pane").state, "accepted_by_pane");

    // An array body must not pollute the message with numeric keys.
    const afterArray = transitionMessage(dir, message.id, "processing", ["x", "y"]);
    assert.equal(afterArray.state, "processing");
    assert.equal("0" in afterArray, false);
    assert.equal("1" in afterArray, false);
  });

  it("surfaces corrupted messages.json instead of silently resetting history", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-lifecycle-corrupt-"));

    assert.deepEqual(readMessages(dir), []);

    createMessage(dir, {
      id: "message-1",
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1,
      stageId: "run"
    });
    writeFileSync(join(dir, "messages.json"), "[{\"id\": \"message-1\"");

    assert.throws(() => readMessages(dir), SyntaxError);
  });
});

function writeJsonFile(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}
