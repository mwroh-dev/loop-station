import { spawnSync } from "node:child_process";

export function launchAttachedRuntimeTerminal(topology, options = {}) {
  const platform = options.platform ?? process.platform;
  const app = options.app ?? process.env.STATION_TERMINAL_APP ?? "Terminal";
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const session = topology?.sessionName ?? "";
  const attachTarget = topology?.attachTarget ?? session;
  const attachCommand = `tmux attach -t ${shellEscapeSingle(attachTarget)}`;

  if (!attachTarget) {
    return {
      ok: false,
      reason: "missing_attach_target",
      attachCommand,
      terminalApp: app,
      terminalLaunchMethod: null
    };
  }

  if (platform !== "darwin") {
    return {
      ok: false,
      reason: "terminal_attach_unsupported_platform",
      attachCommand,
      terminalApp: app,
      terminalLaunchMethod: null
    };
  }

  const osaScript = buildTerminalScript(app, attachCommand);
  const result = spawnImpl("osascript", ["-e", osaScript], { encoding: "utf8" });
  const ok = !result.error && result.status === 0;
  return {
    ok,
    reason: ok ? null : (result.error?.message || result.stderr?.trim() || `osascript exited ${result.status}`),
    attachCommand,
    terminalApp: app,
    terminalLaunchMethod: "osascript",
    terminalWindowId: ok ? parseWindowId(result.stdout) : null
  };
}

export function closeAttachedRuntimeTerminal(topology, options = {}) {
  const platform = options.platform ?? process.platform;
  const app = options.app ?? topology?.terminalApp ?? process.env.STATION_TERMINAL_APP ?? "Terminal";
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const windowId = topology?.terminalWindowId ?? null;
  if (!windowId) return { ok: true, reason: null, terminalApp: app, terminalLaunchMethod: null };
  if (platform !== "darwin") {
    return { ok: false, reason: "terminal_close_unsupported_platform", terminalApp: app, terminalLaunchMethod: null };
  }
  const osaScript = buildTerminalCloseScript(app, windowId);
  const result = spawnImpl("osascript", ["-e", osaScript], { encoding: "utf8" });
  const ok = !result.error && result.status === 0;
  return {
    ok,
    reason: ok ? null : (result.error?.message || result.stderr?.trim() || `osascript exited ${result.status}`),
    terminalApp: app,
    terminalLaunchMethod: "osascript"
  };
}

function buildTerminalScript(app, attachCommand) {
  const escapedApp = appleScriptString(app);
  const escapedCommand = appleScriptString(`${attachCommand}; exit`);
  return `tell application ${escapedApp}
activate
do script ${escapedCommand}
delay 0.2
return id of front window
end tell`;
}

function buildTerminalCloseScript(app, windowId) {
  const escapedApp = appleScriptString(app);
  return `tell application ${escapedApp}
if exists (every window whose id is ${Number(windowId)}) then
close (every window whose id is ${Number(windowId)}) saving no
end if
end tell`;
}

function parseWindowId(stdout) {
  const value = Number.parseInt(String(stdout ?? "").trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function shellEscapeSingle(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}
