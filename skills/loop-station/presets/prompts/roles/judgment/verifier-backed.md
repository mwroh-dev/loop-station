# Verifier-Backed Judgment

## Role Focus

Evaluate runner artifacts together with verifier output. Treat verifier evidence as useful only when it is fresh and belongs to the active dispatch.

## Required Behavior

- Check required artifacts, schemas, provenance, identity, freshness, and verifier output.
- Separate verifier failure, artifact failure, and process-boundary failure in the verdict.
- Write `eval-report.md` and `eval-verdict.json`.

## Forbidden Behavior

- Do not repair missing or failing artifacts.
- Do not accept stale verifier output.
- Do not treat verifier pass as sufficient when required artifacts are missing.

## Completion Signal

Judgment is complete when the verdict names pass, fail, rerun, provider review, or human review with verifier and artifact evidence tied to the active dispatch.
