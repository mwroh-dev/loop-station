import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inspectProviderResponse } from "../src/provider-response.js";

describe("provider response inspection", () => {
  it("keeps fixed incomplete when install failed", () => {
    const attemptDir = makeAttemptDir();
    const fixture = createConfigFixture({ installSkill: true });
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: ["Attempted install-skill.sh; blocked because Go was not found and requires Go 1.25 or newer."]
    });

    const result = inspectProviderResponse(attemptDir, { config: fixture.config });

    assert.equal(result.complete, false);
    assert.equal(result.reason, "fixed_install_not_verified");
    assert.equal(result.response, "fixed");
    assert.equal(result.hashMatch, false);
    assert.ok(result.installFailures.some((failure) => /Go was not found/.test(failure)));
  });

  it("keeps fixed incomplete when release and consumer skill hashes differ", () => {
    const attemptDir = makeAttemptDir();
    const fixture = createConfigFixture({ installSkill: true });
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "release\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "consumer\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`]
    });

    const result = inspectProviderResponse(attemptDir, { config: fixture.config });

    assert.equal(result.complete, false);
    assert.equal(result.reason, "fixed_install_not_verified");
    assert.equal(result.hashMatch, false);
  });

  it("accepts fixed when install proof is present and skill hashes match", () => {
    const attemptDir = makeAttemptDir();
    const fixture = createConfigFixture({ installSkill: true });
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`],
      verification: ["consumer skill hash matches release skill hash"]
    });

    const result = inspectProviderResponse(attemptDir, { config: fixture.config });

    assert.equal(result.complete, true);
    assert.equal(result.response, "fixed");
    assert.equal(result.hashMatch, true);
  });

  it("keeps recovery-loop fixed incomplete without structured repair companion artifacts", () => {
    const attemptDir = makeAttemptDir();
    const fixture = createConfigFixture({ installSkill: true, profile: "recovery-loop" });
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`],
      verification: ["consumer skill hash matches release skill hash"]
    });

    const result = inspectProviderResponse(attemptDir, { config: fixture.config });

    assert.equal(result.complete, false);
    assert.equal(result.reason, "fixed_install_not_verified");
    assert.equal(result.installArtifactsVerified, false);
  });

  it("accepts recovery-loop fixed after structured repair, install, and deploy verification artifacts exist", () => {
    const attemptDir = makeAttemptDir();
    const fixture = createConfigFixture({ installSkill: true, profile: "recovery-loop" });
    writeFileSync(join(fixture.releaseSkillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeFileSync(join(fixture.skillPath, "SKILL.md"), skillManifest({ body: "synced\n" }));
    writeProviderResponse(attemptDir, "fixed", {
      release_update_install: [`installed example-skill skill to ${fixture.skillPath}`],
      verification: ["consumer skill hash matches release skill hash"]
    });
    writeRecoveryRepairArtifacts(attemptDir);

    const result = inspectProviderResponse(attemptDir, { config: fixture.config });

    assert.equal(result.complete, true);
    assert.equal(result.response, "fixed");
    assert.equal(result.installArtifactsVerified, true);
  });

  it("stays incomplete while provider response files are missing", () => {
    const attemptDir = makeAttemptDir();
    writeFileSync(join(attemptDir, "provider-response.json"), "{\"response\":\"fixed\"}\n");

    const result = inspectProviderResponse(attemptDir);

    assert.equal(result.complete, false);
    assert.equal(result.reason, "missing_response_files");
    assert.deepEqual(result.missing, ["provider-response.md"]);
  });

  it("stays incomplete for invalid provider response JSON", () => {
    const attemptDir = makeAttemptDir();
    writeFileSync(join(attemptDir, "provider-response.md"), "# Provider response\n");
    writeFileSync(join(attemptDir, "provider-response.json"), "{ nope\n");

    const result = inspectProviderResponse(attemptDir);

    assert.equal(result.complete, false);
    assert.equal(result.reason, "invalid_provider_response_json");
    assert.match(result.error, /JSON/);
  });

  it("stays incomplete for unknown response values", () => {
    const attemptDir = makeAttemptDir();
    writeProviderResponse(attemptDir, "maybe");

    const result = inspectProviderResponse(attemptDir);

    assert.equal(result.complete, false);
    assert.equal(result.reason, "invalid_provider_response_value");
    assert.equal(result.response, "maybe");
  });

  it("accepts known unsupported and needs human without install proof", () => {
    const unsupportedDir = makeAttemptDir();
    const humanDir = makeAttemptDir();
    writeProviderResponse(unsupportedDir, "known_unsupported");
    writeProviderResponse(humanDir, "needs_human");

    assert.equal(inspectProviderResponse(unsupportedDir).complete, true);
    assert.equal(inspectProviderResponse(humanDir).complete, true);
  });
});

function createConfigFixture({ installSkill, profile = null }) {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-provider-inspection-"));
  const consumerRoot = join(dir, "consumer");
  const releaseRoot = join(dir, "release");
  const releaseSkillPath = join(releaseRoot, "skills", "example-skill");
  const skillPath = join(consumerRoot, ".codex", "skills", "example-skill");
  mkdirSync(releaseSkillPath, { recursive: true });
  writeFileSync(join(releaseSkillPath, "SKILL.md"), skillManifest({ body: "release\n" }));
  if (installSkill) {
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), skillManifest());
  }
  const config = {
    targetSkillName: "$example-skill",
    profileMode: profile ? "preset" : "raw",
    loopProfile: profile,
    locations: {
      releaseRoot,
      consumerRoot,
      consumerInstallTarget: consumerRoot,
      targetSkillInstallPath: skillPath
    }
  };
  if (profile === "recovery-loop") {
    config.repairContract = {
      requireConsumerInstall: true,
      requireDeployVerification: true,
      requireReleaseConsumerHashMatch: true
    };
  }
  return { config, skillPath, releaseSkillPath };
}

function makeAttemptDir() {
  return mkdtempSync(join(tmpdir(), "provider-response-attempt-"));
}

function writeProviderResponse(attemptDir, response, overrides = {}) {
  writeFileSync(join(attemptDir, "provider-response.md"), `# Provider response\n\nResponse: \`${response}\`\n`);
  writeFileSync(join(attemptDir, "provider-response.json"), `${JSON.stringify({
    response,
    reason: "done",
    provider_changes: [],
    release_update_install: [],
    verification: [],
    ...overrides
  }, null, 2)}\n`);
}

function writeRecoveryRepairArtifacts(attemptDir) {
  writeFileSync(join(attemptDir, "provider-fix-report.md"), "# Provider fix\n");
  writeFileSync(join(attemptDir, "provider-fix.json"), `${JSON.stringify({ status: "completed", changedFiles: ["skill.js"] }, null, 2)}\n`);
  writeFileSync(join(attemptDir, "consumer-install-report.md"), "# Consumer install\n");
  writeFileSync(join(attemptDir, "consumer-install.json"), `${JSON.stringify({ status: "completed", installed: true }, null, 2)}\n`);
  writeFileSync(join(attemptDir, "deploy-verify-report.md"), "# Deploy verify\n");
  writeFileSync(join(attemptDir, "deploy-verify.json"), `${JSON.stringify({ status: "passed", hashMatch: true }, null, 2)}\n`);
}

function skillManifest({ body = "fixture\n" } = {}) {
  return `---
name: example-skill
description: Fixture skill for provider response tests.
---

# example-skill

${body}`;
}
