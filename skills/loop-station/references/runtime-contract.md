# Runtime Contract

Use this reference when generating or reviewing a loop-station harness. A station may be a skill benchmark, repair loop, installation loop, judge/provider workflow, or multi-step automation pipeline; the same contract applies to each shape.

## Boundary

The harness has two kinds of actors:

- `-Model` actors are LLM agents running in visible tmux panes.
- Code components have no `-Model` suffix and must be deterministic.

Do not let a `-Model` actor become the source of truth for orchestration state. Model output is evidence; the code runtime owns state transitions.

## Default Runtime Shape

One run maps to one visible tmux runtime by default:

```text
tmux session
  StationControl code pane
  RunnerAgent-Model pane
  EvaluatorAgent-Model pane
  ProviderCodex-Model pane
  optional MonitorAgent-Model pane
```

The orchestrator runs as a background Node process. `StationControl` is read-only and tails logs/events. On an interactive terminal inside tmux, `station start` should split from the current tmux window so the panes are visible immediately. The operator pane stays on the left; the managed station section appears on the right and may stack its panes `vertical` or `horizontal` according to the layout spec. Outside tmux, `station start` should create an owned tmux session and surface it through an attached terminal window. Detached/background-only start is not part of the public runtime surface.

The current Codex conversation is the trigger/control session. When tmux borrowing is unavailable there, the owned runtime session must be surfaced through an attached terminal by default. Direct runner work from the trigger session is not the normal path before runtime startup.

Consumer `action-stages` runs are contract-bound: each stage must declare a public wrapper skill, and generic prompt-only action stages are not a valid consumer run-mode surface.

Missing tmux, missing pane targets, dead panes, or blocked model startup surfaces are hard runtime failures. The harness must not create mock panes or report prompt delivery success when no visible Codex pane exists. Trust prompts, update prompts, dead panes, or readiness timeouts fail with `model_pane_startup_blocked`.
Pane reuse is normal. The station must distinguish a startup-ready pane, a pane showing the current dispatch, an activation mailbox acknowledgement, and a pane that is only showing queued follow-up text.

## Message Lifecycle

Every control message must be persisted and transition through explicit states:

```text
created -> pending -> submitted -> accepted_by_pane -> processing -> idle_observed -> artifact_waiting -> artifact_ready -> verified -> completed
```

Failure states:

```text
blocked | stuck | transport_submit_not_started | timeout | dead | failed
```

The orchestrator may continue only after the completion policy for the stage passes.

## Completion Policy

Do not treat "I am done" from a model as enough.

Required completion evidence:

- The model wrote a valid mailbox started JSON after dispatch.
- The station captured enough visible pane transcript evidence for review.
- `ArtifactAwaiter` found all required non-empty artifacts.
- `Verifier` passed when the stage has a verifier command or verifier agent.
- The typed `judgment` role wrote `eval-report.md` and `eval-verdict.json` with a pass verdict before a runner pass candidate advances.

Pane text is diagnostic, not final success proof.

Activation and completion are separate:

- Activation is `submitted -> active` and must be proven by model-written mailbox started JSON.
- Completion is `active -> completed` and must be proven by required artifacts plus mailbox reply JSON.
- Same-pane continuation is valid only after the previous mailbox task is closed and the pane task slot is free.

`output-manifest.json` may use `done` or `passed` for a terminal pass candidate, but evaluator review is still mandatory.

Runner-owned artifacts must include provenance: `messageId`, `agentName`, `phaseEvidence`, and `skillRuntimeEvidence`; human-owned checkpoints additionally require `humanCheckpointEvidence`. When station code rejects an attempt, it writes `loop-station-failure.json/md` and must not fabricate runner-owned artifacts.

For consumer action stages, stage advancement requires more than file existence: required JSON artifacts must parse, satisfy the declared artifact schema, include stage skill runtime evidence, and have matching mailbox activation evidence before the Orchestrator may dispatch the next stage. Mailbox activation proves the model wrote the started artifact; it is not proof that the stage skill ran.

## Target Skill Invocation

When the loop targets one or more Codex skills, the runner stage must model a human using Codex:

- Start from the configured consumer workspace.
- Read the assigned case files.
- Invoke the configured public skill entries inside the Codex session, using `targetSkillName` for single-skill loops or `targetSkills` plus `stageContracts` for multi-skill pipelines. Preset mode should compile user intent into built-in loop profiles with typed roles; freeform station authoring is advanced-legacy compatibility only.
- Save transcript and result artifacts from that session.

The runner stage must not bypass the Codex `$skill` call through provider entrypoints, compatibility wrappers, installers, hidden launchers, curl/ad hoc scraping, direct spreadsheet libraries, or direct provider runtimes.

Before generating the runner envelope, run Skill Contract Discovery from `skill-contract-discovery.md`. Discovery must identify `skillProfiles[]`, allowed public runtime calls, phase contracts, required evidence, human checkpoints, and capability gaps. Runtime calls explicitly documented by the public skill entry are allowed skill-owned boundaries.

Install Mode should default target skills to project-local copies under `<consumerRoot>/.codex/skills/<skill-name>` so dispatch validation is reproducible.

`targetSkillName` and `targetSkills` are mutually exclusive. Multi-skill pipelines must use `targetSkills[]` plus stage-level contracts with install/source/provider roots as needed.

For browser-flow manual capture, the runner may call only the public prepare step, then must stop at `awaiting_capture`. Human-owned browser work cannot be replaced with a direct URL, Runner-operated typing/clicking, or later runtime phases before human completion evidence exists.

Runner guard patterns are validated before start. Invalid `runnerForbiddenPatterns` fail validation with `runner_guard_pattern_invalid` and must be reported as guard violations rather than crashing orchestrator ticks.

## Harness Refresh

Run Mode must not patch consumer-local `.loop-station` source files. If the installed harness is stale or invalid, replace it from the canonical template in Install/Refresh Mode; destructive test refreshes use `loop-station install --replace --project <dir>` and do not create `.loop-station_temp*` backups.

## Provider Feedback Policy

For recovery loops:

- Send runner/evaluator evidence to the provider-rooted Codex pane.
- Do not patch provider/source targets from loop-station code.
- Do not patch case output directories or generated consumer artifacts.
- Wait for provider response files reporting `fixed`, `known_unsupported`, or `needs_human`.
- Rerun the same failed case only after provider-side Codex reports that provider changes and any release/install updates are complete.

## Mailbox Control Plane

Normal runtime dispatch should use mailbox request/started/reply paths instead of pasting inline raw control JSON.

- The station writes a mailbox request JSON file under the run mailbox tree.
- The pane receives a short control line with `MAILBOX_REQUEST=<path>`, `MAILBOX_STARTED=<path>`, and `MAILBOX_REPLY=<path>` when reply is required.
- The mailbox request file is the model-visible source of truth for the task.
- The model must write the started JSON before doing task work; missing started JSON is `activation_ack_missing`.
- Raw pane text is failure evidence only. It does not advance a model message to active.

## Activation Failure Policy

Activation failure is a transport/control-plane failure, not completion failure. The station must not infer activation from a later mailbox reply, follow-up pane text, or artifact existence.

Valid runtime policies are:

- `fail_fast`: mark the stage or case failed immediately and record transport evidence.
- `recycle_once`: respawn the pane for the same role slot and resubmit the same mailbox request one time.

Public preset loops default to `recycle_once` unless a sample or station explicitly opts into stricter diagnostics. The `examples/echo-skill-loop` sample uses `fail_fast` so unhealthy transport is surfaced immediately.

## Streamed Run Mode

Run Mode should hide raw CLI details from the user. Codex operates the generated harness and streams:

- active case and stage
- active `-Model` pane state
- pending message and awaited artifacts
- verifier results
- failure reason and next action
