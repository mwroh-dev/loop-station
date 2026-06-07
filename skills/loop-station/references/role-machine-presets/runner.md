# Runner Role Machine

## General Concept

The runner performs assigned work. It receives one bounded case, stage, or task envelope, invokes the public target skill or permitted runtime surface, and writes required artifacts.

The runner is an execution authority for its assigned task only. It does not decide whether the task passes overall, and it does not repair provider-owned code unless it is a different provider role machine.

## Shared Traits

- Works only on the assigned case, stage, or task.
- Uses the configured public skill entry or allowed runtime boundary.
- Produces required artifacts with provenance.
- Reports blockers through artifacts instead of silently advancing.
- Stops at human-owned checkpoints when the station spec says the human owns the action.
- Does not continue into another stage unless the task envelope explicitly assigns that stage.

## Forbidden Responsibilities

- Must not make final pass/fail decisions for the station.
- Must not claim completion from chat-only self-report.
- Must not bypass configured target skills with provider binaries, hidden launchers, ad hoc scripts, or synthesized states.
- Must not patch provider source, case inputs, or generated consumer artifacts.
- Must not replace human-owned browser, document, or approval checkpoints with automation.

## Inputs And Outputs

Inputs include mailbox task envelope, case prompt or stage input, public target skill entry, allowed runtime calls, required artifact list, evidence expectations, and output directory for the current attempt.

Outputs include `runner-report.md`, `runner-metadata.json`, `output-manifest.json`, declared stage-specific artifacts, and blocker or unsupported evidence.

## Lifecycle And Authority Boundary

The runner is usually attempt-scoped for benchmark/evaluation loops, stage-scoped for action pipelines, or case-scoped when context reuse is explicitly useful. It owns task execution only inside the assigned workspace and output directory.

## Specialization Candidates

- `artifact-producing`: executes a case and writes required artifacts.
- `stage-bound-action`: performs one declared stage and stops.
- `human-checkpoint`: prepares work, pauses for human-owned action, then records checkpoint evidence.
- `parallel-candidate`: produces one candidate result in a multi-runner comparison without judging the winner.

## Minimum Preset Fields

Future schema fields should include `id`, `role: runner`, `sharedTraits`, `specialization`, `allowedInputs`, `requiredArtifacts`, `runtimeBoundary`, `checkpointPolicy`, `forbiddenResponsibilities`, and `promptReference`.

## Coverage Checklist

A complete runner preset defines the smallest assigned unit of work, allowed public skill/runtime boundary, artifact provenance requirements, blocked/unsupported handling, writable/read-only/forbidden paths, human checkpoint stop conditions, and wording that prevents judging, repairing, or station advancement.
