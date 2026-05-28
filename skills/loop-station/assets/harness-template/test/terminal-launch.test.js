import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeAttachedRuntimeTerminal, launchAttachedRuntimeTerminal } from "../src/terminal-launch.js";

describe("terminal launch helper", () => {
  it("uses Terminal.app via osascript on macOS", () => {
    const calls = [];
    const result = launchAttachedRuntimeTerminal(
      { sessionName: "loop-station-test", attachTarget: "loop-station-test" },
      {
        platform: "darwin",
        spawnImpl: (cmd, args) => {
          calls.push({ cmd, args });
          return { status: 0, stdout: "321\n", stderr: "", error: null };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.terminalApp, "Terminal");
    assert.equal(result.terminalLaunchMethod, "osascript");
    assert.equal(result.terminalWindowId, 321);
    assert.equal(calls[0].cmd, "osascript");
    assert.match(calls[0].args[1], /tmux attach -t/);
    assert.match(calls[0].args[1], /; exit/);
  });

  it("fails cleanly on unsupported platforms", () => {
    const result = launchAttachedRuntimeTerminal(
      { sessionName: "loop-station-test", attachTarget: "loop-station-test" },
      { platform: "linux" }
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "terminal_attach_unsupported_platform");
  });

  it("closes the launched Terminal window when a window id is recorded", () => {
    const calls = [];
    const result = closeAttachedRuntimeTerminal(
      { terminalApp: "Terminal", terminalWindowId: 321 },
      {
        platform: "darwin",
        spawnImpl: (cmd, args) => {
          calls.push({ cmd, args });
          return { status: 0, stdout: "", stderr: "", error: null };
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(calls[0].cmd, "osascript");
    assert.match(calls[0].args[1], /close \(every window whose id is 321\)/);
  });
});
