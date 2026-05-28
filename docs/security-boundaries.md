# Security Boundaries

Loop Station coordinates local Codex sessions. Treat it as a powerful local automation tool.

## Station code may

- read configured paths
- create station-local run files
- paste human-readable messages into tmux panes
- inspect artifacts, transcripts, and state
- launch visible Codex panes using the configured `defaultAgentCommand`

The template `defaultAgentCommand` currently runs Codex with full local sandbox access and approval bypass so unattended pane orchestration can proceed. Treat this as a trusted local automation mode. Override `STATION_AGENT_COMMAND` or `STATION_CODEX_BIN` before starting a station if a safer local policy is required.

For default Codex panes, station start must confirm each model pane is idle before dispatch. Startup prompts or blocked pane states are safety failures, not conditions for prompt injection or workaround retries.

## Station code must not

- patch provider source
- edit case input files as a substitute for provider repair
- mutate generated consumer artifacts outside the attempt output directory
- treat the installed consumer project `.codex/skills/loop-station/**` bundle as a mutable workspace; that bundle is read-only payload and must not be edited under `.codex/skills/loop-station/assets/harness-template/src/**`, `.codex/skills/loop-station/assets/harness-template/test/**`, or sibling paths
- hide provider changes behind deterministic scripts
- expose raw station control JSON in model-visible prompts by default
- let runner panes bypass public skill entries with hidden launchers, provider binaries, curl/ad hoc scraping, or direct spreadsheet libraries
- accept invalid runner guard patterns or let guard pattern compilation failures crash the orchestrator
- patch consumer-local `.loop-station` harness source during Run Mode; stale harnesses must be replaced from the canonical template

In consumer projects, setup proposals and generated plans may mention `.codex/skills/loop-station/**` only as a read-only dependency. Mutable targets must be `.loop-station/**`, project-local wrapper skills outside the installed loop-station bundle, or ordinary project files. Setup/spec validation rejects installed-bundle mutable targets.

## Provider repair

Provider repair happens inside a provider-rooted Codex pane. The station may send evidence and wait for response files, but it does not directly perform provider changes.

## Evaluation gate

Runner artifacts are not final success. The evaluator pane must review process evidence, public skill invocation evidence, and output provenance before the station advances.
