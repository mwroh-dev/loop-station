import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const bin = join(root, "bin", "station");

describe("orchestrator", () => {
  it("stops instead of looping forever when run metadata is missing", () => {
    const runDir = mkdtempSync(join(tmpdir(), "loop-station-orphan-run-"));

    const result = spawnSync(process.execPath, [bin, "orchestrate", runDir], {
      cwd: root,
      encoding: "utf8",
      timeout: 1000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.signal, null);
    const log = readFileSync(join(runDir, "station.log"), "utf8");
    assert.match(log, /orphan run metadata missing/);
  });
});
