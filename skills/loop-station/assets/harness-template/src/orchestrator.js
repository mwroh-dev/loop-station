import { existsSync } from "node:fs";
import { join } from "node:path";
import { emit } from "./events.js";
import { appendStationLog } from "./station-control.js";
import { tickRun } from "./cli.js";

export async function runOrchestrator(runDir) {
  appendStationLog(runDir, "orchestrator starting");
  emit(runDir, "orchestrator_started", { pid: process.pid });
  const missingMetadata = ["run.json", "state.json", "queue.json", "messages.json"]
    .filter((file) => !existsSync(join(runDir, file)));
  if (missingMetadata.length > 0) {
    emit(runDir, "orphan_run_detected", { missingMetadata });
    appendStationLog(runDir, `orphan run metadata missing: ${missingMetadata.join(", ")}`);
    return;
  }
  let heartbeat = 0;
  let consecutiveTickFailures = 0;
  while (!existsSync(join(runDir, "locks", "stop-requested"))) {
    heartbeat += 1;
    try {
      const changed = await tickRun(runDir, { dispatchOnly: false });
      consecutiveTickFailures = 0;
      if (changed) appendStationLog(runDir, `tick applied state change heartbeat=${heartbeat}`);
    } catch (error) {
      consecutiveTickFailures += 1;
      emit(runDir, "orchestrator_tick_failed", { heartbeat, consecutiveTickFailures, error: error.message });
      appendStationLog(runDir, `tick failed heartbeat=${heartbeat} consecutive=${consecutiveTickFailures} error=${error.message}`);
    }
    emit(runDir, "orchestrator_heartbeat", { heartbeat });
    appendStationLog(runDir, `heartbeat ${heartbeat}`);
    // Back off while ticks fail persistently so a broken run does not flood
    // station.log/events.ndjson at full polling speed.
    const backoffMs = Math.min(2000 * 2 ** Math.min(consecutiveTickFailures, 4), 30000);
    await sleep(backoffMs);
  }
  emit(runDir, "orchestrator_stopped", { heartbeat });
  appendStationLog(runDir, "orchestrator stopped");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
