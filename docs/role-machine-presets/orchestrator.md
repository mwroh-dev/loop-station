# Orchestrator Role Machine

## General Concept

The orchestrator owns the conveyor belt. It decides which role machine receives the next task, when a stage may advance, when a case must stop, and when failure evidence should be handed to another role.

The orchestrator is a state-transition authority. It is not the worker that performs the assigned task, and it is not the judge that decides whether runner output is acceptable.

## Shared Traits

- Maintains exactly which case, stage, attempt, and message are active.
- Dispatches bounded task envelopes to the next role machine.
- Gates progress on required artifacts, activation evidence, verifier output, and judgment verdicts.
- Applies retry, rerun, pause, and handoff policy.
- Records why each transition happened.
- Treats pane text as diagnostic evidence, not completion evidence.

## Forbidden Responsibilities

- Must not perform runner task work.
- Must not fabricate runner, judgment, provider, or verifier artifacts.
- Must not treat runner self-report as final pass/fail judgment.
- Must not patch provider source, case inputs, or consumer-generated artifacts.
- Must not expose raw internal station control JSON to model panes unless debug behavior explicitly requires it.

## Inputs And Outputs

Inputs include station configuration, case manifest, stage contracts, mailbox activation/reply files, required artifacts, verifier results, pane health, and timeout evidence.

Outputs include dispatch requests, state transitions, station events, Loop Station-owned failure artifacts, provider handoff, rerun, pause, or terminal decisions.

## Lifecycle And Authority Boundary

The orchestrator is run-scoped. It can stop, pause, rerun, or advance the station only from evidence produced by the correct role machine or deterministic verifier.

## Specialization Candidates

- `strict-sequential`: one case or stage active at a time; no advance before judgment passes.
- `recovery`: failure goes to provider repair, install/deploy verification, then rerun. This depends on future provider-side role machines.
- `human-gated`: pauses at human-owned checkpoints and requires checkpoint evidence before continuing.
- `multi-stage`: dispatches ordered stage contracts and prevents a runner from continuing into later stages.

## Minimum Preset Fields

Future schema fields should include `id`, `role: orchestrator`, `sharedTraits`, `specialization`, `transitionPolicy`, `dispatchPolicy`, `completionGates`, `failurePolicy`, `forbiddenResponsibilities`, and `promptReference`.

## Coverage Checklist

A complete orchestrator preset defines evidence that opens and closes active task slots, the role that owns each transition gate, behavior for missing activation/stale artifacts/verifier failure/judgment failure, failure routing, model-visible envelope boundaries, and the split between deterministic station behavior and prompt-facing guidance.
