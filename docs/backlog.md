# Backlog

## Purpose

This backlog records deferred Loop Station preset work that should not be mixed into the current role-machine foundation. These items are intentional follow-on layers, not missing pieces required for the current `Orchestrator`, `Runner`, and `Judgment` preset base.

The current foundation should stay focused on:

- role shared traits;
- role specializations;
- role-by-role setup recommendation decisions;
- station-local materialized preset copies;
- setup-time scoring and decision records.

## Decision Rules

Move a backlog item into active implementation only when it improves the requested final state without weakening the current role-machine boundary.

Do not pull backlog work forward merely because a specific domain example is available. Domain-specific behavior should wait until the role preset layer is stable enough to receive overlays without changing the role definitions.

## Priority 1: Interactive Setup UX Hardening

Status: backlog.

Current state:

- `loop-station setup` can recommend and materialize role presets.
- Interactive setup asks role preset questions in this order: `Orchestrator`, then `Runner`, then `Judgment`.
- Non-interactive setup can provide explicit `presetSelections.roles`.
- Recommendation files record role decisions, alternates, scores, confidence, and natural-language reasons.

Why deferred:

The core decision flow exists, but the interaction design can be improved without changing the preset foundation. This should be a UX hardening pass, not a schema redesign.

Next work:

- Present each role decision with clearer option labels.
- Support a richer `request_user_input` path when available.
- Keep a plain-text fallback for terminal setup.
- Show the natural-language reason before asking for the role decision.
- Keep role decisions sequential rather than asking for one global bundle acceptance.

Acceptance criteria:

- Setup asks role preset decisions in role order.
- The recommended option is clearly marked.
- The user can select an alternate by number or preset id.
- The final recommendation record shows whether each role used the recommended default or an explicit user selection.

## Priority 2: Compatibility Risk Reporting

Status: backlog.

Current state:

- Scoring includes a compatibility dimension.
- Presets declare peer compatibility hints.
- Setup does not yet produce a dedicated human-readable compatibility risk report.

Why deferred:

Compatibility risk should inform the user, not silently force a different preset. A risk model that is too aggressive would fight the reason presets are editable station-local copies.

Next work:

- Add a warning report after role selections are made.
- Explain risks in natural language.
- Keep warnings separate from hard authority failures.
- Avoid preventing user-selected combinations unless they violate core role authority.

Acceptance criteria:

- Risk warnings name the affected role pair.
- Warnings explain why the combination may stall, under-verify, or over-constrain the station.
- Warnings do not override explicit user choices.
- Hard failures remain limited to role authority violations.

## Priority 3: Domain Overlays

Status: backlog.

Current state:

- Domain overlay is defined conceptually.
- No browser, document, spreadsheet, CI, or data-extraction overlay is implemented.

Why deferred:

Domain overlays sit above role specialization. Implementing them now would mix domain behavior into the role-machine foundation before the base role definitions have stabilized.

Next work:

- Define overlay file shape.
- Add overlay recommendation signals.
- Start with a small domain overlay set only after role preset setup UX is stable.
- Keep overlays additive: they may add domain evidence and safety constraints, but must not change core role authority.

Acceptance criteria:

- Overlays compose after role specialization.
- Built-in overlays can be materialized into station-local preset copies.
- Domain overlays cannot grant forbidden responsibilities.
- The final station remains explainable from shared traits, specialization, overlay, and local materialized copy.

## Priority 4: Future Role Machines

Status: backlog.

Current state:

The initial core preset catalog covers only:

- `Orchestrator`
- `Runner`
- `Judgment`

Why deferred:

Provider repair, installation, deploy verification, and observation are important, but they are different role machines. Adding them before the core three are stable would widen the catalog faster than the setup decision process can explain.

Next work:

- Define `ProviderEngineer` role machine.
- Define `Installer` role machine.
- Define `DeployVerifier` role machine.
- Define `Observer` role machine.
- Add shared traits before adding specializations.

Acceptance criteria:

- Each new role has shared traits, forbidden responsibilities, input/output contracts, lifecycle, authority boundary, and minimum preset fields.
- New role presets can be recommended independently.
- Recovery and installation flows can name dependencies on these roles without overloading `Runner` or `Judgment`.

## Priority 5: Scoring Calibration

Status: backlog.

Current state:

- Scoring uses a deterministic 0-100 model.
- Tests cover representative human checkpoint, ordered stage, comparative judgment, hard reject, alternate, materialization, and setup integration cases.

Why deferred:

The scoring model is functional enough for initial setup decisions, but not yet proven by repeated real station runs.

Next work:

- Track real setup selections and later user edits.
- Compare selected presets against successful and failed runs.
- Calibrate weights only when there is evidence.
- Improve natural-language score explanations.

Acceptance criteria:

- Weight changes are backed by examples or test fixtures.
- Score explanations identify why the selected preset beat alternates.
- Score changes do not reduce role authority safety.

## Current Non-Goals

These are intentionally out of scope for the current foundation:

- domain-specific preset implementation;
- automatic provider repair role expansion;
- forcing preset combinations based on compatibility warnings;
- maintaining separate station-local override files;
- editing built-in catalog files from consumer setup.
