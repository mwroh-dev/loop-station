# Runtime Contract

Loop Station separates deterministic station control from model work. A station may be a skill benchmark, repair loop, installation loop, judge/provider workflow, or multi-step automation pipeline; the same contract applies to each shape.

- Code components own state transitions, queue order, and pass/fail decisions.
- `-Model` panes receive human-readable task envelopes and write required artifacts.
- One case is active at a time unless a station spec explicitly defines independent lanes.
- Chat-only status is never completion.
- Raw station control JSON is not model-visible by default.
- Full team tmux layout is the default. On an interactive terminal inside tmux, `station start` should split from the current tmux window so the station panes are immediately visible beside the operator pane. The operator pane stays on the left; the managed station section appears on the right and may stack its panes `vertical` or `horizontal` according to the station layout spec. Outside tmux, `station start` should create an owned tmux session and surface it through an attached Terminal.app window. Detached/background-only start is not part of the public runtime surface.
- Missing tmux or missing pane targets are hard runtime failures. The harness must not fabricate mock panes or pretend prompt delivery succeeded when no visible Codex pane exists.
- Model pane startup must be preflighted before dispatch. Trust prompts, update prompts, dead panes, or readiness timeouts fail with `model_pane_startup_blocked` instead of receiving runner prompts.
- Pane reuse is normal. The station must distinguish a startup-ready pane, a pane with the current dispatch visible, an activation mailbox acknowledgement, and a pane that is merely showing queued follow-up text.
- Skill install and harness setup are separate phases: `.codex/skills/loop-station` must exist before setup generates `.loop-station`, and no command should silently perform both mutations.
- The current Codex conversation is the trigger/control session. If borrowed-session tmux is unavailable, the owned runtime session must be surfaced through an attached Terminal.app window by default. Live runner work is not a trigger-session responsibility before runtime startup.
- Consumer `action-stages` runs are contract-bound: each stage must declare a public wrapper skill, and generic prompt-only action stages are not a valid consumer run-mode surface.
- Preset mode is the default public authoring path. Setup should compile user intent into a built-in loop profile plus typed roles and a fixed phase graph. Freeform station authoring is `advanced-legacy` compatibility mode.

## Completion

Runner artifacts complete the run stage only as a pass candidate. A case advances only when required runner artifacts exist, guard checks pass, the typed `judgment` role writes `eval-report.md` and `eval-verdict.json`, and the verdict is pass. Pane text is diagnostic evidence, not the source of truth.

`output-manifest.json` may use `done` or `passed` for a terminal pass candidate, but neither value bypasses evaluator review.

Activation and completion are separate contracts:

- Activation is `submitted -> active` and is proven by model-written mailbox started JSON, not by pane text.
- Completion is `active -> completed` and is proven by required artifacts plus mailbox reply JSON.
- Same-pane continuation is valid only after the prior mailbox task is closed and the pane task slot is free.

Runner-owned artifacts must carry provenance: `messageId`, `agentName`, `phaseEvidence`, and `skillRuntimeEvidence`; human-owned checkpoints also require `humanCheckpointEvidence`. Loop Station writes station failure artifacts such as `loop-station-failure.json/md` when a guard fails; it must not fabricate `runner-report.md`, `runner-metadata.json`, or `output-manifest.json` on behalf of RunnerAgent-Model.

For consumer action stages, stage advancement requires more than file existence: required JSON artifacts must parse, satisfy the declared artifact schema, include stage skill runtime evidence, and have matching mailbox activation evidence before the Orchestrator may dispatch the next stage. Mailbox activation proves the model wrote the started artifact; it is not proof that the stage skill ran.

## Target Skills

Single-skill stations may use `targetSkillName`. Multi-skill pipelines use `targetSkills` and `stageContracts` so runner prompts can explain public skill entries, stage inputs, required outputs, and evidence expectations. Install Mode should default to project-local copies under `<consumerRoot>/.codex/skills/<skill-name>`.

Before interview or dispatch, run Skill Contract Discovery as described in `docs/skill-contract-discovery.md`. Discovery produces `skillProfiles[]`, phase contracts, allowed public runtime boundaries, human checkpoints, required evidence, and capability gaps. A runtime callable documented by the public skill entry is a skill-owned boundary, not a bypass.

`targetSkillName` and `targetSkills` are mutually exclusive. Multi-skill pipelines must use stage-level contracts, including install/source/provider roots where relevant.

Browser-flow manual capture is human-owned by default. The runner may prepare the public runtime, then must stop at `awaiting_capture`; direct search-result URL synthesis, page typing, clicking, or calling later phases before human completion is a layer authority violation.

Runner guard patterns are validated before start. Invalid `runnerForbiddenPatterns` fail validation with `runner_guard_pattern_invalid` and must be reported as guard violations rather than crashing orchestrator ticks.

## Harness Refresh

Run Mode does not repair consumer-local `.loop-station` source files. If the vendored harness is stale or invalid, refresh it from the canonical template; `loop-station install --replace --project <dir>` is the destructive test refresh path and does not create `.loop-station_temp*` backups.

## Provider Feedback

Failed runner or evaluator attempts pause at provider feedback. In preset recovery mode, the provider-engineer pane writes `provider-response.md/json`, `provider-fix-report.md/json`, and `consumer-install-report.md/json`; deploy verification then writes `deploy-verify-report.md/json` before rerun.

Valid JSON response values:

- `fixed`: provider-owned changes and release/update/install are complete; rerun the same case after any required deploy verification passes.
- `known_unsupported`: close this case and continue.
- `needs_human`: pause the run.

`fixed` requires install/update evidence and, when configured, release/consumer skill hash agreement. In `recovery-loop`, structured repair/install/deploy artifacts are the primary contract; string heuristics are legacy fallback only.

## Mailbox Control Plane

Model-visible dispatch should use mailbox request/started/reply paths, not inline raw control JSON.

- The station writes a mailbox request JSON file under the run mailbox tree.
- The pane receives a short control line with `MAILBOX_REQUEST=<path>`, `MAILBOX_STARTED=<path>`, and `MAILBOX_REPLY=<path>` when reply is required.
- The mailbox request file is the model-visible source of truth for the task.
- The model must write the started JSON before doing task work; missing started JSON is `activation_ack_missing`.
- Raw pane text is failure evidence only. It does not advance a model message to active.
- Raw station control JSON should not be pasted inline into pane prompts during normal runtime.

## Activation Failure Policy

Activation failure is a transport/control-plane failure, not completion failure. The station must not infer activation from a later mailbox reply, follow-up pane text, or artifact existence.

Valid runtime policies are:

- `fail_fast`: mark the stage or case failed immediately and record transport evidence.
- `recycle_once`: respawn the pane for the same role slot and resubmit the same mailbox request one time.

Public preset loops default to `recycle_once` unless a sample or station explicitly opts into stricter diagnostics. The `examples/echo-skill-loop` sample uses `fail_fast` so unhealthy transport is surfaced immediately.
