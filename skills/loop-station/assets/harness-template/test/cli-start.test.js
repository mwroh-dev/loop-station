import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { enforceRuntimePolicy, makeRuntimeVisible, resolveStartMode } from "../src/cli.js";

describe("station start mode", () => {
  it("attaches visibly by default on an interactive terminal", () => {
    const mode = resolveStartMode({ attach: false, detached: false, stdinIsTTY: true });
    assert.equal(mode.attach, true);
    assert.equal(mode.detached, false);
  });

  it("rejects detached startup even when explicitly requested", () => {
    assert.throws(
      () => resolveStartMode({ attach: false, detached: true, stdinIsTTY: true }),
      /visible runtime|--detached|always visible/i
    );
  });

  it("stays visible even when the trigger session is non-interactive", () => {
    const mode = resolveStartMode({ attach: false, detached: false, stdinIsTTY: false });
    assert.equal(mode.attach, true);
    assert.equal(mode.detached, false);
  });

  it("rejects detached startup when the station requires visible attach", () => {
    assert.throws(
      () => enforceRuntimePolicy({
        runtimePolicy: {
          attachRequired: true,
          allowDetached: false
        }
      }, {
        attach: false,
        detached: true
      }),
      /attach-required|visible attach|--detached/
    );
  });

  it("marks owned sessions as terminal-attached when terminal launch succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-visible-owned-"));
    writeFileSync(join(dir, "station-topology.json"), `${JSON.stringify({
      mode: "owned-session",
      sessionName: "loop-station-test",
      attachTarget: "loop-station-test",
      windowTarget: "loop-station-test:team",
      managedPaneIds: ["%1", "%2"]
    }, null, 2)}\n`);

    const visible = await makeRuntimeVisible(dir, {
      mode: "owned-session",
      sessionName: "loop-station-test",
      attachTarget: "loop-station-test",
      windowTarget: "loop-station-test:team",
      managedPaneIds: ["%1", "%2"]
    }, {
      terminalLaunchOptions: {
        platform: "darwin",
        spawnImpl: () => ({ status: 0, stdout: "", stderr: "", error: null })
      }
    });

    assert.equal(visible.ok, true);
    assert.equal(visible.topology.mode, "terminal-attached-owned-session");
    assert.equal(visible.topology.terminalLaunchMethod, "osascript");
  });

  it("fails owned-session visibility when terminal launch fails", async () => {
    const visible = await makeRuntimeVisible("/tmp/loop-station-noop", {
      mode: "owned-session",
      sessionName: "loop-station-test",
      attachTarget: "loop-station-test",
      windowTarget: "loop-station-test:team",
      managedPaneIds: ["%1", "%2"]
    }, {
      terminalLaunchOptions: {
        platform: "darwin",
        spawnImpl: () => ({ status: 1, stdout: "", stderr: "osascript failed", error: null })
      }
    });

    assert.equal(visible.ok, false);
    assert.match(visible.attachCommand, /tmux attach -t/);
    assert.match(visible.reason, /osascript failed/);
  });
});
