# AGENTS.md

## Core

- This repository maintains the `loop-station` Codex skill and its vendored `.loop-station` harness template.
- Use Node.js 20 or newer.
- Keep `skills/loop-station` as the canonical skill source and packaging root.
- Keep `SKILL.md` focused on user-facing skill activation, workflows, authority boundaries, and references.
- Keep Codex/repository development instructions in this `AGENTS.md`, not in `SKILL.md`.
- Preserve `skills/loop-station/agents/openai.yaml` when changing skill packaging metadata.

## Verification

- Run `npm test` after changing JavaScript, harness behavior, examples, or skill instructions.
- Run `npm run validate:template` after changing harness template configuration or validation behavior.

## Safety Boundaries

- Station code may write station-local state and run files only.
- Do not make station code patch provider source, case inputs, or generated consumer artifacts.
- Runner prompts must invoke the configured `$targetSkillName` inside Codex when a target skill is configured.
- Runner prompts must not bypass `$targetSkillName` with provider binaries, wrappers, installers, hidden launchers, or ad hoc scripts.
- Keep raw station control JSON, internal message type names, and internal agent ids out of model-visible prompts unless explicitly implementing debug behavior.

## Documentation Consistency

- When changing runtime behavior, update both the implementation and the relevant contract documentation.
- Keep `docs/runtime-contract.md`, `docs/security-boundaries.md`, and `docs/review-checklist.md` aligned with their matching files under `skills/loop-station/references/`.
- Public guide fixtures must not depend on private provider paths, private repositories, or local-only credentials.
