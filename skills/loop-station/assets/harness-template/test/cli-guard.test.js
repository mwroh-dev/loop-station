import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runnerGuardOptionsForStage } from "../src/cli.js";

describe("runner guard options", () => {
  it("includes allowed public runtime calls discovered from the active stage skill", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-station-stage-guard-"));
    const skillPath = join(dir, "consumer", ".codex", "skills", "browser-flow");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), `---
name: browser-flow
description: Browser flow fixture.
---

# Browser Flow

Use \`node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs prepare\`.
`);

    const options = runnerGuardOptionsForStage(
      {
        runnerForbiddenPatterns: ["bundle/runtime"],
        targetSkills: [],
        locations: { consumerRoot: join(dir, "consumer") },
        codexRuntime: {},
        agents: []
      },
      {
        skill: "$browser-flow",
        installPath: skillPath
      }
    );

    assert.deepEqual(options.forbiddenPatterns, ["bundle/runtime"]);
    assert.ok(options.allowedPublicRuntimeCalls.some((call) => call.includes("bundle/runtime/scripts/cli.mjs")));
  });
});
