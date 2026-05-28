import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createMessage } from "../src/message-lifecycle.js";
import { pasteMessageToPane } from "../src/tmux-transport.js";

describe("tmux transport", () => {
  it("fails instead of pretending success when the target pane is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-transport-missing-pane-"));
    const message = createMessage(dir, {
      runId: "run-1",
      to: "RunnerAgent-Model",
      type: "RUN_SKILL_CASE",
      caseId: "case-1",
      attempt: 1
    });

    const result = await pasteMessageToPane(dir, {}, message);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "target_pane_missing");
    const messages = JSON.parse(readFileSync(join(dir, "messages.json"), "utf8"));
    assert.equal(messages[0].state, "failed");
    assert.equal(messages[0].failureReason, "target_pane_missing");
  });

  it("does not accept a pasted prompt until the model writes started artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-transport-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const stateDir = join(dir, "state");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(fakeTmux, fakeTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousStateDir = process.env.TMUX_FAKE_STATE_DIR;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_STATE_DIR = stateDir;
    try {
      const message = createMessage(dir, {
        runId: "run-1",
        to: "RunnerAgent-Model",
        type: "RUN_SKILL_CASE",
        caseId: "case-1",
        attempt: 1
      });

      const result = await pasteMessageToPane(
        dir,
        { "RunnerAgent-Model": { paneId: "%1" } },
        message,
        { submitTimeoutMs: 20, acceptTimeoutMs: 20, secondAcceptTimeoutMs: 20, enterDelayMs: 1, secondEnterDelayMs: 1 }
      );

      assert.equal(result.ok, false);
      const messages = JSON.parse(readFileSync(join(dir, "messages.json"), "utf8"));
      assert.equal(messages[0].state, "transport_submit_not_started");
      assert.equal(messages[0].failureReason, "activation_ack_missing");
    } finally {
      process.env.PATH = previousPath;
      if (previousStateDir === undefined) {
        delete process.env.TMUX_FAKE_STATE_DIR;
      } else {
        process.env.TMUX_FAKE_STATE_DIR = previousStateDir;
      }
    }
  });

  it("treats queued follow-up before dispatch as a busy pane instead of prompt acceptance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-transport-busy-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const stateDir = join(dir, "state");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(fakeTmux, fakeBusyTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousStateDir = process.env.TMUX_FAKE_STATE_DIR;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_STATE_DIR = stateDir;
    try {
      const message = createMessage(dir, {
        runId: "run-1",
        to: "RunnerAgent-Model",
        type: "RUN_SKILL_CASE",
        caseId: "case-1",
        attempt: 1
      });

      const result = await pasteMessageToPane(
        dir,
        { "RunnerAgent-Model": { paneId: "%1" } },
        message,
        { readyTimeoutMs: 20, submitTimeoutMs: 20, acceptTimeoutMs: 20, secondAcceptTimeoutMs: 20, enterDelayMs: 1, secondEnterDelayMs: 1 }
      );

      assert.equal(result.ok, false);
      assert.equal(result.reason, "target_pane_busy");
      const messages = JSON.parse(readFileSync(join(dir, "messages.json"), "utf8"));
      assert.equal(messages[0].state, "blocked");
      assert.equal(messages[0].failureReason, "target_pane_busy");
    } finally {
      process.env.PATH = previousPath;
      if (previousStateDir === undefined) {
        delete process.env.TMUX_FAKE_STATE_DIR;
      } else {
        process.env.TMUX_FAKE_STATE_DIR = previousStateDir;
      }
    }
  });

  it("writes dispatch acceptance evidence for action stages after mailbox activation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-transport-evidence-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const stateDir = join(dir, "state");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(fakeTmux, fakeAcceptedTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousStateDir = process.env.TMUX_FAKE_STATE_DIR;
    const previousStartedPath = process.env.TMUX_FAKE_STARTED_PATH;
    const previousMessageId = process.env.TMUX_FAKE_MESSAGE_ID;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_STATE_DIR = stateDir;
    try {
      const stageDir = join(dir, "stage");
      mkdirSync(stageDir, { recursive: true });
      const message = createMessage(dir, {
        runId: "run-1",
        to: "Runner1-Model",
        type: "RUN_ACTION_STAGE",
        caseId: "case-1",
        attempt: 1,
        stageId: "extract",
        body: {
          stageDir,
          stage: {
            id: "extract",
            skill: "$entity-extractor"
          }
        }
      });
      process.env.TMUX_FAKE_STARTED_PATH = message.body.mailboxStartedPath;
      process.env.TMUX_FAKE_MESSAGE_ID = message.id;

      const result = await pasteMessageToPane(
        dir,
        { "Runner1-Model": { paneId: "%1" } },
        message,
        { submitTimeoutMs: 20, acceptTimeoutMs: 20, secondAcceptTimeoutMs: 20, enterDelayMs: 1, secondEnterDelayMs: 1 }
      );

      assert.equal(result.ok, true);
      const evidence = JSON.parse(readFileSync(join(stageDir, ".station-dispatch-evidence.json"), "utf8"));
      assert.equal(evidence.messageId, message.id);
      assert.equal(evidence.stageSkill, "$entity-extractor");
      assert.equal(evidence.paneId, "%1");
      assert.equal(evidence.kind, "mailbox_activation");
      assert.equal(evidence.startedPath, message.body.mailboxStartedPath);
    } finally {
      process.env.PATH = previousPath;
      if (previousStateDir === undefined) {
        delete process.env.TMUX_FAKE_STATE_DIR;
      } else {
        process.env.TMUX_FAKE_STATE_DIR = previousStateDir;
      }
      if (previousStartedPath === undefined) {
        delete process.env.TMUX_FAKE_STARTED_PATH;
      } else {
        process.env.TMUX_FAKE_STARTED_PATH = previousStartedPath;
      }
      if (previousMessageId === undefined) {
        delete process.env.TMUX_FAKE_MESSAGE_ID;
      } else {
        process.env.TMUX_FAKE_MESSAGE_ID = previousMessageId;
      }
    }
  });
});

function fakeTmuxScript() {
  return `#!/bin/sh
case "$1" in
  -V)
    echo 'tmux 3.4'
    exit 0
    ;;
  display-message)
    echo '%1'
    exit 0
    ;;
  capture-pane)
    if [ -f "$TMUX_FAKE_STATE_DIR/pasted" ]; then
      echo 'Queued follow-up inputs'
    else
      echo '>_ OpenAI Codex'
      echo '› '
    fi
    exit 0
    ;;
  paste-buffer)
    touch "$TMUX_FAKE_STATE_DIR/pasted"
    exit 0
    ;;
  send-keys|load-buffer|delete-buffer)
    exit 0
    ;;
esac
exit 0
`;
}

function fakeAcceptedTmuxScript() {
  return `#!/bin/sh
case "$1" in
  -V)
    echo 'tmux 3.4'
    exit 0
    ;;
  display-message)
    echo '%1'
    exit 0
    ;;
  capture-pane)
    if [ -f "$TMUX_FAKE_STATE_DIR/pasted" ] && [ ! -f "$TMUX_FAKE_STATE_DIR/entered" ]; then
      echo 'MAILBOX_REQUEST=/tmp/message.json'
      echo 'MAILBOX_REPLY=/tmp/reply.json'
      exit 0
    fi
    if [ -f "$TMUX_FAKE_STATE_DIR/entered" ]; then
      echo '• Working (1s • esc to interrupt)'
      exit 0
    fi
    echo '>_ OpenAI Codex'
    exit 0
    ;;
  paste-buffer)
    touch "$TMUX_FAKE_STATE_DIR/pasted"
    exit 0
    ;;
  send-keys)
    if [ "$4" = "Enter" ]; then
      touch "$TMUX_FAKE_STATE_DIR/entered"
      if [ -n "$TMUX_FAKE_STARTED_PATH" ] && [ "$TMUX_FAKE_STARTED_PATH" != "undefined" ]; then
        mkdir -p "$(dirname "$TMUX_FAKE_STARTED_PATH")"
        cat > "$TMUX_FAKE_STARTED_PATH" <<JSON
{
  "messageId": "$TMUX_FAKE_MESSAGE_ID",
  "agentName": "Runner1-Model",
  "role": "runner",
  "caseId": "case-1",
  "attempt": 1,
  "stageId": "extract",
  "status": "started",
  "summary": "started"
}
JSON
      fi
    fi
    exit 0
    ;;
  load-buffer|delete-buffer)
    exit 0
    ;;
esac
exit 0
`;
}

function fakeBusyTmuxScript() {
  return `#!/bin/sh
case "$1" in
  -V)
    echo 'tmux 3.4'
    exit 0
    ;;
  display-message)
    echo '%1'
    exit 0
    ;;
  capture-pane)
    echo 'Queued follow-up inputs'
    exit 0
    ;;
  send-keys|load-buffer|paste-buffer|delete-buffer)
    exit 0
    ;;
esac
exit 0
`;
}
