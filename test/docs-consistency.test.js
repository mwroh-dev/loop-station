import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;

describe("documentation consistency", () => {
  it("keeps skill contract discovery docs aligned with the skill reference", () => {
    const publicDoc = read("docs/skill-contract-discovery.md");
    const skillRef = read("skills/loop-station/references/skill-contract-discovery.md");
    for (const heading of [
      "## Purpose",
      "## Contract Shape",
      "## Layer Authority",
      "## Public Runtime Boundary",
      "## Multi-Phase Skills",
      "## Capability-Gated Skills",
      "## Setup Gate",
      "## Refresh Procedure"
    ]) {
      assert.match(publicDoc, new RegExp(escapeRegExp(heading)));
      assert.match(skillRef, new RegExp(escapeRegExp(heading)));
    }
  });

  it("links discovery from interview, runtime, and review docs", () => {
    for (const file of [
      "skills/loop-station/references/interview.md",
      "docs/runtime-contract.md",
      "skills/loop-station/references/runtime-contract.md",
      "docs/review-checklist.md",
      "skills/loop-station/references/review-checklist.md"
    ]) {
      assert.match(read(file), /Skill Contract Discovery|skill-contract-discovery\.md/, file);
    }
  });

  it("keeps role machine preset docs aligned with the skill reference", () => {
    assertMirrored("role-machine-presets.md");
    for (const path of [
      "role-machine-presets/concepts.md",
      "role-machine-presets/orchestrator.md",
      "role-machine-presets/runner.md",
      "role-machine-presets/judgment.md",
      "role-machine-presets/boundaries.md"
    ]) {
      assertMirrored(path);
      assertReferenceLinked("docs/role-machine-presets.md", path);
    }
  });

  it("keeps preset recommendation flow docs aligned with the skill reference", () => {
    assertMirrored("preset-recommendation-flow.md");
  });

  it("keeps preset catalog docs aligned with the skill reference", () => {
    assertMirrored("preset-catalog.md");
    for (const path of [
      "preset-catalog/source-layout.md",
      "preset-catalog/scoring.md",
      "preset-catalog/materialization.md",
      "preset-catalog/authoring.md"
    ]) {
      assertMirrored(path);
      assertReferenceLinked("docs/preset-catalog.md", path);
    }
  });

  it("keeps backlog docs aligned with the skill reference", () => {
    assertMirrored("backlog.md");
  });

  it("documents structured Install Mode questions with a plain-text fallback", () => {
    for (const file of [
      "skills/loop-station/SKILL.md",
      "skills/loop-station/references/interview.md"
    ]) {
      const content = read(file);
      assert.match(content, /request_user_input/, file);
      assert.match(content, /header/, file);
      assert.match(content, /snake_case/, file);
      assert.match(content, /plain-text|plain text/, file);
    }
  });

  it("documents the two-phase project-local lifecycle for skill install and setup", () => {
    for (const file of [
      "README.md",
      "docs/runtime-contract.md",
      "docs/skill-contract-discovery.md",
      "skills/loop-station/references/skill-contract-discovery.md"
    ]) {
      const content = read(file);
      assert.match(content, /\.codex\/skills\/loop-station/, file);
      assert.match(content, /\.loop-station/, file);
      assert.match(content, /install-skill|skill install/i, file);
      assert.match(content, /setup/, file);
    }
  });

  it("documents the installed project-local bundle as read-only in consumer mode", () => {
    for (const file of [
      "skills/loop-station/SKILL.md",
      "skills/loop-station/references/interview.md",
      "skills/loop-station/references/public-safety-boundary.md",
      "docs/security-boundaries.md",
      "docs/skill-contract-discovery.md",
      "skills/loop-station/references/skill-contract-discovery.md"
    ]) {
      const content = read(file);
      assert.match(content, /\.codex\/skills\/loop-station\/\*\*/, file);
      assert.match(content, /read-only/, file);
      assert.match(content, /assets\/harness-template\/src/, file);
      assert.match(content, /assets\/harness-template\/test/, file);
      assert.match(content, /\.loop-station\/\*\*/, file);
      assert.match(content, /reject|enforc/i, file);
    }
  });

  it("documents trigger-session control and attached runtime execution separation", () => {
    for (const file of [
      "README.md",
      "skills/loop-station/SKILL.md",
      "skills/loop-station/references/interview.md",
      "docs/runtime-contract.md",
      "skills/loop-station/references/runtime-contract.md"
    ]) {
      const content = read(file);
      assert.match(content, /trigger\/control session|trigger session/i, file);
      assert.match(content, /runtime panes|runtime session|attached Terminal\.app|attached terminal/i, file);
      assert.match(content, /station start/, file);
    }
  });
});

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertMirrored(path) {
  assertFileExists(`docs/${path}`);
  assertFileExists(`skills/loop-station/references/${path}`);
  assert.equal(read(`skills/loop-station/references/${path}`), read(`docs/${path}`), path);
}

function assertReferenceLinked(indexPath, referencedPath) {
  assert.match(read(indexPath), new RegExp(escapeRegExp(referencedPath)), `${indexPath} should link ${referencedPath}`);
}

function assertFileExists(path) {
  assert.equal(existsSync(join(root, path)), true, `${path} should exist`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
