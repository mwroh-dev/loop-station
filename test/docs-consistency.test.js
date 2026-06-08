import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;

describe("documentation consistency", () => {
  it("keeps skill contract discovery docs aligned with the skill reference", () => {
    assertMirrored("skill-contract-discovery.md");
  });

  it("keeps core contract reference docs present", () => {
    for (const file of [
      "skills/loop-station/references/interview.md",
      "docs/runtime-contract.md",
      "skills/loop-station/references/runtime-contract.md",
      "docs/review-checklist.md",
      "skills/loop-station/references/review-checklist.md"
    ]) {
      assertFileExists(file);
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
