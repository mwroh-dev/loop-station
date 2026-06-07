# Preset Catalog Authoring

## Source Of Truth

Preset authors edit `skills/loop-station/presets/definitions.js`. They do not hand-edit generated JSON or generated prompt files. Run `npm run generate:presets` after source changes.

Generated artifacts remain in the repository because they are the runtime packaging surface. Tests compare generated artifacts to source definitions so drift is caught before publishing.

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
