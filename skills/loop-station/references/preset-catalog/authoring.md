# Preset Catalog Authoring

## Source Of Truth

Preset authors edit `skills/loop-station/presets/definitions.js` for catalog metadata and generated JSON. They edit `skills/loop-station/presets/prompts/roles/**/*.md` for model-facing role guidance. Run `npm run generate:presets` after metadata source changes.

Generated JSON artifacts remain in the repository because they are the runtime packaging surface. Tests compare generated JSON to source definitions so drift is caught before publishing. Prompt validation stays shallow: each preset must reference an existing markdown prompt, but tests do not assert detailed heading text or role logic.

## Prompt Template

Use `skills/loop-station/presets/prompts/PRESET_PROMPT_TEMPLATE.md` when creating or revising prompt guidance. The template is a checklist for the authoring model or human author, not a JavaScript schema.

## Catalog Self-Review Gate

Each new catalog entry should pass this gate before it becomes recommendable:

- Level is at least 3.
- Shared trait inheritance is declared.
- Authority additions do not conflict with shared forbidden responsibilities.
- Required evidence is enough for intended recommendation signals.
- Compatibility fields name required peer capabilities.
- Scoring signals distinguish the preset from alternates.
- The materialized copy remains explainable without reading built-in catalog files.

## Follow-On Work

Future work includes domain overlays, compatibility risk reporting, future role machines, and scoring calibration. Those items belong in `backlog.md` until they become active implementation scope.
