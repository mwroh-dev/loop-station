import { spawnSync } from "node:child_process";
import { emit } from "./events.js";
import { failMessage, transitionMessage } from "./message-lifecycle.js";

export function runVerifier(runDir, message, verifier = null) {
  if (!verifier) {
    transitionMessage(runDir, message.id, "verified", { verifier: "none" });
    return { status: "skipped" };
  }
  if (verifier.type !== "command") throw new Error(`Unsupported verifier type: ${verifier.type}`);
  const result = spawnSync(verifier.command, verifier.args ?? [], {
    cwd: verifier.cwd,
    encoding: "utf8",
    shell: Boolean(verifier.shell)
  });
  const record = {
    type: "command",
    command: verifier.command,
    args: verifier.args ?? [],
    cwd: verifier.cwd ?? null,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
  emit(runDir, "verifier_done", { messageId: message.id, status: result.status });
  if (result.status !== 0) {
    failMessage(runDir, message.id, "failed", `Verifier failed with status ${result.status}`);
    return record;
  }
  transitionMessage(runDir, message.id, "verified", { verifier: record });
  return record;
}
