# Public Safety Boundary

Use this reference when building or reviewing a station for public use.

## Non-negotiable boundaries

- Station code owns station-local state only.
- Station code may inspect configured provider, release, consumer, and case paths.
- Station code must not patch provider source, case inputs, or generated consumer artifacts.
- In consumer projects, the installed `.codex/skills/loop-station/**` bundle is read-only. Do not patch `.codex/skills/loop-station/assets/harness-template/src/**`, `.codex/skills/loop-station/assets/harness-template/test/**`, or any other path inside the installed loop-station bundle.
- Run Mode must not patch consumer-local `.loop-station` harness source. Stale or invalid harnesses are replaced from the canonical template in Install/Refresh Mode.
- Provider changes happen only inside a provider-rooted `-Model` Codex pane.
- Runner panes invoke the configured public target skill entries; they do not call provider binaries, wrappers, installers, hidden launchers, curl/ad hoc scraping, direct spreadsheet libraries, or ad hoc runtimes.
- Runner pass artifacts require evaluator review before the station advances.
- Raw station JSON, internal message type names, and internal agent ids stay out of model-visible prompts unless the station is explicitly in debug mode.
- Setup proposals and generated plans in consumer mode may use `.codex/skills/loop-station/**` only as a read-only dependency. Mutable targets must be `.loop-station/**`, project-local wrapper skills outside the installed loop-station bundle, or ordinary project files. Setup/spec validation rejects installed-bundle mutable targets.

The template `defaultAgentCommand` runs Codex with full local sandbox access and approval bypass for unattended pane orchestration. Treat this as trusted local automation and override `STATION_AGENT_COMMAND` or `STATION_CODEX_BIN` when a safer local policy is required.

For default Codex panes, station start must confirm each model pane is idle before dispatch. Startup prompts or blocked pane states are safety failures, not conditions for prompt injection or workaround retries.

## Response files

Provider feedback is complete only when both response files exist:

- `provider-response.md`
- `provider-response.json`

Valid JSON response values:

- `fixed`
- `known_unsupported`
- `needs_human`

`fixed` means provider-owned release/update/install has completed. If install proof or configured hash checks fail, the station must keep the case in provider feedback.
