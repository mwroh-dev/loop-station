# Preset Catalog Source Layout

## Generated Layout

```text
skills/loop-station/presets/
  definitions.js
  generate.js
  catalog.js
  shared/
    orchestrator.json
    runner.json
    judgment.json
  roles/
    orchestrator/*.json
    runner/*.json
    judgment/*.json
  prompts/roles/**/*.md
```

`definitions.js` is the source of truth. `generate.js` produces the JSON and prompt artifacts that setup consumes and packages. The generated files stay committed so installed skills can read plain catalog artifacts without evaluating extra generation steps.

## Shared Trait Pack Shape

Shared trait packs define the role boundary every preset in the role family must inherit. Required fields include `id`, `role`, `title`, `level`, `purpose`, `authority`, `forbiddenResponsibilities`, `requiredEvidence`, `lifecycleDefaults`, `recommendationSignals`, `scoringHints`, and `selfReviewChecklist`.

## Role Preset Entry Shape

Role preset entries specialize a shared trait pack. Required fields include `id`, `role`, `title`, `inherits`, `level`, `specialization`, `purpose`, `signals`, `authority`, `artifacts`, `recommendation`, `compatibility`, `promptReference`, and `selfReviewChecklist`.

## Level Model

Levels are maturity and safety ratings, not recommendation scores. Level 1 is sketch, Level 2 is draft, Level 3 is usable, Level 4 is hardened, and Level 5 is proven. Initial built-in presets target Level 3. Setup should not recommend Level 1 presets; Level 2 should appear only as a warning alternate when no Level 3 option exists.
