import { join } from "node:path";
import { appendJsonLine } from "./fs.js";

export function emit(runDir, type, body = {}) {
  appendJsonLine(join(runDir, "events.ndjson"), {
    type,
    at: new Date().toISOString(),
    ...body
  });
}
