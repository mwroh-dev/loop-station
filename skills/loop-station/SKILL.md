---
name: loop-station
description: Use when a user wants to install, configure, or operate a project-local `.loop-station` harness for custom tmux/Codex loops.
---

# Loop Station

Use this skill to install or run a local tmux/Codex orchestration harness from the current user project. The skill is expected to live at `.codex/skills/loop-station`; its station state and vendored harness live at `.loop-station`.

Loop Station is for custom repeatable agent loops. The current template is skill-oriented, but Install Mode should first discover the user's loop shape: benchmark, skill improvement, judge/provider repair, installation, or a multi-step automation pipeline. The user should not need to know target skill internals; Install Mode must capture the public skill entries, inputs, outputs, evidence, and pane layout needed for a safe guided run.

In a consumer project, treat the installed project-local `.codex/skills/loop-station/**` bundle as a read-only payload. It is not a development workspace. Do not plan edits against `.codex/skills/loop-station/assets/harness-template/src/**`, `.codex/skills/loop-station/assets/harness-template/test/**`, or any other path inside the installed loop-station bundle. If loop-station itself needs code changes, make them in the canonical source repo under `skills/loop-station/**`, then reinstall the project-local skill. Consumer-mode setup/spec validation enforces this boundary and rejects installed-bundle edit targets.

Treat the current Codex conversation as the trigger/control session. It may install the skill, run setup, validate, start, inspect, stop, and clean up. It must not perform default live runner work such as collector/browser/excel execution before `station start` creates the runtime panes. That live work belongs inside the attached runtime session. Direct component probing is allowed only after orchestrated runtime failure or when the user explicitly asks for component-level debugging.

## Modes

### Install Mode

Use Install Mode when `.loop-station` is missing or the user asks to set up, define, reset, refresh, or test a station. A request for a new automation pipeline, a new target-skill combination, new release paths, or new case/output behavior is always Install/Refresh Mode even when `.loop-station` already exists. First run Skill Contract Discovery from `references/skill-contract-discovery.md` for every target skill, then read `references/interview.md`, interview the user only for unresolved decisions, present a setup proposal, and install a vendored harness into `.loop-station` only after user confirmation or an explicit refresh/setup request.

When `request_user_input` is available, use it for Install Mode choices that have clear options. Ask 1-3 questions at a time. Each question must have a short `header`, a stable `snake_case` `id`, a one-sentence `question`, and 2-3 mutually exclusive `options`; put the recommended option first and mark it with `(Recommended)` in the label or description. If `request_user_input` is unavailable, ask one plain-text question at a time instead of pretending the structured UI exists.

A request to install skills is not permission to install `.loop-station`. Install or align `.codex/skills/<skill>` only, then report that the target skills are ready. For loop-station itself, this means the project-local skill install lives under `.codex/skills/loop-station` first, and only a later setup step may generate `.loop-station`. Do not create, validate, or patch `.loop-station` during skill-install-only work.

In consumer mode, setup proposals and implementation plans must name only mutable targets such as `.loop-station/**`, project-local wrapper skills like `.codex/skills/<wrapper-skill>/`, or ordinary project files outside the installed loop-station bundle. The installed `.codex/skills/loop-station/**` path may appear only as a read-only dependency or reference surface.

Normal installs must not silently overwrite an existing `.loop-station`; validate it and report its status only when the user asks to run, inspect, attach to, stop, or review the current station without changing the pipeline definition. Test setup, release-path setup, new automation pipeline setup, stale/invalid harness recovery, and any explicit refresh/reset request are different: delete and regenerate the harness with the canonical replace path before validating or running it. Do not say "existing `.loop-station` is present, so I will validate it first" for these setup/refresh requests. Do not preserve `.loop-station_temp*` backups, do not say the existing harness is acceptable just because it exists, and do not patch the vendored harness in place.

The spec must define:

- purpose: the loop shape, roles, stages, and evidence that should drive state transitions.
- locations: `stationRoot`, relevant work roots such as `sandboxRoot`, `consumerRoot`, `providerRoot`, optional `releaseRoot`, optional target skill install paths, and `caseManifest`.
- target skills: single `targetSkillName` or multi-skill `targetSkills`, with project-local install destinations by default.
- stage contracts: ordered public skill entry, input, required output, and evidence requirements for each stage.
- layer authority: allowed actor for each phase (`human_user`, `station_capture_controller`, `runner_model`, `skill_runtime`, `evaluator_model`), plus capture mode and checkpoint evidence.
- agents: visible `-Model` panes, cwd binding, lifecycle, inputs, and required artifacts.
- flow: ordered stages, completion policy, terminal states, and provider feedback policy.
- layout: tmux session/window/pane plan, defaulting to full team visible with a new-window fallback when panes do not fit, and which panes respawn per case or attempt.
- verification: required artifacts, optional verifier commands, transcript policy, and timeout policy.
- skillProfiles: public entry docs, allowed public runtime calls, phases, human checkpoints, deterministic/runtime steps, evidence artifacts, capability gaps, and downstream contracts.

### Run Mode

Use Run Mode when `.loop-station` exists. The user should not need to know shell commands. Validate, start, stop, status, attach, smoke checks, run-next, and progress streaming are internal operations Codex performs unless direct user action is unavoidable.

Run Mode must not edit `.loop-station/src`, `.loop-station/test`, or other vendored harness source files inside a consumer project. If those files need changes, switch to Install/Refresh Mode and replace the harness from the canonical template instead of locally repairing it.

### Review Mode

Use Review Mode before publishing or trusting a station. Check the runtime contract, safety boundaries, prompt envelopes, state machine tests, public guide fixtures, and manual override audit trail.

Read `references/public-safety-boundary.md` and `references/review-checklist.md` during review.

## Authority Boundaries

Loop-station code owns orchestration state and station-local run files only. It must not patch provider source, case inputs, generated consumer artifacts, or consumer-local vendored harness code during Run Mode. Writes inside `.loop-station` are limited to state/runs/locks during Run Mode and to generated config/cases during Install/Refresh Mode.

Consumer-mode plans must fail fast if the requested work would require editing the installed `.codex/skills/loop-station/**` bundle. Redirect those changes either to the canonical source repo or to generated `.loop-station/**` / wrapper-skill targets, depending on the user's actual goal. This is enforced at setup/spec validation time, not left as advisory text only.

Runner panes must invoke the configured public target skill entries inside Codex when target skills are configured. They must not bypass skills with provider binaries, wrappers, installers, hidden launchers, curl/ad hoc scraping, direct spreadsheet libraries, ad hoc scripts, or synthesized browser states that replace a human-owned checkpoint.

For browser-flow manual capture, RunnerAgent-Model may prepare the public capture runtime and then must stop at `awaiting_capture`. The user owns visible-browser typing, clicking, scrolling, and navigation unless the confirmed station spec explicitly selects Station-owned CDP automation. RunnerAgent-Model and the browser-flow runtime must not replace "open the main page and search" with a direct search-result URL.

Runner artifacts are not sufficient to advance a case. The built-in `EvaluatorAgent-Model` must review runner artifacts, process evidence, and output provenance before the orchestrator can mark the case passed or dispatch the next stage/case.

Provider changes belong only to the provider-rooted Codex pane. The station sends evidence and waits for `fixed`, `known_unsupported`, or `needs_human` response files.

## Naming

Names ending in `-Model` are LLM agents in tmux panes. Names without `-Model` are deterministic code components such as `Orchestrator`, `PaneWatcher`, `ArtifactAwaiter`, and `StationControl`.

## Resources

- `references/interview.md`: Install Mode decisions.
- `references/skill-contract-discovery.md`: pre-interview target skill contract discovery.
- `references/role-machine-presets.md`: role machine preset overview and focused role reference index.
- `references/role-machine-presets/`: focused role machine concept, boundary, Orchestrator, Runner, and Judgment references.
- `references/preset-recommendation-flow.md`: setup-time role preset recommendation procedure.
- `references/preset-catalog.md`: built-in role preset catalog overview and focused catalog reference index.
- `references/preset-catalog/`: source layout, scoring, materialization, and authoring references.
- `references/backlog.md`: deferred preset work and explicit non-goals.
- `references/runtime-contract.md`: State machine and completion rules.
- `references/public-safety-boundary.md`: Public authority and prompt boundary.
- `references/review-checklist.md`: Review-ready verification checklist.
- `assets/harness-template/`: Node.js harness vendored into `.loop-station`.
