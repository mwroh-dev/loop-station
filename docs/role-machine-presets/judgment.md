# Judgment Role Machine

## General Concept

The judgment machine evaluates runner output and process evidence. It writes a verdict artifact that the orchestrator can use as a gate.

Judgment is an evaluation authority. It does not execute the runner's task, does not repair provider files, and does not directly advance the station.

## Shared Traits

- Reviews required artifacts, schemas, provenance, and process evidence.
- Separates output quality from process compliance when both matter.
- Writes structured verdict artifacts.
- Explains failures in a way the orchestrator or provider handoff can use.
- Treats missing or stale authoritative artifacts as failure or blocked evidence.
- Checks artifact identity and freshness for the active run, case, stage, attempt, and message.
- Avoids relying on pane transcript summaries when required artifacts disagree.

## Forbidden Responsibilities

- Must not perform missing runner work.
- Must not create runner artifacts to make an attempt pass.
- Must not directly dispatch the next role or mutate station state.
- Must not repair provider source or consumer artifacts.
- Must not accept chat-only self-report as completion evidence.

## Inputs And Outputs

Inputs include runner artifacts, runner metadata and provenance, output manifest, verifier results, pane transcript snippets as diagnostic evidence, stage contract, and expected evidence rules.

Outputs include `eval-report.md`, `eval-verdict.json`, failure reasons, and rerun/provider recommendations when configured.

## Lifecycle And Authority Boundary

Judgment is usually attempt-scoped. It owns verdict production for one attempt or stage. It may recommend rerun, provider repair, human review, or pass, but it does not perform the transition.

## Specialization Candidates

- `artifact-contract`: validates required artifacts, JSON parseability, schemas, and provenance.
- `process-evidence`: checks whether the runner used the permitted skill/runtime boundary.
- `comparative`: compares multiple runner candidates and selects a winner or declares no pass.
- `challenge-review`: reviews a provisional pass and looks for weak evidence before provider or rerun gates.

## Minimum Preset Fields

Future schema fields should include `id`, `role: judgment`, `sharedTraits`, `specialization`, `evidenceInputs`, `verdictSchema`, `passCriteria`, `failureTaxonomy`, `forbiddenResponsibilities`, and `promptReference`.

## Coverage Checklist

A complete judgment preset defines authoritative inputs, freshness checks, allowed verdict values, output-quality versus process-boundary failure, pass/fail/blocked/human-review evidence, allowed recommendations to orchestrator, and safeguards against filling in missing runner work.
