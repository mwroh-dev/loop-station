# Preset Materialization

## Materialized Copy Shape

During setup, the accepted recommendation materializes resolved presets under `.loop-station`.

```json
{
  "sourcePresetId": "runner.stage-bound-action",
  "role": "runner",
  "level": 3,
  "resolvedSharedTraits": {},
  "resolvedSpecialization": {},
  "selectedBecause": {
    "score": 84,
    "confidence": "high",
    "reason": "Natural-language recommendation reason."
  },
  "stationLocalEditing": {
    "editableAfterSetup": true
  },
  "selfReview": {
    "completedAtSetup": true,
    "findings": []
  }
}
```

Materialized copies are explanatory station-local state. `station.json` remains the executable runtime configuration. Built-in catalog files remain canonical.

## Station-Local Editing Policy

Station-local edits should be reviewed before the station is rerun. Usually safe edits include wording, display title, prompt reference, and additional non-conflicting evidence requirements. Edits that need review include timeout hints, artifact additions, signal tuning, and compatibility notes.

Reject edits that remove shared forbidden responsibilities, grant final judgment to runner, allow private provider shortcuts, skip required provenance, or disable human checkpoint evidence.

The setup flow should not maintain a separate override file because that creates two competing descriptions of the same role. The materialized role preset is the editable local copy.
