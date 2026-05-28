import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const stationBin = join(root, "skills", "loop-station", "assets", "harness-template", "bin", "station");

describe("public guide fixtures", () => {
  it("validates echo-skill-loop station shape", () => {
    const config = join(root, "examples", "echo-skill-loop", "station.json");
    const result = spawnSync(process.execPath, [stationBin, "validate", "--json", "--skip-tools"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, STATION_CONFIG: config }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.caseManifest.ok, true);
    assert.equal(report.checks.targetSkill.ok, true);
  });

  it("ships runnable reset-and-run scripts for echo-skill-loop", () => {
    for (const script of ["reset.sh", "run-tmux.sh", "reset-and-run.sh"]) {
      assert.equal(existsSync(join(root, "examples", "echo-skill-loop", script)), true, `echo-skill-loop/${script}`);
    }
  });
});
