# Loop Station Interview

Use this reference in Install Mode. A new automation pipeline, new target-skill combination, new release paths, or changed case/output behavior is Install/Refresh Mode even when `.loop-station` already exists. Run Skill Contract Discovery first, using `skill-contract-discovery.md`, then ask only questions that materially change the generated `.loop-station` harness. Prefer one question at a time, but make the final spec decision-complete before generation. Do not create `.loop-station` from natural language alone; present the setup proposal and wait for confirmation unless the user explicitly requested refresh/setup.

In consumer projects, the installed `.codex/skills/loop-station/**` bundle is read-only. Setup proposals, generated plans, and implementation guidance must never name `.codex/skills/loop-station/assets/harness-template/src/**`, `.codex/skills/loop-station/assets/harness-template/test/**`, or any other installed loop-station bundle path as a mutable target. Use `.loop-station/**`, project-local wrapper skills outside the installed loop-station bundle, or ordinary project files instead. Setup/spec validation rejects installed-bundle mutable targets.

The current Codex conversation is the trigger/control session. Interview, setup, validation, start, status, cleanup, and reporting happen there. Live runner work belongs in the runtime panes after `station start` succeeds. Do not treat direct collector/browser/excel execution from the trigger session as the default path.

When `request_user_input` is available, use it for bounded Install Mode decisions. Ask 1-3 questions per call, and give each question:

- `header`: short UI label.
- `id`: stable `snake_case` answer key.
- `question`: one sentence.
- `options`: 2-3 mutually exclusive choices, with the recommended option first and marked `(Recommended)` in the label or description.

Use plain-text questions when `request_user_input` is unavailable, when the answer must be open-ended, or when a path/value should be inspected from the workspace instead of chosen by the user.

## Required Decisions

### 1. Station Purpose

Capture the user's loop in one sentence. Start broad, then narrow to the current template's skill-oriented defaults only when they fit.

```text
Given <inputs>, run <role or action>, evaluate <evidence>, then <advance | judge | repair | rerun | stop>.
```

Classify the loop:

- `skill-benchmark`: run a target `$skill` against sandbox/consumer cases and collect artifacts.
- `skill-improvement`: run cases, judge output, send failure evidence to a provider pane, verify release/install, then rerun.
- `evaluation-only`: run and judge, no repair.
- `recovery-loop`: run, judge, send evidence to a repair/provider role, verify, rerun.
- `installation-loop`: install/setup first, verify install, run tests, judge.
- `action-pipeline`: run ordered actions such as `action 1 -> action 2 -> action 3`.
- `multi-stage-runner`: one input or case has multiple ordered stages.

Common shapes:

```text
sandbox + consumer -> benches
sandbox + consumer -> judge -> provider -> rerun
sandbox -> action 1 -> action 2 -> action 3
```

### 2. Locations

Resolve every location to an absolute path or a generated variable:

- `stationRoot`: where the generated harness lives and stores runs.
- `sandboxRoot`: optional disposable or isolated workspace for cases, benches, or action execution.
- `providerRoot`: source/provider opened by the provider-rooted Codex pane; loop-station must not patch it.
- `releaseRoot`: optional sanitized/generated provider mirror used for installation or distribution.
- `consumerRoot`: working environment where the behavior is consumed or tested.
- `consumerInstallTarget`: optional path where provider output is installed into consumer.
- `caseRoot`: folder or manifest containing cases.
- `actionRoot`: optional workspace for non-skill action pipelines.
- `targetSkillName`: the `$skill` invoked inside the consumer Codex session, when this is a skill loop.
- `targetSkills`: ordered target skills for multi-skill pipelines.
- `targetSkillInstallPath`: optional single-skill path checked before any case dispatch. By default, target skills are resolved under `<consumerRoot>/.codex/skills/<skill-name>`.

For each target skill, decide the install source and destination:

- already installed project-local under `<consumerRoot>/.codex/skills/<skill-name>`
- user-level install that should be copied project-local
- explicit source folder that should be copied project-local
- explicit read-only folder reference when copying is not desired

Default to project-local copy so runs are reproducible and validate from the consumer workspace.

If the user only asked to install skills, stop after installing or aligning `.codex/skills/<skill>`. Skill installation is not harness installation. For loop-station itself, the project-local skill install under `.codex/skills/loop-station` must exist before setup generates `.loop-station`.

If provider, consumer, sandbox, or action roots are the same path, explicitly record why that is safe.

### 3. Cases and Inputs

Determine:

- Case discovery: folder list, JSON manifest, CSV, or single case.
- Action input discovery for non-case pipelines.
- Required case files.
- Optional case files.
- Output directory per case/attempt.
- Whether expected outputs exist.
- Whether evaluation is expected-output diff, prompt-grounded, or hybrid.

For multi-stage skill pipelines, write a `stageContracts` entry for each stage:

- public skill entry to invoke
- discovered `skillProfiles[]` entry for that skill
- phase contracts, deterministic/runtime steps, and human checkpoints discovered from public docs
- allowed actor for each phase: `human_user`, `station_capture_controller`, `runner_model`, `skill_runtime`, or `evaluator_model`
- capture mode and checkpoint evidence, especially for browser-flow manual capture
- allowed public runtime calls named by the public entry
- user-facing input to send
- required output artifact(s)
- evidence that proves the public skill ran
- forbidden shortcuts such as internal launchers, curl/ad hoc scraping, direct spreadsheet libraries, or provider binaries

### 4. Agents

Every LLM agent name must end with `-Model`.

For each agent, define:

- Purpose.
- Inputs/message types.
- Required outputs.
- `cwd` binding: station, provider, consumer, case folder, or custom.
- Lifecycle: run-scoped, case-scoped, attempt-scoped, or stage-scoped.
- Isolation rule: respawn, clear history, reuse, or no tmux pane.
- Whether it may patch files. Only provider-owned Codex panes may modify provider files.

Common agents:

- `RunnerAgent-Model`: executes the assigned case only.
- `ActionAgent-Model`: executes one configured action stage and writes its artifacts.
- `EvaluatorAgent-Model`: judges output and process evidence.
- `JudgeAgent-Model`: reviews artifacts and decides pass, weak pass, fail, or needs human.
- `ProviderCodex-Model`: receives success/failure evidence in the provider repo Codex session and decides whether to modify, ask, or mark unsupported. Keep this internal id out of provider-visible prompt text.
- `InstallerAgent-Model`: installs or sets up the consumer environment.
- `DeployVerifierAgent-Model`: verifies provider changes reached consumer.
- `MonitorAgent-Model`: summarizes and reviews station events.

### 5. Deterministic Components

Define the code components, without `-Model` suffix:

- `Orchestrator`: state machine and dispatch authority.
- `TmuxTransport`: paste, enter, pane registry.
- `PaneWatcher`: alive, working, idle, stuck, blocked, dead.
- Pane transcript capture: capture visible pane text as diagnostic process evidence.
- `ArtifactAwaiter`: required artifact and error artifact waits.
- `Verifier`: command or adapter-based success checks.
- `StationControl`: visible log/event tail pane.

### 6. Layout

Default to one tmux session per run. Ask for multi-session only when there is a concrete reason.

Decide:

- Session prefix and window name.
- Pane list and titles.
- Pane grouping/regions.
- If the current operator pane is retained on the left, whether the managed right-side section stacks `vertical` or `horizontal`.
- Whether StationControl is visible.
- Which panes are respawned per case or attempt.

Default layout is full team visible. If tmux cannot split another pane because the window has no space, the station should open a new window for the next visible role.

### 7. Flow

Write the flow as ordered stages:

```text
stage id -> actor -> message -> await -> evaluator -> verify -> next branch
```

For each stage, define:

- Sender and receiver.
- Required artifacts.
- Pane watch requirement.
- Verifier command or verifier agent.
- Evaluator artifact requirements.
- Timeout.
- Pass branch.
- Weak/fail branch.
- Retry limit.
- Terminal state.

### 8. Completion and Await Policy

Never use agent self-report as the only completion signal. Runner artifacts are pass candidates; `EvaluatorAgent-Model` must pass the attempt before the orchestrator may advance.

Each message must move through:

```text
created -> pending -> submitted -> accepted_by_pane -> processing -> idle_observed -> artifact_waiting -> artifact_ready -> verified -> completed
```

Failure states:

```text
blocked | stuck | timeout | dead | failed
```

### 9. Repair Policy

Resolve only when the loop has repair, provider, or judge handoff:

- What evidence is sent to `ProviderCodex-Model`.
- What loop-station must never patch.
- What provider-side response closes, reruns, or pauses a case.
- Whether provider-side Codex handles release/install before rerun.
- Whether to rerun same case or continue after `fixed`, `known_unsupported`, or `needs_human`.

For recovery loops, default to sending evidence to the provider-rooted Codex pane. Do not let loop-station patch `providerRoot`, case outputs, or consumer-generated artifacts.

### 10. Customization Boundaries

Record where the user wants freedom and where the station must stay strict:

- Which panes may share context, if any.
- Which panes must receive bounded mailbox/task envelopes only.
- Which artifacts are the source of truth for each stage.
- Which stages are deterministic code and which are Codex panes.
- Which roots are read-only, writable, disposable, or provider-owned.
- Which decisions require human approval before continuing.
- Which browser actions are owned by the human user versus explicit Station-owned automation. Runner-owned substitution is not allowed.

## Final Spec Shape

Before generating, summarize:

```yaml
name:
locations:
agents:
layout:
cases:
flow:
artifacts:
watch:
verification:
repairPolicy:
customization:
runMode:
```

Consumer-mode proposals must identify mutable targets explicitly. The installed `.codex/skills/loop-station/**` bundle may appear only as a read-only dependency/reference surface, never as an edit target.

Ask for approval only if a high-impact preference remains unresolved. Otherwise proceed with stated assumptions.
