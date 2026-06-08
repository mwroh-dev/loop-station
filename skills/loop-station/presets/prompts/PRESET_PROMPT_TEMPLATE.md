# <Preset Title>

Use this template when authoring a role preset prompt. The prompt file is the model-facing guidance source for the preset referenced by `promptReference`.

## Role Focus

Describe the role specialization in one short paragraph. State what this role owns inside the station loop.

## Required Behavior

- Name the evidence the role must read before acting.
- Name the artifacts the role must produce or preserve.
- Name when the role must stop, pause, report, or hand off.

## Forbidden Behavior

- Name responsibilities this role must not take over from adjacent role machines.
- Name any synthetic evidence, hidden repair, or state mutation the role must not perform.

## Completion Signal

Describe the minimal model-visible condition that means this role has finished its assigned responsibility.
