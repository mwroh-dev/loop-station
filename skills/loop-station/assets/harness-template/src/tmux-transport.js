import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { failMessage, inspectMailboxStarted, recordMailboxActivation, transitionMessage, writeEnvelope } from "./message-lifecycle.js";
import { writeJson } from "./fs.js";
import { observePane, waitForPaneState } from "./pane-watcher.js";
import { isPaneAlive } from "./tmux-station.js";

function tmux(args) {
  return execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function hasTmux() {
  return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

export async function pasteMessageToPane(runDir, panes, message, options = {}) {
  const targetPane = panes[message.to];
  const target = targetPane?.paneId;
  if (!hasTmux()) {
    failMessage(runDir, message.id, "failed", "tmux_unavailable");
    return { ok: false, reason: "tmux_unavailable" };
  }
  if (!target) {
    failMessage(runDir, message.id, "failed", "target_pane_missing");
    return { ok: false, reason: "target_pane_missing" };
  }
  if (!isPaneAlive(target)) {
    failMessage(runDir, message.id, "dead", "target_pane_dead");
    return { ok: false, reason: "target_pane_dead" };
  }

  const ready = await waitForPaneState(target, "ready", { timeoutMs: options.readyTimeoutMs ?? 30000 });
  if (ready.state !== "ready") {
    if (ready.state === "follow_up_pending") {
      transitionMessage(runDir, message.id, "blocked", {
        paneId: target,
        signals: ready.signals,
        failureReason: "target_pane_busy"
      });
      return { ok: false, reason: "target_pane_busy", ready };
    }
    const nextState = ready.state === "timeout" ? "timeout" : ready.state === "modal_blocked" ? "blocked" : ready.state;
    transitionMessage(runDir, message.id, nextState, {
      paneId: target,
      signals: ready.signals,
      failureReason: nextState === "blocked" ? "model_pane_startup_blocked" : undefined
    });
    return { ok: false, ready };
  }

  const envelope = writeEnvelope(runDir, message);
  const bufferName = `station-${message.id}`;
  tmux(["send-keys", "-t", target, "C-u"]);
  tmux(["load-buffer", "-b", bufferName, envelope.path]);
  tmux(["paste-buffer", "-b", bufferName, "-t", target]);
  transitionMessage(runDir, message.id, "submitted", { paneId: target });
  const pasteObservation = await waitForPaneState(target, ["dispatch_visible", "active", "ready", "follow_up_pending"], { timeoutMs: options.submitTimeoutMs ?? 10000 });
  await sleep(options.enterDelayMs ?? 500);
  tmux(["send-keys", "-t", target, "Enter"]);
  const activation = await waitForMailboxActivation(message, target, {
    timeoutMs: options.acceptTimeoutMs ?? 10000,
    intervalMs: options.activationPollIntervalMs ?? 250
  });
  try {
    tmux(["delete-buffer", "-b", bufferName]);
  } catch {
    // Best-effort cleanup only.
  }
  if (!activation.started) {
    transitionMessage(runDir, message.id, "transport_submit_not_started", {
      paneId: target,
      signals: activation.observation?.signals ?? ["activation_ack_missing"],
      failureReason: "activation_ack_missing",
      mailboxStartedPath: message.body?.mailboxStartedPath,
      activationReason: activation.reason,
      paneSnapshot: snapshotPaneObservation(activation.observation)
    });
    return { ok: false, pasteObservation, activation, failureReason: "activation_ack_missing" };
  }
  recordMailboxActivation(runDir, message, activation.payload);
  transitionMessage(runDir, message.id, "accepted_by_pane", {
    paneId: target,
    signals: activation.observation?.signals ?? [],
    mailboxStartedPath: activation.startedPath
  });
  writeDispatchAcceptanceEvidence(runDir, message, target, activation);
  transitionMessage(runDir, message.id, "processing", { paneId: target, mailboxStartedPath: activation.startedPath });
  return { ok: true, pasteObservation, accepted: activation };
}

function writeDispatchAcceptanceEvidence(runDir, message, paneId, accepted) {
  if (message.type !== "RUN_ACTION_STAGE") return;
  const stageDir = message.body?.stageDir;
  const stageSkill = message.body?.stage?.skill ?? null;
  if (!stageDir || !stageSkill) return;
  const evidence = {
    messageId: message.id,
    paneId,
    stageId: message.stageId ?? message.body?.stage?.id ?? null,
    stageSkill,
    acceptedAt: accepted.observedAt ?? new Date().toISOString(),
    startedPath: accepted.startedPath ?? message.body?.mailboxStartedPath ?? null,
    kind: "mailbox_activation",
    source: "tmux-transport"
  };
  writeJson(join(stageDir, ".station-dispatch-evidence.json"), evidence);
  writeJson(join(stageDir, ".station-runtime-evidence.json"), {
    ...evidence,
    compatibility: "legacy_dispatch_acceptance_not_runtime_execution"
  });
}

async function waitForMailboxActivation(message, paneId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();
  let observation = null;
  let lastStarted = inspectMailboxStarted(message);
  while (Date.now() - startedAt < timeoutMs) {
    lastStarted = inspectMailboxStarted(message);
    observation = observePane(paneId, observation);
    if (lastStarted.started) {
      return {
        ...lastStarted,
        observation,
        observedAt: new Date().toISOString()
      };
    }
    await sleep(intervalMs);
  }
  return {
    started: false,
    reason: lastStarted.reason ?? "missing_mailbox_started",
    startedPath: message.body?.mailboxStartedPath,
    observation,
    observedAt: new Date().toISOString()
  };
}

function snapshotPaneObservation(observation) {
  if (!observation) return null;
  return {
    paneId: observation.paneId,
    state: observation.state,
    signals: observation.signals ?? [],
    observedAt: observation.observedAt,
    text: observation.text ?? ""
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
