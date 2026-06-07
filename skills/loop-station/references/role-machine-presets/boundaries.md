# Role Machine Boundaries

## Evidence Identity And Freshness

Evidence is authoritative only when it belongs to the active dispatch. Presets must preserve this rule even before a concrete runtime schema exists.

The orchestrator tracks active run, case, stage, attempt, and message. It gives each model role the expected mailbox request, started, and reply paths. It rejects advancement when evidence is missing, stale, or attached to the wrong dispatch.

The runner writes provenance in runner-owned artifacts, includes message/agent/phase/skill evidence when required, and records human checkpoint evidence before claiming completion of human-owned phases.

Judgment reads only the latest authoritative artifacts for the active dispatch. It treats mismatched run, case, stage, attempt, message, or agent identity as fail or blocked evidence. Stdout summaries, pane text, and older journal entries are diagnostic context, not final proof.

## Boundary Matrix

| Responsibility | Orchestrator | Runner | Judgment |
| --- | --- | --- | --- |
| Choose next role | Owns | Forbidden | Recommends only |
| Execute assigned case or stage | Forbidden | Owns | Forbidden |
| Produce runner artifacts | Forbidden | Owns | Forbidden |
| Evaluate pass/fail evidence | Gates on verdict | Self-check only | Owns |
| Advance station state | Owns | Forbidden | Forbidden |
| Repair provider source | Forbidden | Forbidden | Forbidden |
| Pause for human checkpoint | Owns transition | Stops and records evidence | Verifies evidence |
| Validate activation evidence | Owns gate | Writes started/reply artifacts | Checks when relevant |
| Validate artifact freshness | Owns gate | Provides provenance | Owns verdict input check |
| Recommend provider handoff | Decides handoff | Reports blocker/failure evidence | Recommends from verdict |
| Use pane transcript | Diagnostic only | Diagnostic only | Diagnostic only |

## Setup Recommendation Signals

Setup should recommend role-machine presets from intent and contract evidence, not domain labels alone. Useful signals include work unit shape, evidence strictness, transition style, mutation boundary, failure path, and comparison need.

Recommendation output should be a per-role bundle with selected preset, alternates, confidence, and a natural-language reason. Domain overlays may be suggested only after role presets are selected.

## Preset Authoring Principles

- Preserve role authority before adding specialization.
- Keep shared traits small, stable, and role-defining.
- Put domain behavior in specialization or later domain overlays.
- Materialize selected built-in presets into `.loop-station` before station-local editing.
- Keep final station config explainable from selected role presets and local materialized copies.
