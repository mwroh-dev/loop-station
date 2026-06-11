# Defect Fix Verification — 2026-06

History and methodology for the runtime defect sweep on branch `fix/critical-major-defects`.
Two commits fix 7 critical/major + 6 minor defects; this doc records what changed, how each
fix was verified, and a reusable live-verification procedure for future runtime fixes.

## Commits

| Commit | Scope |
|--------|-------|
| `fix critical and major runtime defects` | C1, C2, M1, M2, M3, M4, M5 |
| `harden polling, classification, and cli option handling` | 6 minor hardening items |

### Critical / Major

- **C1 — `transitionMessage` protected-field overwrite** (`src/message-lifecycle.js`):
  the caller `body` was spread after structural fields, so a stray `state`/`id`/`caseId`
  key could silently corrupt message identity and stall the orchestrator. Added a
  protected-key deny-list that throws instead.
- **C2 — codex model shell injection** (`src/tmux-station.js`): `profile.model` and
  `profile.model_reasoning_effort` were interpolated into an `sh -lc` string unescaped.
  Added an allowlist (`/^[A-Za-z0-9._:-]+$/`) that rejects unsafe values before any shell use.
- **M1 — non-atomic writes + silent message loss** (`src/fs.js`, `src/message-lifecycle.js`):
  `writeJson` now writes a temp file and `renameSync`s it into place; `readMessages`
  distinguishes "file absent" (`[]`) from "file corrupted" (throws) so a partial write no
  longer gets overwritten with a fresh one-element array.
- **M2 — silent deadlock on unknown stage** (`src/cli.js`): the non-managed `tickRun` now
  throws on an unrecognized `activeStageId` instead of returning `false` forever.
- **M3 — hardcoded agent names** (`src/cli.js`): non-managed runner/evaluator dispatch and
  the bypass-detection pane lookup now resolve names from config
  (`runnerAgentName`/`evaluatorAgentName`) instead of the literal `RunnerAgent-Model` /
  `EvaluatorAgent-Model`.
- **M4 — `normalizeSetupLocations` no-op** (`bin/loop-station`): the ternary had identical
  branches; restored `resolve(project, value)` so spec-relative locations become absolute
  in the generated `station.json`.
- **M5 — template copy includes `node_modules`** (`bin/loop-station`): added `node_modules`
  to the template-copy exclusion list.

### Minor hardening

- `artifact-awaiter`: tolerate a file vanishing between `existsSync` and `readFileSync`
  (write-then-rename) instead of crashing the poll loop.
- `pane-watcher`: classify only the last 40 captured lines so stale scrollback (an old
  `Working` line) cannot mask the pane's current state.
- `orchestrator`: exponential backoff while ticks fail persistently (2s → 30s) so a broken
  run does not flood logs at full poll speed.
- `tmux-station`: replaced the blocking `Atomics.wait` pane-ready loop with `async` sleep
  (`respawnAgentPane`/`waitForPaneReady` are now async).
- `completion`: guard the `dispatch.json` read during action-stage inspection.
- `bin/loop-station`: `readOption` errors clearly (`Missing value for --x`) when a flag has
  no value instead of throwing an opaque `resolve(undefined)`.

## Verification methodology

Two layers, because neither alone is sufficient:

1. **Unit / integration** (`npm run verify:full` → 173 tests + full template validate).
   Pins each fix as a regression guard. New tests: C1 protected-field throw, C2 unsafe-model
   throw, M1 corrupted-`messages.json` surfacing, M4 location resolve, pane tail
   classification, CLI missing-option error.
2. **Live verification.** CI cannot stand up a real tmux + Codex loop, and a unit test cannot
   prove that an LLM-driven harness run actually exercises the patched code path. So the fixes
   were also run through a real Codex loop and probed with deliberate traps.

### Why path matters: managed vs non-managed

A fix only counts as "live-verified" if the live run actually reaches it. Loop Station has two
tick paths:

- **managed** (`tickManagedRun`) — taken when `profileMode === "preset"` or when
  `layout.groups` is set. Resolves agent names from config already.
- **non-managed** (`tickRun` branches) — legacy/advanced configs.

M2 and M3 live in the **non-managed** path. A preset live run uses the managed path, so a
preset run does **not** exercise those two fixes. Always confirm which path your config takes
before claiming a live run covered a fix.

### Live procedure (reusable)

Driving the bundled `examples/echo-skill-loop` headlessly:

1. `./reset.sh` to clear prior runs.
2. Start inside a tmux session so `createTmuxStation` borrows it (it splits observable panes).
   Note: `run-tmux.sh` uses `start --attach`, which fails with "no current client" against a
   **detached** tmux session (`switch-client` needs an attached client). For headless
   observation, run `boot`/`start` to create panes, then drive ticks manually.
3. The echo station has no `runtime.autoDispatch`, so the background orchestrator only
   heartbeats — dispatch is driven by `station run-next`. Stop the orchestrator
   (`station stop`) and call `run-next` per step to advance deterministically.
4. Observe each pane with `tmux capture-pane -t <pane> -p`. Verify by artifacts, not chat:
   runner writes `echo.txt` + `runner-*.json` + `output-manifest.json`; judgment writes
   `eval-verdict.json`; the case reaches `case_passed`.

Trap technique: to verify a guard, feed the input it is supposed to reject. C2 was verified by
injecting `model: "<good>; touch <sentinel>"` into the real installed module's
`createTmuxStation` and confirming it throws **and** the sentinel file is never created.

## Results

| Fix | How verified | Status |
|-----|--------------|--------|
| C1 | full live loop + `smoke-run-one`: structural fields intact across all transitions | ✅ live |
| C2 | real pane-spawn path: clean model passes as `-m`, malicious value rejected, no execution | ✅ live (trap) |
| M1 | real concurrent run: all state files parse, no partial-write corruption | ✅ live |
| M2 | non-managed path; not reached by preset run — covered by unit test only | ⚠️ unit only |
| M3 | non-managed path; managed path was already correct — unit/integration only | ⚠️ unit only |
| M4 | canonical `setup` CLI: relative location resolves to absolute | ✅ live |
| M5 | template has no `node_modules`, so only weakly exercised | ⚠️ weak |
| minors | exercised in the full live loop (dispatch, real-pane classification, async respawn) | ✅ live |

Full live loop outcome: a real Codex runner invoked the target skill and wrote `alpha` plus
artifacts, a real Codex judge returned `verdict: pass`, and the case finished `case_passed`
with zero tick failures — no recurrence of any fixed defect.

### Open gaps

- **M2 / M3** need a legacy (non-preset) station config to exercise live; not yet done.
- **M5** needs a dummy `node_modules` planted in the template to prove the exclusion live.

## Observations (not defects)

- Install Mode lets the model hand-assemble `.loop-station` (via `cp -R` + manual config)
  instead of driving the canonical `setup` CLI. The result validates but omits the preset
  materialization (`presets/recommendation.json`, `presets/roles/*`) that `setup` produces.
  This is a skill-guidance gap, not a runtime defect.
- `start --attach` assumes an attached tmux client; it cannot attach to a detached session.
