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
  while (!existsSync(join(runDir, "locks", "stop-requested"))) {
    heartbeat += 1;
    try {
      const changed = await tickRun(runDir, { dispatchOnly: false });
      if (changed) appendStationLog(runDir, `tick applied state change heartbeat=${heartbeat}`);
    } catch (error) {
      emit(runDir, "orchestrator_tick_failed", { heartbeat, error: error.message });
      appendStationLog(runDir, `tick failed heartbeat=${heartbeat} error=${error.message}`);
    }
    emit(runDir, "orchestrator_heartbeat", { heartbeat });
    appendStationLog(runDir, `heartbeat ${heartbeat}`);
    await sleep(2000);
  }
  emit(runDir, "orchestrator_stopped", { heartbeat });
  appendStationLog(runDir, "orchestrator stopped");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
