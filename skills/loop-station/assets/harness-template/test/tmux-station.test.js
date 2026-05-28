import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { attachSession, createTmuxStation, focusStation } from "../src/tmux-station.js";
import { waitForModelPanesReady } from "../src/pane-watcher.js";

describe("tmux station layout", () => {
  it("fails fast when tmux is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-missing-"));
    const fakeBin = join(dir, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const previousPath = process.env.PATH;
    process.env.PATH = fakeBin;
    try {
      assert.throws(
        () => createTmuxStation(dir, { sessionName: "fixture-session" }, {
          windowName: "team",
          defaultAgentCommand: "node -e 'setInterval(()=>{},1000)'",
          agentCommandEnv: "STATION_AGENT_COMMAND",
          locations: { stationRoot: dir, consumerRoot: dir },
          agents: [
            { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true }
          ]
        }),
        /tmux is required/
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("falls back to a new window when a full-team pane split has no space", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    try {
      const station = createTmuxStation(dir, { sessionName: "fixture-session" }, {
        windowName: "team",
        defaultAgentCommand: "node -e 'setInterval(()=>{},1000)'",
        agentCommandEnv: "STATION_AGENT_COMMAND",
        locations: { stationRoot: dir, consumerRoot: dir },
        agents: [
          { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
          { name: "RunnerAgent-Model", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true }
        ]
      });
      const panes = station.panes;

      assert.equal(panes["StationControl"].paneId, "%1");
      assert.equal(panes["RunnerAgent-Model"].paneId, "%2");
      assert.equal(station.topology.mode, "owned-session");
      const calls = readFileSync(logPath, "utf8");
      assert.match(calls, /split-window/);
      assert.match(calls, /new-window/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = previousLog;
      }
    }
  });

  it("attaches to the tmux session for visible full-team runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-attach-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    try {
      const result = attachSession("visible-session");

      assert.equal(result.status, 0);
      const calls = readFileSync(logPath, "utf8");
      assert.match(calls, /attach -t visible-session/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = previousLog;
      }
    }
  });

  it("splits from the current tmux pane when already inside tmux", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-current-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCurrentPaneTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    const previousTmux = process.env.TMUX;
    const previousPane = process.env.TMUX_PANE;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    process.env.TMUX = "session";
    process.env.TMUX_PANE = "%0";
    try {
      const station = createTmuxStation(dir, { sessionName: "fixture-session" }, {
        windowName: "team",
        defaultAgentCommand: "node -e 'setInterval(()=>{},1000)'",
        agentCommandEnv: "STATION_AGENT_COMMAND",
        locations: { stationRoot: dir, consumerRoot: dir },
        agents: [
          { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
          { name: "RunnerAgent-Model", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true }
        ]
      });

      assert.equal(station.topology.mode, "borrowed-session");
      assert.equal(station.topology.leaderPaneId, "%0");
      assert.equal(station.topology.attachTarget, "leader:0");
      const calls = readFileSync(logPath, "utf8");
      assert.doesNotMatch(calls, /new-session/);
      assert.match(calls, /split-window -h -p 50 -t %0/);
      assert.match(calls, /split-window -v -p 50 -t %1/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) delete process.env.TMUX_FAKE_LOG;
      else process.env.TMUX_FAKE_LOG = previousLog;
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
      if (previousPane === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = previousPane;
    }
  });

  it("switches client instead of nested attach for borrowed sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-focus-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCurrentPaneTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    const previousTmux = process.env.TMUX;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    process.env.TMUX = "session";
    try {
      const result = focusStation({ mode: "borrowed-session", sessionName: "leader", attachTarget: "leader:0" });
      assert.equal(result.status, 0);
      const calls = readFileSync(logPath, "utf8");
      assert.match(calls, /switch-client -t leader:0/);
      assert.doesNotMatch(calls, /attach -t leader/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) delete process.env.TMUX_FAKE_LOG;
      else process.env.TMUX_FAKE_LOG = previousLog;
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
    }
  });

  it("uses a horizontal right-section layout when configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-horizontal-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCurrentPaneTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    const previousTmux = process.env.TMUX;
    const previousPane = process.env.TMUX_PANE;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    process.env.TMUX = "session";
    process.env.TMUX_PANE = "%0";
    try {
      createTmuxStation(dir, { sessionName: "fixture-session" }, {
        windowName: "team",
        defaultAgentCommand: "node -e 'setInterval(()=>{},1000)'",
        agentCommandEnv: "STATION_AGENT_COMMAND",
        layout: { sectionDirection: "horizontal" },
        locations: { stationRoot: dir, consumerRoot: dir, providerRoot: dir },
        agents: [
          { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
          { name: "RunnerAgent-Model", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true },
          { name: "EvaluatorAgent-Model", kind: "model", cwd: "stationRoot", lifecycle: "attempt-scoped", visible: true }
        ]
      });

      const calls = readFileSync(logPath, "utf8");
      assert.match(calls, /split-window -h -p 50 -t %0/);
      assert.match(calls, /split-window -h -p 50 -t %1/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) delete process.env.TMUX_FAKE_LOG;
      else process.env.TMUX_FAKE_LOG = previousLog;
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
      if (previousPane === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = previousPane;
    }
  });

  it("passes resolved codex model settings into model panes", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-models-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    const logPath = join(dir, "tmux.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeCurrentPaneTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    const previousLog = process.env.TMUX_FAKE_LOG;
    const previousTmux = process.env.TMUX;
    const previousPane = process.env.TMUX_PANE;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    process.env.TMUX_FAKE_LOG = logPath;
    process.env.TMUX = "session";
    process.env.TMUX_PANE = "%0";
    try {
      createTmuxStation(dir, { sessionName: "fixture-session" }, {
        windowName: "team",
        defaultAgentCommand: "CODEX_BIN=\"${STATION_CODEX_BIN:-codex}\"; exec \"$CODEX_BIN\" --no-alt-screen -C \"$STATION_AGENT_CWD\" --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox",
        agentCommandEnv: "STATION_AGENT_COMMAND",
        codexRuntime: {
          invokerDefault: { model: "gpt-5.4", model_reasoning_effort: "xhigh" },
          roleDefaults: {
            runner: { model_reasoning_effort: "medium" }
          },
          agentOverrides: {
            "EvaluatorAgent-Model": { model: "gpt-5.5", model_reasoning_effort: "high" }
          }
        },
        locations: { stationRoot: dir, consumerRoot: dir },
        agents: [
          { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
          { name: "RunnerAgent-Model", role: "runner", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true },
          { name: "EvaluatorAgent-Model", role: "evaluator", kind: "model", cwd: "stationRoot", lifecycle: "attempt-scoped", visible: true }
        ]
      });

      const calls = readFileSync(logPath, "utf8");
      assert.match(calls, /-m gpt-5\.4/);
      assert.match(calls, /model_reasoning_effort=\"medium\"/);
      assert.match(calls, /-m gpt-5\.5/);
      assert.match(calls, /model_reasoning_effort=\"high\"/);
    } finally {
      process.env.PATH = previousPath;
      if (previousLog === undefined) delete process.env.TMUX_FAKE_LOG;
      else process.env.TMUX_FAKE_LOG = previousLog;
      if (previousTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = previousTmux;
      if (previousPane === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = previousPane;
    }
  });

  it("isolates model pane workdirs by lifecycle under the role root", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-workdirs-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    try {
      const station = createTmuxStation(dir, { sessionName: "fixture-session" }, {
        sessionPrefix: "fixture-session",
        windowName: "team",
        defaultAgentCommand: "node -e 'setInterval(()=>{},1000)'",
        agentCommandEnv: "STATION_AGENT_COMMAND",
        locations: { stationRoot: dir, consumerRoot: dir, providerRoot: dir },
        agents: [
          { name: "StationControl", kind: "code", cwd: "stationRoot", lifecycle: "run-scoped", visible: true },
          { name: "RunnerAgent-Model", role: "runner", kind: "model", cwd: "consumerRoot", lifecycle: "attempt-scoped", visible: true },
          { name: "JudgmentAgent-Model", role: "judgment", kind: "model", cwd: "stationRoot", lifecycle: "attempt-scoped", visible: true },
          { name: "ProviderEngineer-Model", role: "provider_engineer", kind: "model", cwd: "providerRoot", lifecycle: "case-scoped", visible: true }
        ]
      });

      assert.match(station.panes["RunnerAgent-Model"].cwd, /\.loop-station-agent-workdirs\/fixture-session\/RunnerAgent-Model\/attempt\//);
      assert.match(station.panes["JudgmentAgent-Model"].cwd, /\.loop-station-agent-workdirs\/fixture-session\/JudgmentAgent-Model\/attempt\//);
      assert.match(station.panes["ProviderEngineer-Model"].cwd, /\.loop-station-agent-workdirs\/fixture-session\/ProviderEngineer-Model\/case\//);
      assert.equal(station.panes["StationControl"].cwd, dir);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("fails model pane startup preflight when Codex is blocked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-tmux-preflight-"));
    const fakeBin = join(dir, "bin");
    const fakeTmux = join(fakeBin, "tmux");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeTmux, fakeBlockedPaneTmuxScript());
    chmodSync(fakeTmux, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath}`;
    try {
      const result = await waitForModelPanesReady({
        "RunnerAgent-Model": { paneId: "%1", kind: "model", codexRuntime: true, preflightRequired: true }
      }, { timeoutMs: 20 });

      assert.equal(result.ok, false);
      assert.equal(result.reason, "model_pane_startup_blocked");
      assert.equal(result.blocked[0].agentName, "RunnerAgent-Model");
      assert.equal(result.blocked[0].state, "modal_blocked");
      assert.deepEqual(result.blocked[0].signals, ["trust_prompt"]);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

function fakeTmuxScript() {
  return `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
case "$1" in
  -V)
    echo 'tmux 3.4'
    exit 0
    ;;
  new-session)
    echo '%1'
    exit 0
    ;;
  split-window)
    echo 'no space for new pane' >&2
    exit 1
    ;;
  new-window)
    echo '%2'
    exit 0
    ;;
  select-pane|select-layout)
    exit 0
    ;;
  attach)
    exit 0
    ;;
  display-message)
    echo '%1'
    exit 0
    ;;
  capture-pane)
    echo '>_ OpenAI Codex'
    exit 0
    ;;
esac
exit 0
`;
}

function fakeCurrentPaneTmuxScript() {
  return `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
case "$1" in
  -V)
    echo 'tmux 3.4'
    exit 0
    ;;
  display-message)
    format="$5"
    target="$4"
    if [ "$format" = '#S:#I #{pane_id}' ]; then
      echo 'leader:0 %0'
      exit 0
    fi
    if [ "$format" = '#S:#I' ]; then
      case "$target" in
        %1|%2) echo 'leader:0' ;;
        *) echo 'leader:1' ;;
      esac
      exit 0
    fi
    echo '%0'
    exit 0
    ;;
  split-window)
    if printf '%s\n' "$*" | grep -q -- '-t %0'; then
      echo '%1'
    else
      echo '%2'
    fi
    exit 0
    ;;
  select-pane|select-layout|clear-history|switch-client)
    exit 0
    ;;
  capture-pane)
    echo '>_ OpenAI Codex'
    exit 0
    ;;
esac
exit 0
`;
}

function fakeBlockedPaneTmuxScript() {
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
    echo 'Do you trust the files in this folder?'
    exit 0
    ;;
esac
exit 0
`;
}
