# Preset Catalog Source Layout

## Source Layout

```text
skills/loop-station/presets/
  definitions.js
  generate.js
  catalog.js
  prompts/
    PRESET_PROMPT_TEMPLATE.md
    roles/**/*.md
  shared/
    orchestrator.json
    runner.json
    judgment.json
  roles/
    orchestrator/*.json
    runner/*.json
    judgment/*.json
```

`definitions.js` is the source of truth for catalog metadata, recommendation signals, compatibility metadata, and generated JSON artifacts. `generate.js` produces only the JSON artifacts that setup consumes and packages. The generated JSON files stay committed so installed skills can read plain catalog artifacts without evaluating extra generation steps.

Prompt markdown is not generated from JavaScript. The files under `prompts/roles/**/*.md` are authored model-facing guidance referenced by `promptReference`. Use `prompts/PRESET_PROMPT_TEMPLATE.md` when adding or revising a preset prompt.

## Shared Trait Pack Shape

Shared trait packs define the role boundary every preset in the role family must inherit. Required fields include `id`, `role`, `roleFamily`, `title`, `level`, `autonomyLevel`, `autonomyEvidence`, `autonomyLimits`, `purpose`, `authority`, `forbiddenResponsibilities`, `requiredEvidence`, `lifecycleDefaults`, `recommendationSignals`, `scoringHints`, and `selfReviewChecklist`.

## Role Preset Entry Shape

Role preset entries specialize a shared trait pack. Required fields include `id`, `role`, `roleFamily`, `title`, `inherits`, `level`, `autonomyLevel`, `autonomyEvidence`, `autonomyLimits`, `specialization`, `purpose`, `signals`, `authority`, `artifacts`, `recommendation`, `compatibility`, `promptReference`, and `selfReviewChecklist`.

## Level Model

Levels are maturity and safety ratings, not recommendation scores. Level 1 is sketch, Level 2 is draft, Level 3 is usable, Level 4 is hardened, and Level 5 is proven. Initial built-in presets target Level 3. Setup should not recommend Level 1 presets; Level 2 should appear only as a warning alternate when no Level 3 option exists.

`autonomyLevel` is separate from `level`. It describes how much independent role-local judgment the preset may apply: higher values require stronger `autonomyEvidence` and stricter `autonomyLimits`. Recommendation output should explain both values when presenting a preset.
