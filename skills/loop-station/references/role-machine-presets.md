# Role Machine Presets

## Purpose

Role machine presets define the conveyor-belt machines that Loop Station can recommend during setup. The core role set is `Orchestrator`, `Runner`, and `Judgment`.

This entry file is intentionally small. Use the focused references below when implementing catalog entries, setup recommendations, or station-local materialization.

## Focused References

- `role-machine-presets/concepts.md`: shared vocabulary, composition order, machine/model distinction, and external references.
- `role-machine-presets/orchestrator.md`: orchestration authority, forbidden responsibilities, lifecycle, and specialization candidates.
- `role-machine-presets/runner.md`: runner execution boundary, artifacts, checkpoint handling, and specialization candidates.
- `role-machine-presets/judgment.md`: judgment authority, verdict artifacts, freshness checks, and specialization candidates.
- `role-machine-presets/boundaries.md`: evidence identity, boundary matrix, setup signals, and preset authoring principles.

## Contract Summary

A role machine is a repeatable agent slot with typed inputs, expected outputs, lifecycle, and an authority boundary. A shared trait defines what every preset in the same role family must keep. A specialization narrows the role for a particular work shape without changing core authority. An agent preset combines shared traits, specialization, prompt guidance, required artifacts, and safety boundaries.

Built-in presets are canonical catalog entries. During setup, the accepted role preset is materialized into `.loop-station` as the station-local editable copy. Domain overlays are later layers above role specialization; they do not replace role definitions.
