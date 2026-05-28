import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPaneText } from "../src/pane-watcher.js";

describe("pane watcher", () => {
  it("separates prompt visibility from execution start", () => {
    assert.deepEqual(classifyPaneText(">_ OpenAI Codex\n› "), {
      state: "ready",
      signals: ["prompt_visible"]
    });
    assert.deepEqual(classifyPaneText("Working (esc to interrupt)"), {
      state: "active",
      signals: ["execution_started", "working"]
    });
    assert.deepEqual(classifyPaneText("MAILBOX_REQUEST=/tmp/request.json\nMAILBOX_REPLY=/tmp/reply.json"), {
      state: "dispatch_visible",
      signals: ["control_line_visible"]
    });
  });

  it("classifies Codex startup blocks distinctly", () => {
    assert.deepEqual(classifyPaneText("Skip until next version\nPress enter to continue"), {
      state: "modal_blocked",
      signals: ["update_prompt"]
    });
    assert.deepEqual(classifyPaneText("Queued follow-up inputs"), {
      state: "follow_up_pending",
      signals: ["queued_follow_up"]
    });
    assert.deepEqual(classifyPaneText("Do you trust the files in this folder?"), {
      state: "modal_blocked",
      signals: ["trust_prompt"]
    });
  });
});
