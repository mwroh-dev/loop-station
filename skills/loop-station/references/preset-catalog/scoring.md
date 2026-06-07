# Preset Catalog Scoring

## Scoring Model

Recommendation scoring is explicit and inspectable. A candidate score is a 0-100 value derived from setup signals and compatibility checks.

| Dimension | Weight | Evidence |
| --- | ---: | --- |
| Signal match | 35 | Preset signals match normalized setup signals. |
| Authority fit | 20 | Preset respects mutation, checkpoint, and role boundaries. |
| Evidence fit | 20 | Preset can produce or evaluate required artifacts and provenance. |
| Compatibility | 15 | Preset works with selected role peers and loop profile. |
| Maturity level | 10 | Preset `level` is high enough for recommendation. |

Confidence maps from score: `high` is 80-100, `medium` is 60-79, `low` is 40-59, and `notRecommended` is below 40.

## Hard Rejects

Hard authority violations override score and remove the candidate from recommendation. Examples include runner final judgment, judgment performing missing runner work, or orchestrator fabricating model artifacts. Current hard rejects also include blocked preset ids and blocked responsibilities supplied by setup.

## Tie-Breaks

When scores are close, setup should prefer higher authority fit, higher evidence fit, higher level, lower complexity, and existing loop profile compatibility. A candidate within 5 points of the selected preset should be shown as a meaningful alternate.

## Helper Boundary

`skills/loop-station/presets/catalog.js` loads generated catalog artifacts, scores candidates, and returns per-role recommendation bundles. It does not mutate runtime config or make setup UX decisions by itself.
