# Role Machine Preset Concepts

## External Reference Model

Loop Station uses a deterministic station controller with model panes as bounded workers. The vocabulary follows OpenAI routines/handoffs, OpenAI Agents SDK orchestration, Microsoft orchestrator/subagent separation, and Temporal worker/task-queue boundaries. The common boundary is that orchestration, execution, and judgment are separate responsibilities even when model panes help with more than one phase.

## Core Terms

`Role Machine` is a conveyor-belt slot that performs one repeatable responsibility. It has a role name, input contract, output contract, lifecycle, authority boundary, and prompt guidance.

`Shared Trait` is a rule or behavior every preset in the same role family must keep. Shared traits define what makes a runner a runner or a judgment agent a judgment agent.

`Specialization` is a subtype within one role family. It adds task-specific behavior without changing the role's core authority.

`Agent Preset` is a reusable combination of shared traits, specialization traits, prompt guidance, required artifacts, and safety boundaries.

`Domain Overlay` adapts role presets to a domain or industry after role selection. It sits on top of role specialization.

## Composition

Role presets compose in this order:

```text
role shared traits -> role specialization -> optional domain overlay -> station-local materialized copy
```

Shared traits override specialization, domain overlays, and station-local edits. Specialization traits override domain overlays when they protect role boundaries. Domain overlays may add domain constraints but cannot change core authority. Station-local edits may tune wording, artifacts, and prompt details, but must not grant forbidden responsibilities.

## Machine vs Model Agent

The word `machine` describes a role slot and its contract. It does not always mean an LLM pane. `Orchestrator` presets describe deterministic orchestration behavior and prompt-facing envelopes produced by that behavior. `Runner` and `Judgment` presets primarily describe model-pane guidance and artifact contracts.

## Trait Inventory

Every role preset should answer the same contract questions: purpose, trigger, authority, evidence, outputs, failure handling, handoff rules, forbidden moves, and lifecycle. Role-specific minimum fields should map back to this inventory instead of defining a competing shape.
