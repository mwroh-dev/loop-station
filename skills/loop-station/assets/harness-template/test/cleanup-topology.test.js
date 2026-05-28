import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "station");

describe("cleanup topology", () => {
  it("kills only managed panes when the station borrowed the current session", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-cleanup-borrowed-"));
    const runDir = join(dir, "runs", "20260101010101");
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCleanupTmuxScript());
    chmodSync(fakeTmux, 0o755);
    writeFixtureRun(runDir, {
      mode: "borrowed-session",
      sessionName: "leader",
      attachTarget: "leader:0",
      leaderPaneId: "%0",
      managedPaneIds: ["%11", "%12"]
    });

    const result = spawnSync(process.execPath, [bin, "cleanup"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, STATION_RUNS_DIR: join(dir, "runs"), TMUX_FAKE_LOG: logPath }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /kill-pane -t %11/);
    assert.match(calls, /kill-pane -t %12/);
    assert.doesNotMatch(calls, /kill-session/);
  });

  it("kills the owned session for terminal-attached-owned-session topology", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-cleanup-owned-"));
    const runDir = join(dir, "runs", "20260101010101");
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const fakeOsa = join(fakeBin, "osascript");
    const logPath = join(dir, "tmux.log");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCleanupTmuxScript());
    writeFileSync(fakeOsa, fakeOsascriptScript());
    chmodSync(fakeTmux, 0o755);
    chmodSync(fakeOsa, 0o755);
    writeFixtureRun(runDir, {
      mode: "terminal-attached-owned-session",
      sessionName: "loop-station-test",
      attachTarget: "loop-station-test",
      terminalApp: "Terminal",
      terminalWindowId: 321,
      managedPaneIds: ["%11", "%12"]
    });

    const result = spawnSync(process.execPath, [bin, "cleanup"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, STATION_RUNS_DIR: join(dir, "runs"), TMUX_FAKE_LOG: logPath }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = readFileSync(logPath, "utf8");
    assert.match(calls, /kill-session -t loop-station-test/);
    assert.match(calls, /OSA: -e tell application/);
  });
});

function writeFixtureRun(runDir, topology) {
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify({ runId: "20260101010101", sessionName: "loop-station-20260101010101" }, null, 2)}\n`);
  writeFileSync(join(runDir, "state.json"), `${JSON.stringify({ runId: "20260101010101", status: "booted", activeCaseId: null, activeStageId: null, completedCases: 0, failedCases: 0, messages: {} }, null, 2)}\n`);
  writeFileSync(join(runDir, "queue.json"), "[]\n");
  writeFileSync(join(runDir, "messages.json"), "[]\n");
  writeFileSync(join(runDir, "station-topology.json"), `${JSON.stringify(topology, null, 2)}\n`);
}

function fakeCleanupTmuxScript() {
  return `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
case "$1" in
  -V|kill-pane|kill-session)
    exit 0
    ;;
esac
exit 0
`;
}

function fakeOsascriptScript() {
  return `#!/bin/sh
printf 'OSA: %s\\n' "$*" >> "$TMUX_FAKE_LOG"
exit 0
`;
}
