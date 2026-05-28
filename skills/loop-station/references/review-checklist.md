# Review Checklist

Use this before publishing a station template or trusting a generated station.

- Run the full test suite.
- Run `station validate --json` against each public guide fixture config.
- Confirm Skill Contract Discovery ran before interview/setup for every target skill.
- Confirm natural-language setup produced a proposal before creating `.loop-station`, and skill-install-only requests did not create a harness.
- Confirm the project-local `.codex/skills/loop-station` install exists before setup generates `.loop-station`.
- Confirm consumer-mode guidance treats `.codex/skills/loop-station/**` as read-only and never names installed bundle `src/` or `test/` paths as mutable targets.
- Confirm stage contracts include layer authority and human checkpoint evidence requirements.
- Confirm consumer action stages declare public wrapper skills and do not rely on generic prompt-only stage execution.
- Confirm public guide fixtures do not require private paths.
- Confirm runner prompt text contains configured public target skill entries and no internal station JSON.
- Confirm model-visible control lines do not inline raw mailbox JSON and instead point to mailbox request/started/reply paths.
- Confirm runner prompt text includes allowed public runtime boundaries and avoids long forbidden-word policy dumps.
- Confirm runner forbidden guard patterns validate before start and invalid patterns fail with `runner_guard_pattern_invalid`.
- Confirm action-stage required JSON artifacts have declared schemas, and stage advancement is blocked when schema or provenance validation fails.
- Confirm action-stage mailbox activation evidence is present but not treated as proof that the stage skill executed.
- Confirm browser-flow manual capture stops at `awaiting_capture`; direct search URL substitution is not accepted as human browser input.
- Confirm multi-skill stations validate every `targetSkills` entry before dispatch.
- Confirm `targetSkillName` is not combined with `targetSkills`.
- Confirm preset mode is the default public authoring path and any freeform station config is explicitly marked `advanced-legacy`.
- Confirm runner pass artifacts do not advance a case before evaluator pass artifacts.
- Confirm runner artifacts include provenance, and station failures use `loop-station-failure.*` instead of fabricated runner artifacts.
- Confirm `station start` always launches a visible runtime: inside tmux it keeps the operator pane on the left and opens the managed station section on the right using the configured `vertical` or `horizontal` section layout, and outside tmux it surfaces an owned session through an attached terminal window.
- Confirm missing tmux or missing pane targets fail the run instead of falling back to mock panes.
- Confirm model pane startup prompts or blocked readiness states fail before dispatch.
- Confirm queued follow-up text is not treated as automatic contamination; same-pane reuse is allowed only after the previous mailbox task is closed.
- Confirm no same-pane dispatch occurs while the previous mailbox task for that pane is still outstanding.
- Confirm model message activation never advances from raw pane text; every model role writes started JSON before task work.
- Confirm missing started JSON surfaces as `activation_ack_missing`.
- Confirm provider handoff text hides internal agent ids and station message types.
- Confirm stale consumer `.loop-station` harnesses are replaced from the canonical template, not patched in Run Mode.
- Confirm failed cases do not advance before valid provider response files.
- Confirm invalid `fixed` responses create one follow-up and do not dispatch the next case.
- Confirm activation failure handling does not hide failures behind indefinite retry loops; runtime policy either fails fast or performs one recycle attempt.
- Confirm manual `fixed` override requires `--override` and emits an override event.
- Confirm `cleanup` stops tmux sessions and background orchestrator processes.
