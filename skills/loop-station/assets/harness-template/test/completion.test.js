import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  detectCaseFolderChanges,
  detectRunnerBypassViolations,
  inspectActionStageAttempt,
  inspectRunnerAttempt,
  snapshotCaseFolder
} from "../src/completion.js";

describe("runner attempt completion", () => {
  it("detects a passed attempt from required artifacts and manifest verification", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "DONE", verification: { pass: true } });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
    assert.equal(result.reason, "runner_attempt_passed");
  });

  it("stays incomplete while required artifacts are missing", () => {
    const attemptDir = makeAttemptDir();
    writeFileSync(join(attemptDir, "runner-report.md"), "report\n");
    writeFileSync(join(attemptDir, "runner-metadata.json"), "{}\n");

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, false);
    assert.equal(result.passed, false);
    assert.deepEqual(result.missing, ["outputManifest"]);
  });

  it("detects a completed failed attempt from a DONE non-pass manifest", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "DONE", verdict: "fail" });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "runner_attempt_failed");
  });

  it("accepts model-written DONE state manifests without verification blocks", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { state: "DONE", outputs: [{ kind: "file", path: "output.txt" }] });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
    assert.equal(result.reason, "runner_attempt_passed");
  });

  it("accepts passed status manifests as terminal pass candidates", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "passed", verdict: "pass", outputs: [{ kind: "file", path: "output.txt" }] });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
    assert.equal(result.reason, "runner_attempt_passed");
  });

  it("fails completed attempts that contain bypass shims or synthetic fixtures", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "DONE", verification: { pass: true } });
    writeFileSync(join(attemptDir, "codex"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(attemptDir, "result-verifier-fixture.json"), "{}\n");

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "runner_bypass_artifacts_detected");
    assert.deepEqual(result.guardViolations.sort(), ["codex", "result-verifier-fixture.json"]);
  });

  it("fails completed attempts whose reports mention direct provider entrypoint bypasses", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "DONE", verification: { pass: true } });
    writeFileSync(join(attemptDir, "runner-report.md"), "Ran ./.codex/skills/example-skill/agent-system/bin/example-skill-agent directly.\n");

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "runner_bypass_artifacts_detected");
    assert.deepEqual(result.guardViolations, ["runner-report.md: .codex/skills/example-skill/agent-system/bin/example-skill-agent"]);
  });

  it("detects direct provider entrypoint bypasses in live pane transcripts", () => {
    const text = "• Ran ./.codex/skills/example-skill/agent-system/bin/example-skill-agent";

    const violations = detectRunnerBypassViolations(text, "runner-pane");

    assert.deepEqual(violations, ["runner-pane: .codex/skills/example-skill/agent-system/bin/example-skill-agent"]);
  });

  it("does not flag search-only mentions of internal command names", () => {
    const text = "• Ran rg -n \"internal-command|LegacyEnvelope\"";

    const violations = detectRunnerBypassViolations(text, "runner-pane");

    assert.deepEqual(violations, []);
  });

  it("detects configured internal launcher discovery attempts in live pane transcripts", () => {
    const text = `• Ran which example-skill-agent || find /tmp/loop-station-fixtures -name example-skill-agent
• Explored
  └ Search example-skill-agent in .codex/skills/example-skill`;

    const violations = detectRunnerBypassViolations(text, "runner-pane", {
      forbiddenPatterns: [
        "which\\s+example-skill-agent",
        "find\\s+[^\\n]*\\s-name\\s+example-skill-agent",
        "Search\\s+example-skill-agent"
      ]
    });

    assert.deepEqual(violations, [
      "runner-pane: Ran which example-skill-agent || find /tmp/loop-station-fixtures -name example-skill-agent",
      "runner-pane: Search example-skill-agent"
    ]);
  });

  it("reports invalid configured forbidden patterns without throwing", () => {
    const text = "• Ran npm test";

    const violations = detectRunnerBypassViolations(text, "runner-pane", {
      forbiddenPatterns: ["form\\\\.submit\\\\s*\\\\("]
    });

    assert.deepEqual(violations, [
      "runner-pane: invalid forbidden pattern form\\\\.submit\\\\s*\\\\(: Invalid regular expression: /form\\\\.submit\\\\s*\\\\(/: Unterminated group"
    ]);
  });

  it("does not flag policy text that only names forbidden words", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "DONE", verification: { pass: true } });
    writeFileSync(join(attemptDir, "runner-report.md"), "Policy reminder: do not use curl scraping or bundle/runtime unless a public skill entry explicitly allows it.\n");

    const result = inspectRunnerAttempt(attemptDir, {
      forbiddenPatterns: [
        "\\bcurl\\b",
        "bundle/runtime"
      ]
    });

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
  });

  it("allows public runtime calls discovered from skill profiles", () => {
    const text = "• Ran node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs prepare --run-id case-1 --snapshot-dom";

    const violations = detectRunnerBypassViolations(text, "runner-pane", {
      forbiddenPatterns: ["bundle/runtime"],
      allowedPublicRuntimeCalls: [".codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs"]
    });

    assert.deepEqual(violations, []);
  });

  it("still detects direct spreadsheet library bypasses in execution evidence", () => {
    const text = "• Ran node ./write-workbook-with-openxml.mjs";

    const violations = detectRunnerBypassViolations(text, "runner-pane", {
      forbiddenPatterns: ["openxml"]
    });

    assert.deepEqual(violations, ["runner-pane: Ran node ./write-workbook-with-openxml.mjs"]);
  });

  it("detects alternate direct execution bypasses in live pane transcripts", () => {
    const text = `• Explored
  └ Read SKILL.md (custom-provider binary)
• Called
  └ node_repl.js({"title":"Check provider runtime"})
• Added runs/attempt-1/build-settlement.mjs
     2 +import { FileBlob, ProviderRuntime } from "provider-launcher";`;

    const violations = detectRunnerBypassViolations(text, "runner-pane", {
      forbiddenPatterns: [
        "custom-provider binary",
        "provider-launcher",
        "ProviderRuntime"
      ]
    });

    assert.deepEqual(violations, [
      "runner-pane: node_repl.js",
      "runner-pane: provider-launcher",
      "runner-pane: ProviderRuntime"
    ]);
  });

  it("falls back to runner metadata when output manifest omits status", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { files: [{ path: "output.txt" }] }, { status: "DONE", verification_pass: true });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
    assert.equal(result.reason, "runner_attempt_passed");
  });

  it("treats blocked attempts as completed failures", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "blocked" }, { terminal_state: "ORCHESTRATOR_FAILED" });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "runner_attempt_failed");
  });

  it("treats ambiguous attempts as completed failures", () => {
    const attemptDir = makeAttemptDir();
    writeRequiredArtifacts(attemptDir, { status: "AMBIGUOUS" }, { state: "blocked" });

    const result = inspectRunnerAttempt(attemptDir);

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "runner_attempt_failed");
  });

  it("rejects runner artifacts without required provenance when dispatch requires it", () => {
    const attemptDir = makeAttemptDir();
    writeDispatch(attemptDir, {
      targetSkills: [{ name: "$example-skill", slug: "example-skill" }],
      stageContracts: [
        {
          id: "run-example",
          skill: "$example-skill",
          phaseContracts: [{ id: "run", allowedActor: "runner_model" }]
        }
      ]
    });
    writeRequiredArtifacts(attemptDir, { status: "DONE", verdict: "pass", verification: { pass: true } });

    const result = inspectRunnerAttempt(attemptDir, { dispatchPath: join(attemptDir, "dispatch.json") });

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "missing_phase_provenance");
  });

  it("accepts object-shaped skill runtime evidence when provenance is otherwise complete", () => {
    const attemptDir = makeAttemptDir();
    writeDispatch(attemptDir, {
      targetSkills: [{ name: "$example-skill", slug: "example-skill" }],
      stageContracts: [
        {
          id: "run-example",
          skill: "$example-skill",
          phaseContracts: [{ id: "run", allowedActor: "runner_model" }]
        }
      ]
    });
    writeRequiredArtifacts(attemptDir, { status: "DONE", verdict: "pass", verification: { pass: true } }, {
      messageId: "msg-1",
      agentName: "Codex",
      phaseEvidence: ["parsed input"],
      skillRuntimeEvidence: { skill: "$example-skill", evidence: "public skill invocation" }
    });

    const result = inspectRunnerAttempt(attemptDir, { dispatchPath: join(attemptDir, "dispatch.json") });

    assert.equal(result.complete, true);
    assert.equal(result.passed, true);
    assert.equal(result.failed, false);
  });

  it("rejects action stages when required JSON artifacts violate the declared schema", () => {
    const stageDir = makeAttemptDir();
    writeDispatch(stageDir, {
      stageContracts: [
        {
          id: "summarize",
          skill: "$entity-summarizer",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "summary.json"]
        }
      ]
    });
    writeRequiredArtifacts(stageDir, { status: "DONE", verification: { pass: true } }, {
      messageId: "msg-1",
      agentName: "Runner2-Model",
      phaseEvidence: ["summary"],
      skillRuntimeEvidence: [{ skill: "$entity-summarizer" }],
      status: "passed"
    });
    writeFileSync(join(stageDir, "summary.json"), `${JSON.stringify({ entity_count: "three" }, null, 2)}\n`);

    const result = inspectActionStageAttempt(stageDir, {
      id: "summarize",
      skill: "$entity-summarizer",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "summary.json"],
      artifactSchemas: {
        "summary.json": {
          type: "object",
          required: ["entity_count"],
          properties: {
            entity_count: { type: "number" }
          }
        }
      }
    });

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "artifact_schema_violation");
  });

  it("rejects action stages when stage skill evidence is missing", () => {
    const stageDir = makeAttemptDir();
    writeDispatch(stageDir, {
      stageContracts: [
        {
          id: "extract",
          skill: "$entity-extractor",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"]
        }
      ]
    });
    writeRequiredArtifacts(stageDir, { status: "DONE", verification: { pass: true } }, {
      messageId: "msg-1",
      agentName: "Runner1-Model",
      phaseEvidence: ["extract"],
      skillRuntimeEvidence: [{ skill: "$other-skill" }],
      status: "passed"
    });
    writeFileSync(join(stageDir, "entities.json"), `${JSON.stringify({ entities: [{ id: "alpha" }] }, null, 2)}\n`);

    const result = inspectActionStageAttempt(stageDir, {
      id: "extract",
      skill: "$entity-extractor",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"],
      artifactSchemas: {
        "entities.json": {
          type: "object",
          required: ["entities"],
          properties: {
            entities: { type: "array", minItems: 1 }
          }
        }
      }
    });

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "missing_stage_skill_evidence");
  });

  it("rejects action stages when mailbox activation evidence is missing", () => {
    const stageDir = makeAttemptDir();
    writeDispatch(stageDir, {
      stageContracts: [
        {
          id: "extract",
          skill: "$entity-extractor",
          requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"]
        }
      ]
    });
    writeRequiredArtifacts(stageDir, { status: "DONE", verification: { pass: true } }, {
      messageId: "msg-1",
      agentName: "Runner1-Model",
      phaseEvidence: ["extract"],
      skillRuntimeEvidence: [{ skill: "$entity-extractor" }],
      status: "passed"
    });
    writeFileSync(join(stageDir, "entities.json"), `${JSON.stringify({ entities: [{ id: "alpha" }] }, null, 2)}\n`);

    const result = inspectActionStageAttempt(stageDir, {
      id: "extract",
      skill: "$entity-extractor",
      requiredArtifacts: ["runner-report.md", "runner-metadata.json", "output-manifest.json", "entities.json"],
      artifactSchemas: {
        "entities.json": {
          type: "object",
          required: ["entities"],
          properties: {
            entities: { type: "array", minItems: 1 }
          }
        }
      }
    });

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "missing_mailbox_activation_evidence");
  });

  it("rejects manual browser-flow capture replaced by a synthesized search URL", () => {
    const attemptDir = makeAttemptDir();
    const browserRun = join(attemptDir, "browser-flow-run");
    mkdirSync(join(browserRun, "analysis"), { recursive: true });
    writeFileSync(join(browserRun, "analysis", "workflow.json"), `${JSON.stringify({
      fixture: "manual",
      startUrl: "https://www.coupang.com/np/search?q=%EC%A0%9C%EB%A1%9C%20%EC%9D%8C%EB%A3%8C",
      finalUrl: "https://www.coupang.com/np/search?q=%EC%A0%9C%EB%A1%9C%20%EC%9D%8C%EB%A3%8C",
      steps: [
        {
          action: "goto",
          url: "https://www.coupang.com/np/search?q=%EC%A0%9C%EB%A1%9C%20%EC%9D%8C%EB%A3%8C"
        }
      ]
    }, null, 2)}\n`);
    writeDispatch(attemptDir, {
      targetSkills: [{ name: "$browser-flow", slug: "browser-flow" }],
      stageContracts: [
        {
          id: "capture-coupang",
          skill: "$browser-flow",
          input: "Open Coupang main page, type `제로 음료` into the search box, and submit the search.",
          phaseContracts: [
            {
              id: "capture",
              allowedActor: "human_user",
              captureMode: "human_manual",
              checkpoint: "awaiting_capture",
              mayAdvanceWhen: "human_capture_completed"
            }
          ],
          humanCheckpoints: [
            {
              id: "awaiting_capture",
              requiredActor: "human_user",
              completionSignal: "capture_done"
            }
          ]
        }
      ]
    });
    writeRequiredArtifacts(
      attemptDir,
      {
        status: "DONE",
        verdict: "pass",
        verification: { pass: true },
        outputs: [{ kind: "browser-flow-run", path: browserRun }]
      },
      {
        status: "DONE",
        messageId: "message-1",
        agentName: "RunnerAgent-Model",
        phaseEvidence: [{ id: "capture", status: "done" }],
        skillRuntimeEvidence: [{ skill: "$browser-flow", path: browserRun }]
      }
    );

    const result = inspectRunnerAttempt(attemptDir, { dispatchPath: join(attemptDir, "dispatch.json") });

    assert.equal(result.complete, true);
    assert.equal(result.passed, false);
    assert.equal(result.failed, true);
    assert.equal(result.reason, "layer_authority_violation");
    assert.deepEqual(result.layerAuthorityViolations, [
      "manual capture requires human_checkpoint_evidence before advancing capture",
      "manual browser-flow capture was replaced by direct goto URL"
    ]);
  });

  it("detects files created in the case folder after dispatch", () => {
    const caseDir = mkdtempSync(join(tmpdir(), "loop-station-case-"));
    writeFileSync(join(caseDir, "prompt.md"), "make an output file\n");
    writeFileSync(join(caseDir, "input.txt"), "fake input bytes\n");
    const snapshot = snapshotCaseFolder(caseDir);

    writeFileSync(join(caseDir, "prompt-resolved.md"), "derived prompt\n");
    writeFileSync(join(caseDir, "use-envelope.json"), "{}\n");

    const changes = detectCaseFolderChanges(caseDir, snapshot);

    assert.deepEqual(changes, [
      "case folder file created: prompt-resolved.md",
      "case folder file created: use-envelope.json"
    ]);
  });

  it("detects changed and deleted case input files after dispatch", () => {
    const caseDir = mkdtempSync(join(tmpdir(), "loop-station-case-"));
    writeFileSync(join(caseDir, "prompt.md"), "original prompt\n");
    writeFileSync(join(caseDir, "input.txt"), "original input\n");
    const snapshot = snapshotCaseFolder(caseDir);

    writeFileSync(join(caseDir, "prompt.md"), "changed prompt\n");
    rmSync(join(caseDir, "input.txt"));

    const changes = detectCaseFolderChanges(caseDir, snapshot);

    assert.deepEqual(changes, [
      "case folder file changed: prompt.md",
      "case folder file deleted: input.txt"
    ]);
  });
});

function makeAttemptDir() {
  const dir = mkdtempSync(join(tmpdir(), "loop-station-attempt-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRequiredArtifacts(attemptDir, manifest, metadata = {}) {
  writeFileSync(join(attemptDir, "runner-report.md"), "report\n");
  writeFileSync(join(attemptDir, "runner-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(attemptDir, "output-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeDispatch(attemptDir, body) {
  writeFileSync(join(attemptDir, "dispatch.json"), `${JSON.stringify({
    id: "message-1",
    to: "RunnerAgent-Model",
    type: "RUN_SKILL_CASE",
    body
  }, null, 2)}\n`);
}
