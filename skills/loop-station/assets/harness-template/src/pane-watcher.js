import { isPaneAlive, capturePane } from "./tmux-station.js";

export function classifyPaneText(text) {
  if (/No active thread is available/.test(text)) return { state: "modal_blocked", signals: ["no_active_thread"] };
  if (/Queued follow-up inputs/.test(text) && !/Working|esc to interrupt/.test(text)) return { state: "follow_up_pending", signals: ["queued_follow_up"] };
  if (/Skip until next version|Press enter to continue/.test(text)) return { state: "modal_blocked", signals: ["update_prompt"] };
  if (/Do you trust the files|Trust and continue|trust this (?:folder|project|workspace)/i.test(text)) return { state: "modal_blocked", signals: ["trust_prompt"] };
  if (/Working|esc to interrupt/.test(text)) return { state: "active", signals: ["execution_started", "working"] };
  if (/MAILBOX_REQUEST=|Pasted Content/.test(text)) return { state: "dispatch_visible", signals: ["control_line_visible"] };
  if (/>_ OpenAI Codex|›/.test(text)) return { state: "ready", signals: ["prompt_visible"] };
  return { state: "unknown", signals: [] };
}

export async function waitForModelPanesReady(panes, options = {}) {
  const blocked = [];
  for (const [agentName, pane] of Object.entries(panes ?? {})) {
    if (!pane?.codexRuntime || pane.preflightRequired === false) continue;
    const observed = await waitForPaneState(pane.paneId, "ready", {
      timeoutMs: options.timeoutMs ?? 30000,
      intervalMs: options.intervalMs ?? 250
    });
    if (observed.state !== "ready") {
      blocked.push({
        agentName,
        paneId: pane.paneId,
        state: observed.state,
        signals: observed.signals ?? []
      });
    }
  }
  return {
    ok: blocked.length === 0,
    reason: blocked.length > 0 ? "model_pane_startup_blocked" : null,
    blocked
  };
}

export function observePane(paneId, previous = null) {
  if (!isPaneAlive(paneId)) {
    return { paneId, state: "dead", signals: ["dead"], changed: false, text: "" };
  }
  const text = capturePane(paneId);
  const classified = classifyPaneText(text);
  return {
    paneId,
    ...classified,
    changed: previous ? previous.text !== text : true,
    observedAt: new Date().toISOString(),
    text
  };
}

export async function waitForPaneState(paneId, states, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  const wanted = new Set(Array.isArray(states) ? states : [states]);
  const startedAt = Date.now();
  let previous = null;
  while (Date.now() - startedAt < timeoutMs) {
    const observation = observePane(paneId, previous);
    if (wanted.has(observation.state)) return observation;
    if (["modal_blocked", "dead", "follow_up_pending"].includes(observation.state) && !wanted.has(observation.state)) return observation;
    previous = observation;
    await sleep(intervalMs);
  }
  return { paneId, state: "timeout", signals: ["watch_timeout"], observedAt: new Date().toISOString(), text: previous?.text ?? "" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
