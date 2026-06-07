# Preset Catalog

## Purpose

The built-in preset catalog is the canonical source for role-machine shared traits, role specializations, scoring metadata, and recommendation inputs. It gives setup a stable set of role candidates to recommend, but it does not directly mutate runtime state.

This document defines catalog structure and evaluation criteria. The built-in shared trait packs and first role preset files follow this structure. Catalog loading, setup recommendation code, and materialization are follow-on implementation steps.

## Catalog Layers

The catalog has four conceptual layers:

```text
shared trait packs -> role preset entries -> optional domain overlays -> materialized station copies
```

Built-in catalog files live under the canonical Loop Station skill source. Selected presets are copied into `.loop-station` during setup. Station-local edits belong in the materialized preset copy so the final role definition has one local source of truth.

## Proposed Source Layout

```text
skills/loop-station/presets/
  shared/
    orchestrator.json
    runner.json
    judgment.json
  roles/
    orchestrator/
      strict-sequential.json
      human-gated.json
      multi-stage.json
    runner/
      artifact-producing.json
      stage-bound-action.json
      human-checkpoint.json
    judgment/
      artifact-contract.json
      process-evidence.json
      comparative.json
  overlays/
    README.md
```

The first catalog release should include only the three core roles and nine role presets listed above. Provider, installer, deploy verifier, observer, and domain overlays are follow-on catalog expansions.

## Shared Trait Pack Shape

Shared trait packs define the role boundary every preset in the role family must inherit.

```json
{
  "id": "runner.shared",
  "role": "runner",
  "level": 3,
  "purpose": "Execute one assigned case, stage, or task and produce required artifacts.",
  "authority": ["execute_assigned_task", "write_runner_artifacts"],
  "forbiddenResponsibilities": ["final_judgment", "provider_repair", "station_advance"],
  "requiredEvidence": ["messageId", "agentName", "phaseEvidence", "skillRuntimeEvidence"],
  "lifecycleDefaults": ["attempt-scoped", "stage-scoped"],
  "selfReviewChecklist": []
}
```

Shared trait packs should be small and stable. They are not a place for domain behavior.

## Role Preset Entry Shape

Role preset entries specialize a shared trait pack.

```json
{
  "id": "runner.stage-bound-action",
  "role": "runner",
  "title": "Stage-Bound Action Runner",
  "inherits": "runner.shared",
  "level": 3,
  "specialization": "stage-bound-action",
  "signals": {
    "workUnitShape": ["ordered-stage"],
    "runtimeBoundary": ["public-skill-only", "allowed-runtime-call"],
    "mutationBoundary": ["consumer-output", "no-mutation"]
  },
  "authority": {
    "adds": ["execute_one_stage"],
    "forbids": ["continue_unassigned_stage"]
  },
  "artifacts": {
    "required": ["runner-report.md", "runner-metadata.json", "output-manifest.json"],
    "provenanceRequired": true
  },
  "recommendation": {
    "defaultConfidence": "medium",
    "preferredWhen": ["stageContracts.length > 0"],
    "avoidWhen": ["workUnitShape == human-checkpoint"]
  },
  "compatibility": {
    "requiresOrchestratorCapabilities": ["stage_gate", "single_active_stage"],
    "compatibleJudgmentCapabilities": ["artifact_contract", "process_evidence"]
  },
  "promptReference": "roles/runner/stage-bound-action.md",
  "selfReviewChecklist": []
}
```

Catalog entries should remain descriptive. Runtime config generation is a later compilation step.

## Level Model

Every shared trait pack and role preset should carry a `level` from 1 to 5. The level is a maturity and safety rating, not a recommendation score.

| Level | Meaning | Minimum Bar |
| --- | --- | --- |
| 1 | Sketch | Names purpose and role only. Not recommendable. |
| 2 | Draft | Defines authority and forbidden responsibilities. Recommendable only with warning. |
| 3 | Usable | Defines signals, artifacts, compatibility, and self-review. Default minimum for built-in recommendations. |
| 4 | Hardened | Has validation coverage, materialization expectations, and known failure handling. |
| 5 | Proven | Has repeated run evidence, regression coverage, and documented promotion history. |

Initial built-in presets should target Level 3. Setup should not recommend Level 1 presets. Level 2 presets may appear as alternates only when no Level 3 option exists.

## Scoring Model

Recommendation scoring should be explicit and inspectable. A candidate score is a 0-100 value derived from setup signals and compatibility checks.

Suggested weights:

| Dimension | Weight | Evidence |
| --- | ---: | --- |
| Signal match | 35 | Preset signals match normalized setup signals. |
| Authority fit | 20 | Preset respects mutation, checkpoint, and role boundaries. |
| Evidence fit | 20 | Preset can produce or evaluate required artifacts and provenance. |
| Compatibility | 15 | Preset works with selected role peers and loop profile. |
| Maturity level | 10 | Preset `level` is high enough for recommendation. |

Confidence maps from score:

- `high`: 80-100
- `medium`: 60-79
- `low`: 40-59
- `notRecommended`: below 40

Hard authority violations override score and remove the candidate from recommendation. Examples include runner final judgment, judgment performing missing runner work, or orchestrator fabricating model artifacts.

## Recommendation Tie-Breaks

When scores are close, setup should prefer:

1. Higher authority fit.
2. Higher evidence fit.
3. Higher level.
4. Lower complexity.
5. Existing loop profile compatibility.

A candidate within 5 points of the selected preset should be shown as a meaningful alternate.

## Catalog Helper Module

The built-in helper at `skills/loop-station/presets/catalog.js` loads the shared trait packs and role presets, scores each candidate, and returns per-role recommendation bundles.

The scorer uses the scoring weights above:

- `signalMatch`: matches setup signals against preset signal axes.
- `authorityFit`: starts from the shared role authority bar and applies non-blocking penalties.
- `evidenceFit`: checks required artifacts and provenance expectations.
- `compatibility`: checks required or compatible peer capabilities.
- `maturityLevel`: maps the preset level into the 0-10 maturity dimension.

Hard rejects produce `score: 0`, `confidence: notRecommended`, and a rejection reason. Current hard rejects include shared forbidden responsibility conflicts, blocked preset ids, and blocked responsibilities supplied by setup.

The scorer is intentionally a catalog helper. It does not mutate runtime config or make setup UX decisions by itself.

The same helper can materialize accepted role decisions into station-local explanatory files. `materializePresetRecommendation` writes `presets/recommendation.json` and `presets/roles/<role>.json` under the supplied `.loop-station` root. It does not write `station.json`.

## Materialized Copy Shape

During setup, the accepted recommendation should materialize resolved presets under `.loop-station`:

```json
{
  "sourcePresetId": "runner.stage-bound-action",
  "role": "runner",
  "level": 3,
  "resolvedSharedTraits": {},
  "resolvedSpecialization": {},
  "selectedBecause": {
    "score": 84,
    "confidence": "high",
    "signals": ["ordered-stage", "schema-validated", "public-skill-only"]
  },
  "stationLocalEditing": {
    "editableAfterSetup": true
  },
  "selfReview": {
    "completedAtSetup": true,
    "findings": []
  }
}
```

Materialized copies are explanatory station-local state. `station.json` remains the executable runtime configuration. Built-in catalog files remain canonical. Station-local changes should edit the materialized role preset copy directly after setup.

## Station-Local Editing Policy

Station-local edits should be reviewed before the station is rerun:

- Usually safe: wording, display title, prompt reference, and additional non-conflicting evidence requirements.
- Needs review: timeout hints, artifact additions, signal tuning, and compatibility notes.
- Should be rejected: removing shared forbidden responsibilities, granting final judgment to runner, allowing private provider shortcuts, skipping required provenance, or disabling human checkpoint evidence.

The setup flow should not maintain a separate override file because that creates two competing descriptions of the same role. The materialized role preset is the editable local copy.

## Catalog Self-Review Gate

Each new catalog entry should pass a self-review before it becomes recommendable:

- Level is at least 3.
- Shared trait inheritance is declared.
- Authority additions do not conflict with shared forbidden responsibilities.
- Required evidence is enough for the intended recommendation signals.
- Compatibility fields name required peer capabilities.
- Scoring signals are specific enough to distinguish this preset from alternates.
- Materialized copy remains explainable without reading built-in catalog files.

## Follow-On Work

After this catalog structure is accepted:

- Keep shared trait packs for orchestrator, runner, and judgment aligned with this document.
- Keep the first nine Level 3 role presets aligned with this document.
- Integrate the recommendation scorer into setup reporting.
- Integrate materialization into setup after user review.
- Add validation tests for setup wiring and document synchronization.
