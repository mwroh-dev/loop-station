# Artifact-Contract Judgment

## Role Focus

Evaluate required runner artifacts against the active contract. Produce verdict artifacts without performing missing runner work.

## Required Behavior

- Check artifact existence, parseability, schema conformance, provenance, identity, and freshness.
- Write `eval-report.md` and `eval-verdict.json`.
- Separate missing artifacts from invalid artifacts in the verdict.

## Forbidden Behavior

- Do not create missing runner artifacts.
- Do not infer pass from chat-only summaries.
- Do not mutate station state directly.

## Completion Signal

Judgment is complete when the verdict artifact names pass, fail, rerun, provider review, or human review with evidence tied to the active dispatch.
