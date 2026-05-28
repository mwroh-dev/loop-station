# Skill Contract Discovery

Loop Station must discover target skill contracts before interview, install, refresh, or run setup. The user should be able to describe a workflow in natural language without knowing a target skill's phases, internal runtime boundary, required artifacts, or human checkpoints.

## Purpose

Skill Contract Discovery turns installed or source target skills into an executable station spec. It happens before the station asks detailed interview questions so Loop Station can ask only questions that the skill contracts cannot answer.

Discovery must answer:

- which public entry docs define the skill
- which callable runtime boundaries are public and skill-owned
- which paths are hidden launchers or provider internals
- which phases must run, in order
- which steps are deterministic runtime steps, LLM judgment steps, or human checkpoints
- which actor is allowed to perform each phase or browser action
- which artifacts prove each phase ran correctly
- which outputs can be handed to the next stage
- which missing public capabilities require provider feedback

## Contract Shape

Generated station specs may include:

```json
{
  "skillProfiles": [
    {
      "name": "$browser-flow",
      "installPath": "<consumerRoot>/.codex/skills/browser-flow",
      "publicEntryDocs": ["SKILL.md", "prompt.md", "references/*.md"],
      "allowedPublicRuntimeCalls": ["node .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs ..."],
      "forbiddenBypasses": ["hidden launchers", "provider binaries", "ad hoc scripts"],
      "phases": ["capture", "analyze", "generate", "verify", "extract"],
      "phaseContracts": [
        {
          "id": "capture",
          "allowedActor": "human_user",
          "captureMode": "human_manual",
          "checkpoint": "awaiting_capture",
          "requiredEvidence": ["human_checkpoint_evidence"],
          "mayAdvanceWhen": "human_capture_completed"
        }
      ],
      "inputs": [],
      "outputs": [],
      "requiredEvidence": ["reports/verification.json", "extract-result.json"],
      "humanCheckpoints": [],
      "llmDelegableCheckpoints": [],
      "deterministicSteps": [],
      "capabilityGaps": [],
      "downstreamContract": {}
    }
  ]
}
```

`stageContracts[]` should reference the matching profile through these fields when relevant:

- `phaseContracts`
- `allowedPublicRuntimeCalls`
- `humanCheckpoints`
- `llmDelegableCheckpoints`
- `deterministicSteps`
- `requiredEvidence`
- `capabilityGaps`
- `downstreamContract`

## Layer Authority

Each phase contract must name the actor allowed to perform it:

- `human_user`: the user must operate the visible browser or make the checkpoint decision.
- `station_capture_controller`: deterministic station-owned CDP automation explicitly selected by the user.
- `runner_model`: the runner may coordinate public skill calls and write runner artifacts.
- `skill_runtime`: the public skill runtime may run deterministic phase commands.
- `evaluator_model`: evaluator-only judgment.

For browser-flow, external manual capture defaults to `human_user`. The runner may call `prepare`, then must stop at `awaiting_capture` until human checkpoint evidence exists. It must not synthesize search-result URLs, type into pages, click, call `done`, analyze, generate, verify, or extract as a substitute for the user's manual browser action. Automation-driven capture is allowed only when the generated spec records `captureMode: "station_cdp_automation"` and the Station-owned controller writes provenance.

## Public Runtime Boundary

A callable runtime named by the public skill entry is not a bypass. It is a skill-owned public execution boundary even when it lives under a path such as `bundle/runtime`.

Discovery must distinguish:

- allowed: commands explicitly documented by the public entry, prompt, manifest, or public references
- forbidden: hidden provider launchers, provider binaries, installer shortcuts, compatibility wrappers, direct spreadsheet libraries, curl/ad hoc scraping, or commands discovered by searching internals instead of following the public entry

Runner prompts should state the allowed public boundaries and avoid dumping long forbidden-word lists into model-visible text. Guards must inspect execution evidence, command transcript, and artifact provenance rather than failing because policy text contains a forbidden word.

## Multi-Phase Skills

Multi-phase skills must not be collapsed into one vague action. For a skill like browser-flow, discovery must preserve:

```text
capture -> analyze -> generate -> verify -> optional extract
```

For DATA requests such as lists, rows, current values, prices, tables, or search results, discovery should require the Extract phase and include its output artifact in the downstream contract. If capture needs a visible browser, discovery must mark whether the checkpoint requires a human, can be delegated to explicit Station-owned automation, or must stop with `needs_human`.

## Capability-Gated Skills

Runner panes do not make final unsupported decisions for provider-owned capability gaps. If a public skill entry lacks a needed capability, the runner writes capability-gap evidence and stops for evaluator/provider review.

Evaluator and provider gates decide whether the result is:

- `pass`
- `fail`
- `needs_human`
- `capability_gap`
- `provider_required`

Provider-required gaps should be routed to the provider feedback loop instead of being silently worked around with direct libraries or hidden runtimes.

## Setup Gate

Natural-language workflow requests do not create `.loop-station` immediately. The required order is:

1. Verify or install the requested project-local target skills only.
2. Run Skill Contract Discovery.
3. Present a setup proposal with target skills, stage contracts, actor authority, human checkpoints, output paths, and refresh/install mode.
4. Ensure the project-local `.codex/skills/loop-station` install already exists.
5. Generate or replace `.loop-station` only after the user confirms the proposal or explicitly requests refresh/setup.

A request to install skills such as `browser-flow`, `sheet-ops`, or `loop-station` installs `.codex/skills/*` only. It must not install `.loop-station`. For loop-station itself, setup must fail until the project-local skill install under `.codex/skills/loop-station` exists.

In consumer projects, discovery and proposal generation must treat `.codex/skills/loop-station/**` as a read-only dependency surface only. They must never emit `.codex/skills/loop-station/assets/harness-template/src/**`, `.codex/skills/loop-station/assets/harness-template/test/**`, or any installed loop-station bundle path as a mutable implementation target. Mutable targets must be `.loop-station/**`, project-local wrapper skills outside the installed loop-station bundle, or ordinary project files. Setup/spec validation rejects these installed-bundle edit targets.

## Refresh Procedure

For destructive test refreshes:

1. Delete existing `.loop-station`.
2. Delete existing project-local target skill installs that are being tested.
3. Reinstall `browser-flow`, `sheet-ops`, `loop-station`, or other target skills from their release/canonical sources.
4. Reinstall the canonical harness with `loop-station install --replace --project <dir>`.
5. Run Skill Contract Discovery again.
6. Generate station config and cases from the newly discovered profiles.
7. Validate the station.
8. Confirm no `.loop-station_temp*` backup remains.
