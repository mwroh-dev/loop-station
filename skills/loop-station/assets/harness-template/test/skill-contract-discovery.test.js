import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { discoverSkillProfile, requestNeedsDataExtract } from "../src/skill-contract-discovery.js";

describe("skill contract discovery", () => {
  it("discovers browser-flow public runtime boundaries and data extraction requirements", () => {
    const skillDir = makeBrowserFlowSkill();

    const profile = discoverSkillProfile({
      name: "$browser-flow",
      installPath: skillDir,
      requestText: "쿠팡에서 제로 음료를 검색하고 현재 검색 결과 rows를 수집해줘."
    });

    assert.equal(profile.name, "$browser-flow");
    assert.deepEqual(profile.publicEntryDocs.map((doc) => doc.relativePath), [
      "SKILL.md",
      "prompt.md",
      "references/artifact-schemas.md",
      "references/verification-rules.md"
    ]);
    assert.ok(profile.allowedPublicRuntimeCalls.some((call) => call.includes("bundle/runtime/scripts/cli.mjs")));
    assert.deepEqual(profile.phases.map((phase) => phase.id), ["capture", "analyze", "generate", "verify", "extract"]);
    assert.equal(profile.phases[0].allowedActor, "human_user");
    assert.equal(profile.phases[0].captureMode, "human_manual");
    assert.equal(profile.phases[0].mayAdvanceWhen, "human_capture_completed");
    assert.equal(profile.phases[1].allowedActor, "skill_runtime");
    assert.equal(profile.requiresDataExtract, true);
    assert.ok(profile.requiredEvidence.includes("extract-result.json"));
    const captureCheckpoint = profile.humanCheckpoints.find((checkpoint) => checkpoint.id === "awaiting_capture");
    assert.equal(captureCheckpoint.requiredActor, "human_user");
    assert.match(captureCheckpoint.handoffInstruction, /visible Chrome/i);
    assert.equal(captureCheckpoint.completionSignal, "capture_done");
    assert.ok(profile.llmDelegableCheckpoints.some((checkpoint) => checkpoint.id === "automation_driven_capture"));
  });

  it("detects sheet-ops public capability gaps without making runner final unsupported", () => {
    const skillDir = makeSheetOpsSkill();

    const profile = discoverSkillProfile({
      name: "$sheet-ops",
      installPath: skillDir,
      requestText: "browser-flow rows를 새 xlsx workbook에 써줘."
    });

    assert.equal(profile.name, "$sheet-ops");
    assert.ok(profile.capabilityGaps.some((gap) => gap.capability === "write_values"));
    assert.equal(profile.runnerMayFinalizeUnsupported, false);
  });

  it("classifies list/table/value requests as data extraction requests", () => {
    assert.equal(requestNeedsDataExtract("제로 음료 검색 결과 목록을 표로 수집"), true);
    assert.equal(requestNeedsDataExtract("로그인 버튼을 눌러 워크플로우를 저장"), false);
  });
});

function makeBrowserFlowSkill() {
  const dir = mkdtempSync(join(tmpdir(), "browser-flow-skill-"));
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---
name: browser-flow
description: Browser workflow capture.
---

# Browser Flow

Load prompt.md for the LLM instruction set. Load references from references/ only at the relevant pipeline stage.
`);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({
    prompt: "prompt.md",
    references: ["references/artifact-schemas.md", "references/verification-rules.md"]
  }, null, 2)}\n`);
  writeFileSync(join(dir, "prompt.md"), `# Browser Flow Public Entry

Runtime commands execute from \`.codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs\`.

### Phase 1 — Capture
node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--snapshot-dom]
[await_capture checkpoint — user performs the demo]

### Phase 2 — Analyze
node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs analyze --run-id <id>

### Phase 3 — Generate
node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs generate --run-id <id>

### Phase 4 — Verify
node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs verify --run-id <id> --headless

### Phase 5 — Extract (OPTIONAL — only when the flow must return page DATA)
Run Extract for page DATA requests such as top N items, current values, prices, rows, or list collection.
node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs extract --run-id <id> --step <n> --schema <targetSchema.json>
extract-result.json { status: data|confident-zero|drift, rows[] }
`);
  writeFileSync(join(dir, "references", "artifact-schemas.md"), "# Artifact Schemas\n\n- reports/verification.json\n");
  writeFileSync(join(dir, "references", "verification-rules.md"), "# Verification Rules\n\nReplay is green only when all pass.\n");
  return dir;
}

function makeSheetOpsSkill() {
  const dir = mkdtempSync(join(tmpdir(), "sheet-ops-skill-"));
  writeFileSync(join(dir, "SKILL.md"), `---
name: sheet-ops
description: Workbook operations.
---

# Sheet Ops

Supported today:
- use this skill as the single human-facing entry for local workbook requests

Preview limitations:
- \`write_values\` is not a public agent capability

Follow-up:
- public write_values orchestration and e2e tests
`);
  return dir;
}
