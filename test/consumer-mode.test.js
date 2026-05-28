import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertConsumerSafeSetupSpec, canonicalSourceRoot, detectLoopStationContext } from "../bin/consumer-mode.js";

describe("consumer mode detection", () => {
  it("treats the canonical repo root as canonical_source", () => {
    const context = detectLoopStationContext({ cwd: canonicalSourceRoot() });
    assert.equal(context.mode, "canonical_source");
  });

  it("detects a consumer project before setup when only the local skill install exists", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-consumer-pre-"));
    mkdirSync(join(project, ".codex", "skills", "loop-station"), { recursive: true });
    writeFileSync(join(project, ".codex", "skills", "loop-station", "SKILL.md"), "skill\n");

    const context = detectLoopStationContext({ cwd: project });
    assert.equal(context.mode, "consumer_project_pre_setup");
    assert.equal(context.projectRoot, project);
  });

  it("detects a consumer project after setup when both local skill and .loop-station exist", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-consumer-post-"));
    mkdirSync(join(project, ".codex", "skills", "loop-station"), { recursive: true });
    mkdirSync(join(project, ".loop-station"), { recursive: true });
    writeFileSync(join(project, ".codex", "skills", "loop-station", "SKILL.md"), "skill\n");

    const context = detectLoopStationContext({ cwd: project });
    assert.equal(context.mode, "consumer_project_post_setup");
    assert.equal(context.projectRoot, project);
  });
});

describe("consumer setup spec validation", () => {
  it("rejects mutable location targets inside the installed bundle", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-consumer-spec-loc-"));
    mkdirSync(join(project, ".codex", "skills", "loop-station", "assets", "harness-template", "src"), { recursive: true });
    writeFileSync(join(project, ".codex", "skills", "loop-station", "SKILL.md"), "skill\n");

    assert.throws(
      () => assertConsumerSafeSetupSpec(project, {
        locations: {
          stationRoot: ".codex/skills/loop-station/assets/harness-template/src"
        }
      }),
      /Consumer mode rejects mutable target inside installed loop-station bundle/
    );
  });

  it("rejects custom role cwd targets inside the installed bundle", () => {
    const project = mkdtempSync(join(tmpdir(), "loop-station-consumer-spec-role-"));
    mkdirSync(join(project, ".codex", "skills", "loop-station", "assets", "harness-template", "test"), { recursive: true });
    writeFileSync(join(project, ".codex", "skills", "loop-station", "SKILL.md"), "skill\n");

    assert.throws(
      () => assertConsumerSafeSetupSpec(project, {
        customRoles: [
          { role: "custom", alias: "Bad", cwd: ".codex/skills/loop-station/assets/harness-template/test" }
        ]
      }),
      /Consumer mode rejects mutable target inside installed loop-station bundle/
    );
  });
});
