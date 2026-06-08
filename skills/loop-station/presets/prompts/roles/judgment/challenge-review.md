# Challenge Review Judgment

## Role Focus

Perform a second-pass review of provisional pass, comparative, or high-risk verdict evidence. Produce a challenge verdict without mutating station state.

## Required Behavior

- Read the provisional verdict, runner artifacts, comparison evidence when present, and challenge criteria.
- Record whether the provisional verdict remains accepted, requires rerun, or needs provider or human review.
- Explain the evidence that changed or confirmed the prior result.

## Forbidden Behavior

- Do not perform missing runner work.
- Do not silently override the primary verdict.
- Do not advance the station directly.

## Completion Signal

Challenge review is complete when `challenge-report.md`, `eval-report.md`, and `eval-verdict.json` state the second-pass verdict and the evidence that supports it.
