# Role Machine Presets

## Purpose

Loop Station role presets start with the machines on the conveyor belt, not with domain-specific automation recipes. The first preset vocabulary covers the three core role machines: `Orchestrator`, `Runner`, and `Judgment`.

A role machine is a repeatable agent slot in the Loop Station conveyor belt. It owns a bounded responsibility, receives typed inputs, writes expected outputs, and stays inside an authority boundary. A role machine can later be specialized for browser work, document work, CI repair, data extraction, or other domains, but the base role definition must remain domain-neutral.

This document is the conceptual contract for future preset catalogs, setup recommendations, and station-local preset materialization. It does not define a runtime JSON schema yet.

## External Reference Model

Loop Station uses a deterministic station controller with model panes as bounded workers. The role vocabulary follows these external patterns:

- OpenAI routines and handoffs define agents as instructions plus tools, with routines as step sets and handoffs as transfers to specialized agents: <https://developers.openai.com/cookbook/examples/orchestrating_agents>.
- OpenAI Agents SDK distinguishes manager-style orchestration, handoffs, and code-driven orchestration. Loop Station favors code-owned transitions with model-owned bounded work: <https://openai.github.io/openai-agents-python/multi_agent/>.
- Microsoft's orchestrator/subagent pattern separates high-level delegation from specialist execution: <https://learn.microsoft.com/en-us/agents/architecture/multi-agent-orchestrator-sub-agent>.
- Temporal workers model execution as workers polling task queues, executing tasks, and returning results while the service owns state transitions: <https://docs.temporal.io/workers>.

These references support the same boundary: orchestration, execution, and judgment are different responsibilities even when all three are implemented with LLM-backed panes.

## Core Terms

`Role Machine`

A conveyor-belt slot that performs one repeatable responsibility. It has a role name, input contract, output contract, lifecycle, authority boundary, and prompt guidance.

`Shared Trait`

A rule or behavior every preset in the same role family must keep. Shared traits define what makes a runner a runner, or a judgment agent a judgment agent, regardless of domain.

`Specialization`

A subtype within one role family. It adds task-specific behavior without changing the role's core authority. For example, a stage-bound runner and a human-checkpoint runner are both runners.

`Agent Preset`

A reusable combination of shared traits, specialization traits, prompt guidance, required artifacts, and safety boundaries. Built-in presets are canonical sources. Once selected during setup, they should be materialized into station-local `.loop-station` files that can be edited as the local role definition.

`Domain Overlay`

A later layer that adapts role presets to a domain or industry. Domain overlays are not part of the core role definition. They should sit on top of role specialization, not replace it.

## Preset Composition Model

Role presets compose in a fixed order:

```text
role shared traits -> role specialization -> optional domain overlay -> station-local materialized copy
```

Each layer may narrow behavior, add required evidence, or add forbidden shortcuts. Later layers must not remove authority boundaries from earlier layers. For example, a browser-domain runner overlay may add click/typing evidence rules, but it cannot let the runner make the final pass/fail verdict because that violates the runner shared traits.

Built-in presets are canonical catalog entries. During setup, a selected preset should be copied into `.loop-station` as a station-local preset instance. User edits belong to that station-local instance, not to the built-in catalog.

Built-in catalog entries should reference shared trait packs conceptually so common role definitions do not drift across presets. A materialized `.loop-station` preset instance may inline the resolved shared traits, specialization traits, and domain overlay so the final station remains explainable without reading the built-in catalog.

Conflict handling is strict:

- Shared traits override specialization, domain overlays, and station-local edits.
- Specialization traits override domain overlays when they protect the role boundary.
- Domain overlays may add domain constraints but cannot change the role's core authority.
- Station-local edits may tune wording, artifacts, timeouts, and selected specialization details, but must not grant forbidden responsibilities.

## Machine vs Model Agent

The word `machine` describes a role slot and its contract. It does not always mean an LLM pane.

In the current Loop Station runtime, `Orchestrator` and `StationControl` are deterministic code components. `Runner`, `Judgment`, `ProviderEngineer`, `DeployVerifier`, `Installer`, and `Observer` are model-pane roles. A role machine preset can therefore describe either:

- deterministic station behavior, such as orchestration gates and dispatch policy; or
- model guidance, such as prompt instructions, required artifacts, and forbidden actions.

For the core role-machine preset layer, `Orchestrator` presets describe deterministic orchestration behavior and prompt-facing envelopes produced by that behavior. They are not prompts for an `Orchestrator-Model` pane. `Runner` and `Judgment` presets primarily describe model-pane guidance and artifact contracts.

## Trait Inventory Format

Every role preset should be authorable from the same inventory shape. This keeps presets duck-typed: different specializations can behave differently, but they still answer the same contract questions.

The sections below are the conceptual inventory. The later role-specific "Minimum Preset Fields" lists are future schema hints that should map back to this inventory rather than define a competing shape.

`Purpose`

What this machine exists to do in one sentence.

`Trigger`

What input, event, or station state activates the machine.

`Authority`

What this machine may decide, mutate, dispatch, execute, or evaluate.

`Evidence`

Which artifacts, verifier outputs, transcripts, or checkpoint records it may use as proof.

`Outputs`

Which artifacts, state transitions, reports, or recommendations it must produce.

`Failure Handling`

How it reports blocked, failed, stale, ambiguous, or unsupported work.

`Handoff Rules`

Which downstream machine it may recommend or dispatch to, and what evidence must be included.

`Forbidden Moves`

Actions that remain forbidden even if a specialization or domain overlay would be convenient.

`Lifecycle`

Whether the machine is run-scoped, case-scoped, attempt-scoped, or stage-scoped, and when its context should be reset.

## Orchestrator

### General Concept

The orchestrator owns the conveyor belt. It decides which role machine receives the next task, when a stage may advance, when a case must stop, and when failure evidence should be handed to another role.

The orchestrator is a state-transition authority. It is not the worker that performs the assigned task, and it is not the judge that decides whether runner output is acceptable.

### Shared Traits

- Maintains exactly which case, stage, attempt, and message are active.
- Dispatches bounded task envelopes to the next role machine.
- Gates progress on required artifacts, activation evidence, verifier output, and judgment verdicts.
- Applies retry, rerun, pause, and handoff policy.
- Records why each transition happened.
- Treats pane text as diagnostic evidence, not completion evidence.

### Forbidden Responsibilities

- Must not perform runner task work on behalf of the runner.
- Must not fabricate runner, judgment, provider, or verifier artifacts.
- Must not treat runner self-report as final pass/fail judgment.
- Must not patch provider source, case inputs, or consumer-generated artifacts.
- Must not expose raw internal station control JSON to model panes unless debug behavior explicitly requires it.

### Inputs and Outputs

Typical inputs:

- Station configuration.
- Case manifest and stage contracts.
- Mailbox activation and reply files.
- Required artifacts and verifier results.
- Pane health and timeout evidence.

Typical outputs:

- Dispatch requests.
- State transitions.
- Station events.
- Failure artifacts owned by Loop Station.
- Provider, rerun, pause, or terminal decisions.

### Lifecycle and Authority Boundary

The orchestrator is run-scoped. It owns state transitions for the whole run. It can stop, pause, rerun, or advance the station, but only from evidence produced by the correct role machine or deterministic verifier.

### Specialization Candidates

- `strict-sequential`: one case or stage active at a time; no advance before judgment passes.
- `recovery`: failure goes to provider repair, install/deploy verification, then rerun. This specialization depends on future `ProviderEngineer`, `Installer`, and `DeployVerifier` role-machine definitions before it can be fully materialized.
- `human-gated`: explicitly pauses at human-owned checkpoints and requires checkpoint evidence before continuing.
- `multi-stage`: dispatches ordered stage contracts and prevents a runner from continuing into later stages.

### Minimum Preset Fields

These future schema hints map to the inventory above: `transitionPolicy`, `dispatchPolicy`, `completionGates`, and `failurePolicy` describe trigger, authority, evidence, outputs, failure handling, and handoff rules for a deterministic orchestration machine.

- `id`
- `role: orchestrator`
- `sharedTraits`
- `specialization`
- `transitionPolicy`
- `dispatchPolicy`
- `completionGates`
- `failurePolicy`
- `forbiddenResponsibilities`
- `promptReference`

### Coverage Checklist

An orchestrator preset is incomplete until it answers:

- What exact evidence opens and closes each active task slot?
- Which role owns each transition gate?
- What happens on missing activation, stale artifacts, verifier failure, and judgment failure?
- Which failures pause, rerun, recycle a pane, hand off to provider roles, or stop the run?
- Which internal details must stay out of model-visible envelopes?
- Which parts are deterministic station behavior versus prompt-facing guidance?

## Runner

### General Concept

The runner performs assigned work. It receives one bounded case, stage, or task envelope, invokes the public target skill or permitted runtime surface, and writes required artifacts.

The runner is an execution authority for its assigned task only. It does not decide whether the task passes overall, and it does not repair provider-owned code unless the runner is explicitly a provider role, which is a different machine.

### Shared Traits

- Works only on the assigned case, stage, or task.
- Uses the configured public skill entry or allowed runtime boundary.
- Produces required artifacts with provenance.
- Reports blockers through artifacts instead of silently advancing.
- Stops at human-owned checkpoints when the station spec says the human owns the action.
- Does not continue into another stage unless the task envelope explicitly assigns that stage.

### Forbidden Responsibilities

- Must not make final pass/fail decisions for the station.
- Must not claim completion from chat-only self-report.
- Must not bypass configured target skills with provider binaries, hidden launchers, ad hoc scripts, or synthesized states.
- Must not patch provider source, case inputs, or generated consumer artifacts.
- Must not replace human-owned browser, document, or approval checkpoints with automation.

### Inputs and Outputs

Typical inputs:

- Mailbox task envelope.
- Case prompt or stage input.
- Public target skill entry and allowed runtime calls.
- Required artifact list and evidence expectations.
- Output directory for the current attempt.

Typical outputs:

- `runner-report.md`
- `runner-metadata.json`
- `output-manifest.json`
- Stage-specific artifacts declared by the contract.
- Blocker or unsupported evidence when work cannot complete.

### Lifecycle and Authority Boundary

The runner is usually attempt-scoped for benchmark and evaluation loops, stage-scoped for action pipelines, or case-scoped when context reuse is explicitly useful. It owns task execution only inside the assigned workspace and output directory.

### Specialization Candidates

- `artifact-producing`: executes a case and writes required artifacts.
- `stage-bound-action`: performs one declared stage and stops.
- `human-checkpoint`: prepares work, pauses for human-owned action, then records checkpoint evidence.
- `parallel-candidate`: produces one candidate result in a multi-runner comparison without judging the winner.

### Minimum Preset Fields

These future schema hints map to the inventory above: `allowedInputs`, `requiredArtifacts`, `runtimeBoundary`, and `checkpointPolicy` describe trigger, authority, evidence, outputs, failure handling, and lifecycle for a model-pane execution machine.

- `id`
- `role: runner`
- `sharedTraits`
- `specialization`
- `allowedInputs`
- `requiredArtifacts`
- `runtimeBoundary`
- `checkpointPolicy`
- `forbiddenResponsibilities`
- `promptReference`

### Coverage Checklist

A runner preset is incomplete until it answers:

- What is the smallest assigned unit of work: case, stage, attempt, or task?
- Which public skill entry or runtime boundary is allowed?
- What artifacts prove execution, and which fields prove provenance?
- What must the runner do when the assigned work is blocked or unsupported?
- Which workspace paths are writable, read-only, or forbidden?
- Where must the runner stop for human-owned checkpoints?
- What wording prevents the runner from judging, repairing, or advancing the station?

## Judgment

### General Concept

The judgment machine evaluates runner output and process evidence. It writes a verdict artifact that the orchestrator can use as a gate.

Judgment is an evaluation authority. It does not execute the runner's task, does not repair provider files, and does not directly advance the station. The orchestrator reads judgment artifacts and performs the transition.

### Shared Traits

- Reviews required artifacts, schemas, provenance, and process evidence.
- Separates output quality from process compliance when both matter.
- Writes structured verdict artifacts.
- Explains failures in a way the orchestrator or provider handoff can use.
- Treats missing or stale authoritative artifacts as failure or blocked evidence.
- Checks artifact identity and freshness for the active run, case, stage, attempt, and message when those identifiers are available.
- Confirms that verdict inputs match the current dispatch instead of mixing older run evidence with current artifacts.
- Avoids relying on pane transcript summaries when required artifacts disagree.

### Forbidden Responsibilities

- Must not perform missing runner work.
- Must not create runner artifacts to make an attempt pass.
- Must not directly dispatch the next role or mutate station state.
- Must not repair provider source or consumer artifacts.
- Must not accept chat-only self-report as completion evidence.

### Inputs and Outputs

Typical inputs:

- Runner artifacts.
- Runner metadata and provenance.
- Output manifest.
- Verifier results.
- Pane transcript snippets as diagnostic evidence.
- Stage contract and expected evidence rules.

Typical outputs:

- `eval-report.md`
- `eval-verdict.json`
- Failure reasons and rerun/provider recommendations when configured.

### Lifecycle and Authority Boundary

Judgment is usually attempt-scoped. It owns verdict production for one attempt or stage. It may recommend rerun, provider repair, human review, or pass, but it does not perform the transition.

### Specialization Candidates

- `artifact-contract`: validates required artifacts, JSON parseability, schemas, and provenance.
- `process-evidence`: checks whether the runner used the permitted skill/runtime boundary.
- `comparative`: compares multiple runner candidates and selects a winner or declares no pass.
- `challenge-review`: reviews a provisional pass and looks for weak evidence before provider or rerun gates.

### Minimum Preset Fields

These future schema hints map to the inventory above: `evidenceInputs`, `verdictSchema`, `passCriteria`, and `failureTaxonomy` describe evidence, outputs, failure handling, and handoff recommendations for a model-pane judgment machine.

- `id`
- `role: judgment`
- `sharedTraits`
- `specialization`
- `evidenceInputs`
- `verdictSchema`
- `passCriteria`
- `failureTaxonomy`
- `forbiddenResponsibilities`
- `promptReference`

### Coverage Checklist

A judgment preset is incomplete until it answers:

- Which artifacts are authoritative inputs, and how freshness is checked?
- What verdict values are allowed?
- What separates output quality failure from process-boundary failure?
- What evidence is enough for pass, weak pass, fail, blocked, needs human, or known unsupported?
- Which recommendations may be sent to the orchestrator without directly mutating state?
- How does it avoid filling in missing runner work?

## Evidence Identity and Freshness

Evidence is authoritative only when it belongs to the active dispatch. Role presets should preserve this rule even before a concrete JSON schema exists.

Orchestrator responsibilities:

- Tracks the active run, case, stage, attempt, and message.
- Gives each model role the expected mailbox request, started, and reply paths.
- Rejects advancement when evidence is missing, stale, or attached to the wrong dispatch.

Runner responsibilities:

- Writes provenance in runner-owned artifacts.
- Includes message, agent, phase, and skill/runtime evidence when required by the stage contract.
- Records human checkpoint evidence before claiming completion of human-owned phases.

Judgment responsibilities:

- Reads only the latest authoritative artifacts for the active dispatch.
- Treats mismatched run, case, stage, attempt, message, or agent identity as fail or blocked evidence.
- Treats stdout summaries, pane text, and older journal entries as diagnostic context, not final proof.

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
| Consume verifier output | Gates transition | May run allowed verifier step | Reviews result |
| Mutate assigned workspace | Forbidden except station state | Owns only assigned output/task scope | Forbidden |
| Recommend provider handoff | Decides handoff | Reports blocker/failure evidence | Recommends from verdict |
| Use pane transcript | Diagnostic only | Diagnostic only | Diagnostic only |

## Setup Recommendation Signals

Setup should recommend role-machine presets from intent and contract evidence, not from domain labels alone.

Useful signals:

- Work unit shape: single case, repeated case, ordered stage, parallel candidate, or human checkpoint.
- Evidence strictness: artifact existence, schema validation, provenance, verifier output, or human checkpoint proof.
- Transition style: strict sequential, recovery/rerun, human-gated, or multi-stage.
- Mutation boundary: station-only, consumer output only, provider-owned, or no mutation.
- Failure path: stop, retry, recycle pane, provider handoff, deploy verification, or human pause.
- Comparison need: one runner candidate, multiple runner candidates, or challenge review.

The recommendation output should name the selected role preset for each machine separately. A domain overlay may be suggested after the role presets are chosen.

Recommendation output should be a per-role bundle with a selected preset, alternates, confidence, and a short reason. For example:

```yaml
recommended:
  orchestrator:
    preset: strict-sequential
    confidence: high
    reason: One active case or stage should advance only after artifact and judgment gates pass.
    alternates: [human-gated, multi-stage]
  runner:
    preset: stage-bound-action
    confidence: medium
    reason: The requested work is an ordered stage and the runner must not continue into later stages.
    alternates: [artifact-producing, human-checkpoint]
  judgment:
    preset: artifact-contract
    confidence: high
    reason: Required artifacts, provenance, and verifier outputs are the main pass gate.
    alternates: [process-evidence, comparative]
domainOverlay: null
```

## Preset Authoring Principles

- Preserve role authority before adding specialization.
- Keep shared traits small, stable, and role-defining.
- Put domain behavior in specialization or later domain overlays.
- Materialize selected built-in presets into `.loop-station` before station-local editing.
- Keep final station config explainable from the selected role presets and local materialized copies.
- Treat schema, setup recommendation UX, and generated sub-skills as follow-on implementation work.
