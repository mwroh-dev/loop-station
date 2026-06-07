# Preset Catalog

## Purpose

The built-in preset catalog is the canonical source for role-machine shared traits, role specializations, scoring metadata, and recommendation inputs. It gives setup a stable set of role candidates to recommend, but it does not directly mutate runtime state.

This entry file is intentionally small. Use the focused references below for implementation detail.

## Focused References

- `preset-catalog/source-layout.md`: generated source layout, shared trait shape, role preset shape, and level model.
- `preset-catalog/scoring.md`: recommendation scoring, confidence, tie-breaks, and hard rejects.
- `preset-catalog/materialization.md`: station-local materialized copy shape and editing policy.
- `preset-catalog/authoring.md`: generator/source-of-truth rules and self-review gate.

## Catalog Summary

Catalog layers compose as shared trait packs, role preset entries, optional domain overlays, and materialized station copies. Built-in source definitions live in `skills/loop-station/presets/definitions.js`. Generated JSON and prompt files live under `skills/loop-station/presets/shared`, `skills/loop-station/presets/roles`, and `skills/loop-station/presets/prompts`.

Selected presets are copied into `.loop-station` during setup. Station-local edits belong in the materialized preset copy so the final role definition has one local source of truth.
