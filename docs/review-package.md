# Review Package

Use this document to review Loop Station in a fresh session.

## What to review

- Public CLI: `loop-station install`, `loop-station install --replace`, low-level `loop-station init`, `loop-station interview`, and generated `station` commands.
- Positioning: generic kernel + typed preset profiles first, with `advanced-legacy` freeform configs retained only for compatibility.
- Runtime state machine: one active case or stage lane, runner artifact candidates, required evaluator gate, provider/judge/action gates.
- Recovery path: provisional-pass challenge review, provider-engineer fix/install, deploy verification, then rerun.
- Target skill contract: `.codex/skills/<name>` default, multi-skill `targetSkills` validation, and valid `SKILL.md` front matter.
- Prompt boundary: model-visible text should not include raw station JSON, internal message payloads, or internal agent ids.
- Provider authority: station code sends evidence but does not patch provider source.
- Public guide fixtures: preset examples ship `reset.sh`, `run-tmux.sh`, and `reset-and-run.sh` so a user can reset prior state and launch a visible runtime from the example directory.

## Public API

- Root CLI:
  - `loop-station install [--project <dir>] [--replace]`
  - `loop-station init <dir> [--force]`
  - `loop-station interview`
- Generated harness CLI:
  - `station validate [--json] [--skip-tools]`
  - `station start --limit N`
  - `station run-next [--dispatch-only]`
  - `station status`
  - `station attach`
  - `station stop`
  - `station cleanup`
  - `station provider-response <case-id> <fixed|known_unsupported|needs_human> [--override]`
  - `station smoke-run-one`

## Known risks

- Tool availability validation reports `tmux` and `codex`, but tests use `--skip-tools` for portability.
- Deterministic tests validate station structure and the public guide fixture. Full live Codex/tmux model-pane runs are operator-driven through the example `reset-and-run.sh` entrypoint.
- Root CLI is intentionally small and does not yet publish an npm package.
- Local tmux orchestration is the only supported runtime, and the public runtime surface is always visible.
- Project installs create `.loop-station` and must not overwrite existing station config/runs by default; destructive test refreshes use `--replace` and do not keep `.loop-station_temp*` backups.
- Runner pass artifacts are intentionally insufficient without evaluator artifacts; older custom stations may need their flow configs updated.
- Stale consumer harnesses must be replaced from the canonical template instead of patched in Run Mode.
- The template `defaultAgentCommand` uses full local sandbox access and approval bypass for unattended model panes; review `STATION_AGENT_COMMAND` before running against untrusted workspaces.

## Review commands

```bash
npm test
STATION_CONFIG=examples/echo-skill-loop/station.json node skills/loop-station/assets/harness-template/bin/station validate --json --skip-tools
node skills/loop-station/assets/harness-template/bin/station smoke-run-one
```
