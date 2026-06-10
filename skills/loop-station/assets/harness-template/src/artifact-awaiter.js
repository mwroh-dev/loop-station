import { existsSync, readFileSync } from "node:fs";
import { emit } from "./events.js";
import { transitionMessage, failMessage } from "./message-lifecycle.js";

export async function waitForArtifacts(runDir, message, artifacts, options = {}) {
  transitionMessage(runDir, message.id, "artifact_waiting", { artifacts });
  const timeoutMs = options.timeoutMs ?? 1800000;
  const intervalMs = options.intervalMs ?? 2000;
  const errorPaths = options.errorPaths ?? [];
  const startedAt = Date.now();
  let lastNoticeAt = 0;
  while (true) {
    for (const errorPath of errorPaths) {
      if (existsSync(errorPath)) {
        const reason = `error artifact exists: ${errorPath}`;
        failMessage(runDir, message.id, "failed", reason);
        throw new Error(reason);
      }
    }
    const missing = artifacts.filter((path) => !artifactReady(path));
    if (missing.length === 0) {
      const records = artifacts.map((path) => ({
        path,
        bytes: readFileSync(path).byteLength
      }));
      transitionMessage(runDir, message.id, "artifact_ready", { artifacts: records });
      emit(runDir, "artifacts_ready", { messageId: message.id, artifacts: records });
      return records;
    }
    if (Date.now() - lastNoticeAt >= 10000) {
      emit(runDir, "artifact_waiting", { messageId: message.id, missing });
      lastNoticeAt = Date.now();
    }
    if (Date.now() - startedAt > timeoutMs) {
      const reason = `Timed out waiting for artifacts: ${missing.join(", ")}`;
      failMessage(runDir, message.id, "timeout", reason);
      throw new Error(reason);
    }
    await sleep(intervalMs);
  }
}

function artifactReady(path) {
  // Tolerate files vanishing between checks (e.g. write-then-rename patterns).
  try {
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
