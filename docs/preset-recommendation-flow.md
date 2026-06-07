# Preset Recommendation Flow

## Purpose

Loop Station setup should recommend role-machine presets before it generates the final station configuration. The recommendation flow turns user intent, target skill contracts, stage contracts, evidence requirements, and authority boundaries into candidate role preset bundles.

This document covers recommendation procedure and setup materialization expectations. The built-in preset catalog, initial preset files, scorer, and station-local materialization helper now follow this flow. Runtime behavior still comes from `station.json`.

## Inputs

The recommendation engine should read only setup-time facts and discovered public contracts:

- User intent captured during Install Mode.
- `loopType` and derived `loopProfile`.
- `targetSkillName` or `targetSkills`.
- `skillProfiles[]` from Skill Contract Discovery.
- `stageContracts[]` for action pipelines and multi-skill flows.
- Required artifacts, artifact schemas, verifier commands, and provenance requirements.
- Human checkpoints and allowed phase actors.
- Roots and mutation boundaries: station, consumer, provider, release, sandbox, case, and action roots.
- Failure policy hints: stop, retry, recycle pane, provider handoff, deploy verification, or human pause.

The recommendation engine must not inspect private provider internals to infer shortcuts. It should prefer public skill docs, declared stage contracts, and explicit user choices.

## Signal Extraction

Setup should convert inputs into normalized recommendation signals:

- `workUnitShape`: single-case, repeated-case, ordered-stage, parallel-candidate, or human-checkpoint.
- `evidenceStrictness`: artifacts-only, schema-validated, provenance-required, verifier-required, or human-evidence-required.
- `transitionStyle`: strict-sequential, recovery, human-gated, or multi-stage.
- `mutationBoundary`: station-only, consumer-output, provider-owned, no-mutation, or mixed.
- `failurePath`: stop, retry, recycle-pane, provider-handoff, deploy-verify, or human-pause.
- `comparisonNeed`: none, runner-candidates, challenge-review, or judge-panel.
- `runtimeBoundary`: public-skill-only, allowed-runtime-call, human-owned-runtime, or station-owned-runtime.

Signals are descriptive evidence for recommendation. They are not station config by themselves.

## Candidate Generation

Candidate generation happens per role first, then as a bundle.

Per-role generation:

- Orchestrator candidates are selected from transition style, failure path, activation policy, and checkpoint ownership.
- Runner candidates are selected from work unit shape, runtime boundary, mutation boundary, and required artifacts.
- Judgment candidates are selected from evidence strictness, comparison need, verifier use, and process-boundary risk.

Bundle generation:

- Combine one orchestrator, one runner, and one judgment candidate into a recommended bundle.
- Include alternates for each role rather than hiding them behind one global preset.
- Add a domain overlay only after role presets are selected.
- Mark dependencies on future role definitions, such as provider, installer, deploy verifier, or observer, instead of pretending the three core roles fully cover those flows.

## Recommendation Output

The output should be human-readable and machine-materializable. It should include a recommended bundle, role-level alternates, reasons, confidence, and unresolved decisions.

```yaml
recommendationId: rec-001
summary: Strict stage execution with artifact-based judgment.
recommended:
  orchestrator:
    preset: strict-sequential
    confidence: high
    reason: One active stage should advance only after activation, artifacts, verifier output, and judgment pass.
    alternates: [human-gated, multi-stage]
  runner:
    preset: stage-bound-action
    confidence: high
    reason: The work is an ordered stage and the runner must not continue into later stages.
    alternates: [artifact-producing, human-checkpoint]
  judgment:
    preset: artifact-contract
    confidence: high
    reason: Required artifacts, provenance, schemas, and verifier outputs are the main pass gate.
    alternates: [process-evidence, comparative]
domainOverlay: null
dependencies: []
unresolvedDecisions: []
```

For recovery flows, the output should keep the three core role recommendations but also list unresolved or dependent future machines:

```yaml
dependencies:
  - role: provider_engineer
    reason: Recovery handoff requires provider-owned repair response contracts.
  - role: deploy_verifier
    reason: Rerun should wait for deploy verification evidence.
```

## User Review Flow

Install Mode should present recommendations before generating `.loop-station/station.json`.

Recommended interaction:

1. Ask for the `Orchestrator` preset first, because it defines transition authority for every later role.
2. Ask for the `Runner` preset next, using the orchestrator choice and setup signals as context.
3. Ask for the `Judgment` preset last, using the selected execution shape and artifact expectations as context.
4. For each role, show the recommended preset, score, confidence, alternates, and a natural-language reason.
5. Record accepted role decisions and reasons in station-local files during materialization.

Plain-text fallback is acceptable when structured `request_user_input` is unavailable. The recommendation still needs the same content: selected role presets, alternates, reasons, confidence, dependencies, and unresolved decisions.

Reasons should explain the setup in natural language. Avoid bare signal listings such as "stageContracts exists." Prefer sentences such as: "Because this setup is an ordered stage pipeline with schema-validated runner artifacts, the orchestrator should use the multi-stage preset so each stage closes before the next stage is dispatched."

## Materialization Flow

Built-in preset catalog entries remain canonical. A selected recommendation becomes station-local state:

```text
.loop-station/
  presets/
    recommendation.json
    roles/
      orchestrator.json
      runner.json
      judgment.json
  station.json
```

Materialized role preset files may inline resolved shared traits and selected specialization details so the station remains explainable without modifying the built-in catalog. User changes after setup should edit these station-local materialized preset files, not the built-in preset catalog. This avoids a split-brain state where both a preset and a separate override describe the same role differently.

`station.json` remains the final runtime config. Recommendation and preset files explain how setup arrived at that config.

## Compatibility Checks

Before materialization, setup should check:

- The selected orchestrator can gate the selected runner's work unit shape.
- The selected judgment can evaluate the runner's required artifacts and evidence type.
- Human-gated runners have an orchestrator that can pause for human checkpoint evidence.
- Recovery orchestrators declare provider/deploy dependencies until those role machines are defined.
- Multi-stage runners are paired with orchestrator behavior that prevents unassigned stage continuation.
- Comparative judgment is paired with multiple runner candidates or explicitly rejected as unnecessary.

Warnings should be shown before generation. They should inform the user about combination risk without silently forcing a different choice. Hard failures should be reserved for combinations that violate role authority, such as a runner preset that performs final judgment.

## Follow-On Work

After this flow is accepted, the next steps are:

- Continue hardening setup review UX for interactive role-by-role preset decisions.
- Add richer compatibility warnings for future provider, installer, deploy verifier, and observer role-machine definitions.
- Add validation tests for new domain overlays when they are introduced.
