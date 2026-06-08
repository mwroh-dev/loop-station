const ROLE_TYPE_VALUES = [
  "orchestrator",
  "runner",
  "judgment"
];

export const ROLE_TYPES = Object.freeze({
  ORCHESTRATOR: "orchestrator",
  RUNNER: "runner",
  JUDGMENT: "judgment"
});

export const ROLE_TYPE_ORDER = Object.freeze([...ROLE_TYPE_VALUES]);

export const ROLE_FAMILIES = Object.freeze({
  MANAGER: "manager",
  PERFORMER: "performer",
  EVALUATOR: "evaluator"
});

export const ROLE_FAMILY_BY_ROLE = Object.freeze({
  [ROLE_TYPES.ORCHESTRATOR]: ROLE_FAMILIES.MANAGER,
  [ROLE_TYPES.RUNNER]: ROLE_FAMILIES.PERFORMER,
  [ROLE_TYPES.JUDGMENT]: ROLE_FAMILIES.EVALUATOR
});

export function isRoleType(value) {
  return ROLE_TYPE_VALUES.includes(value);
}

export const SHARED_TRAIT_PACKS = Object.freeze({
    "orchestrator": {
      "id": "orchestrator.shared",
      "role": "orchestrator",
      "roleFamily": "manager",
      "title": "Shared Orchestrator Traits",
      "level": 3,
      "autonomyLevel": 2,
      "purpose": "Own station state transitions, dispatch gates, pause/rerun decisions, and handoff boundaries without performing model-owned work.",
      "autonomyEvidence": [
        "active dispatch identity",
        "activation evidence",
        "required artifacts",
        "judgment verdict"
      ],
      "autonomyLimits": [
        "cannot execute runner work",
        "cannot fabricate model artifacts",
        "cannot skip gates without explicit policy and evidence"
      ],
      "authority": [
        "track_active_run_case_stage_attempt_message",
        "dispatch_bounded_task_envelopes",
        "gate_progress_on_activation_artifacts_verifier_and_judgment",
        "apply_retry_rerun_pause_handoff_policy",
        "write_station_events_and_station_owned_failures"
      ],
      "forbiddenResponsibilities": [
        "runner_task_execution",
        "runner_artifact_fabrication",
        "judgment_verdict_fabrication",
        "provider_source_patch",
        "case_input_patch",
        "consumer_generated_artifact_patch",
        "raw_control_json_exposure_without_debug_mode"
      ],
      "requiredEvidence": [
        "activeRunId",
        "caseId",
        "stageId",
        "attempt",
        "messageId",
        "mailboxStarted",
        "mailboxReply",
        "requiredArtifacts",
        "judgmentVerdict"
      ],
      "lifecycleDefaults": [
        "run-scoped"
      ],
      "recommendationSignals": {
        "transitionStyle": [
          "strict-sequential",
          "recovery",
          "human-gated",
          "multi-stage"
        ],
        "failurePath": [
          "stop",
          "retry",
          "recycle-pane",
          "provider-handoff",
          "deploy-verify",
          "human-pause"
        ]
      },
      "scoringHints": {
        "authorityFitMinimum": 20,
        "evidenceFitRequires": [
          "activation evidence",
          "artifact evidence",
          "judgment evidence"
        ],
        "hardRejects": [
          "fabricates model artifacts",
          "advances from pane text only",
          "patches provider or case files"
        ]
      },
      "selfReviewChecklist": [
        "Defines the evidence that opens and closes active task slots.",
        "Keeps model task execution outside orchestrator authority.",
        "Keeps raw station control JSON out of model-visible prompts by default.",
        "Defines what failure evidence leads to pause, rerun, handoff, or stop.",
        "Preserves deterministic station behavior as distinct from model guidance."
      ]
    },
    "runner": {
      "id": "runner.shared",
      "role": "runner",
      "roleFamily": "performer",
      "title": "Shared Runner Traits",
      "level": 3,
      "autonomyLevel": 2,
      "purpose": "Execute exactly one assigned case, stage, or task through the allowed public boundary and produce required runner-owned artifacts.",
      "autonomyEvidence": [
        "assigned task envelope",
        "allowed public skill or runtime boundary",
        "runner artifact provenance"
      ],
      "autonomyLimits": [
        "cannot make final station verdict",
        "cannot advance station state",
        "cannot expand into unassigned work"
      ],
      "authority": [
        "execute_assigned_task",
        "invoke_configured_public_skill_or_allowed_runtime",
        "write_runner_artifacts",
        "report_blocked_failed_or_unsupported_work",
        "record_human_checkpoint_evidence_when_required"
      ],
      "forbiddenResponsibilities": [
        "final_judgment",
        "station_advance",
        "provider_repair",
        "case_input_patch",
        "provider_source_patch",
        "consumer_generated_artifact_patch",
        "target_skill_bypass",
        "human_checkpoint_replacement"
      ],
      "requiredEvidence": [
        "messageId",
        "agentName",
        "phaseEvidence",
        "skillRuntimeEvidence",
        "runner-report.md",
        "runner-metadata.json",
        "output-manifest.json"
      ],
      "lifecycleDefaults": [
        "attempt-scoped",
        "stage-scoped"
      ],
      "recommendationSignals": {
        "workUnitShape": [
          "single-case",
          "repeated-case",
          "ordered-stage",
          "parallel-candidate",
          "human-checkpoint"
        ],
        "runtimeBoundary": [
          "public-skill-only",
          "allowed-runtime-call",
          "human-owned-runtime",
          "station-owned-runtime"
        ],
        "mutationBoundary": [
          "consumer-output",
          "no-mutation"
        ]
      },
      "scoringHints": {
        "authorityFitMinimum": 20,
        "evidenceFitRequires": [
          "runner artifacts",
          "provenance",
          "skill runtime evidence"
        ],
        "hardRejects": [
          "performs final judgment",
          "continues into unassigned stages",
          "bypasses configured target skills",
          "replaces human-owned checkpoints"
        ]
      },
      "selfReviewChecklist": [
        "Defines the smallest assigned unit of work.",
        "Names the allowed public skill or runtime boundary.",
        "Requires provenance for runner-owned artifacts.",
        "Reports blockers through artifacts instead of chat-only status.",
        "Stops at human-owned checkpoints when required.",
        "Prevents judging, repairing, or advancing the station."
      ]
    },
    "judgment": {
      "id": "judgment.shared",
      "role": "judgment",
      "roleFamily": "evaluator",
      "title": "Shared Judgment Traits",
      "level": 3,
      "autonomyLevel": 3,
      "purpose": "Evaluate runner output and process evidence for the active dispatch, then write verdict artifacts without executing runner work or mutating station state.",
      "autonomyEvidence": [
        "runner artifacts",
        "runner metadata",
        "artifact identity and freshness",
        "verdict schema"
      ],
      "autonomyLimits": [
        "cannot execute missing runner work",
        "cannot repair provider source",
        "cannot directly advance station state"
      ],
      "authority": [
        "evaluate_runner_artifacts",
        "evaluate_process_evidence",
        "validate_artifact_identity_and_freshness",
        "write_judgment_artifacts",
        "recommend_pass_fail_rerun_provider_or_human_review"
      ],
      "forbiddenResponsibilities": [
        "runner_task_execution",
        "runner_artifact_fabrication",
        "station_advance",
        "provider_repair",
        "case_input_patch",
        "consumer_generated_artifact_patch",
        "chat_only_completion_acceptance"
      ],
      "requiredEvidence": [
        "activeRunId",
        "caseId",
        "stageId",
        "attempt",
        "messageId",
        "runner-report.md",
        "runner-metadata.json",
        "output-manifest.json",
        "eval-report.md",
        "eval-verdict.json"
      ],
      "lifecycleDefaults": [
        "attempt-scoped"
      ],
      "recommendationSignals": {
        "evidenceStrictness": [
          "artifacts-only",
          "schema-validated",
          "provenance-required",
          "verifier-required",
          "human-evidence-required"
        ],
        "comparisonNeed": [
          "none",
          "runner-candidates",
          "challenge-review",
          "judge-panel"
        ]
      },
      "scoringHints": {
        "authorityFitMinimum": 20,
        "evidenceFitRequires": [
          "authoritative runner artifacts",
          "artifact freshness",
          "verdict schema"
        ],
        "hardRejects": [
          "performs missing runner work",
          "creates runner artifacts",
          "mutates station state",
          "accepts chat-only self report"
        ]
      },
      "selfReviewChecklist": [
        "Defines authoritative artifact inputs.",
        "Checks run, case, stage, attempt, message, and agent identity when available.",
        "Separates output quality failure from process-boundary failure.",
        "Writes structured verdict artifacts.",
        "Recommends transitions without directly mutating station state.",
        "Does not fill in missing runner work."
      ]
    }
  });

export const ROLE_PRESET_DEFINITIONS = Object.freeze({
    "orchestrator": [
      {
        "id": "orchestrator.human-gated",
        "role": "orchestrator",
        "roleFamily": "manager",
        "title": "Human-Gated Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "autonomyLevel": 3,
        "specialization": "human-gated",
        "purpose": "Pause at human-owned checkpoints and resume only after explicit checkpoint evidence belongs to the active dispatch.",
        "autonomyEvidence": [
          "checkpoint request",
          "checkpoint evidence",
          "active dispatch identity",
          "judgment verdict"
        ],
        "autonomyLimits": [
          "cannot automate human-owned actions",
          "cannot resume without matching checkpoint evidence",
          "cannot treat silence as approval"
        ],
        "signals": {
          "transitionStyle": [
            "human-gated",
            "strict-sequential"
          ],
          "failurePath": [
            "human-pause",
            "retry",
            "stop"
          ],
          "workUnitShape": [
            "human-checkpoint",
            "ordered-stage"
          ]
        },
        "authority": {
          "adds": [
            "human_checkpoint_pause",
            "checkpoint_evidence_gate",
            "resume_after_human_evidence"
          ],
          "forbids": [
            "auto_complete_human_checkpoint",
            "advance_without_checkpoint_evidence"
          ]
        },
        "artifacts": {
          "required": [
            "dispatch-request.json",
            "checkpoint-request.json",
            "checkpoint-evidence.json",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "workUnitShape == human-checkpoint",
            "evidenceStrictness == human-evidence-required"
          ],
          "avoidWhen": [
            "runtimeBoundary == station-owned-runtime",
            "workUnitShape == parallel-candidate"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "human_checkpoint_stop",
            "checkpoint_evidence_recording"
          ],
          "compatibleRunnerCapabilities": [
            "human_checkpoint"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/orchestrator/human-gated.md",
        "selfReviewChecklist": [
          "Human-owned actions remain human-owned.",
          "Resume requires checkpoint evidence for the active run, case, stage, and message.",
          "Automation cannot replace the checkpoint.",
          "Ambiguous checkpoint evidence pauses instead of advancing."
        ]
      },
      {
        "id": "orchestrator.multi-stage",
        "role": "orchestrator",
        "roleFamily": "manager",
        "title": "Multi-Stage Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "autonomyLevel": 2,
        "specialization": "multi-stage",
        "purpose": "Dispatch ordered stage contracts one at a time and prevent a runner from continuing into unassigned stages.",
        "autonomyEvidence": [
          "stage contract",
          "active stage identity",
          "runner metadata",
          "judgment verdict"
        ],
        "autonomyLimits": [
          "cannot skip stage gates",
          "cannot open later stages before the active stage closes",
          "cannot advance from runner self-report alone"
        ],
        "signals": {
          "transitionStyle": [
            "multi-stage",
            "strict-sequential"
          ],
          "failurePath": [
            "retry",
            "stop"
          ],
          "workUnitShape": [
            "ordered-stage"
          ]
        },
        "authority": {
          "adds": [
            "stage_order_gate",
            "single_active_stage",
            "stage_contract_dispatch"
          ],
          "forbids": [
            "skip_stage_gate",
            "runner_continues_unassigned_stage"
          ]
        },
        "artifacts": {
          "required": [
            "stage-contract.json",
            "dispatch-request.json",
            "runner-metadata.json",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "stageContracts.length > 0",
            "workUnitShape == ordered-stage"
          ],
          "avoidWhen": [
            "workUnitShape == single-case",
            "transitionStyle == human-gated"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "execute_one_stage",
            "stop_after_assigned_stage"
          ],
          "compatibleRunnerCapabilities": [
            "stage_bound_action",
            "human_checkpoint"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/orchestrator/multi-stage.md",
        "selfReviewChecklist": [
          "Stage order is explicit and deterministic.",
          "The runner sees only the assigned stage boundary.",
          "Stage completion requires current artifacts and judgment.",
          "A later stage is never dispatched before the previous gate closes."
        ]
      },
      {
        "id": "orchestrator.strict-sequential",
        "role": "orchestrator",
        "roleFamily": "manager",
        "title": "Strict Sequential Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "autonomyLevel": 2,
        "specialization": "strict-sequential",
        "purpose": "Run one active case or stage at a time and advance only after activation, artifact, verifier, and judgment gates are satisfied.",
        "autonomyEvidence": [
          "mailbox activation",
          "mailbox reply",
          "required artifacts",
          "judgment verdict"
        ],
        "autonomyLimits": [
          "cannot dispatch parallel active cases",
          "cannot advance without judgment verdict",
          "cannot use pane text as final proof"
        ],
        "signals": {
          "transitionStyle": [
            "strict-sequential"
          ],
          "failurePath": [
            "stop",
            "retry"
          ],
          "workUnitShape": [
            "single-case",
            "repeated-case",
            "ordered-stage"
          ]
        },
        "authority": {
          "adds": [
            "single_active_dispatch",
            "judgment_required_advance",
            "deterministic_retry_limit"
          ],
          "forbids": [
            "parallel_active_case_dispatch",
            "advance_without_judgment_verdict"
          ]
        },
        "artifacts": {
          "required": [
            "dispatch-request.json",
            "mailbox-started.json",
            "mailbox-reply.json",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "workUnitShape in [single-case,repeated-case,ordered-stage]",
            "comparisonNeed == none"
          ],
          "avoidWhen": [
            "transitionStyle == human-gated",
            "comparisonNeed in [runner-candidates,judge-panel]"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "bounded_task_execution",
            "runner_artifacts"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "stage_bound_action"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/orchestrator/strict-sequential.md",
        "selfReviewChecklist": [
          "Only one active dispatch can be open.",
          "Every advance is tied to a current judgment verdict.",
          "Missing activation or stale artifacts stop or retry instead of advancing.",
          "Runner self-report is never treated as final completion."
        ]
      },
      {
        "id": "orchestrator.recovery-rerun",
        "role": "orchestrator",
        "roleFamily": "manager",
        "title": "Recovery Rerun Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "autonomyLevel": 3,
        "specialization": "recovery-rerun",
        "purpose": "Route failed or blocked attempts through retry, rerun, pause, provider handoff, or stop policy based on current failure evidence.",
        "autonomyEvidence": [
          "failed eval-verdict.json",
          "runner-metadata.json",
          "retry history",
          "provider response evidence when required"
        ],
        "autonomyLimits": [
          "cannot patch provider source",
          "cannot retry past configured policy",
          "cannot mark provider repair complete without required evidence"
        ],
        "signals": {
          "transitionStyle": [
            "recovery",
            "strict-sequential"
          ],
          "failurePath": [
            "retry",
            "provider-handoff",
            "deploy-verify",
            "stop"
          ],
          "workUnitShape": [
            "single-case",
            "repeated-case"
          ]
        },
        "authority": {
          "adds": [
            "failure_evidence_router",
            "retry_rerun_gate",
            "provider_handoff_gate"
          ],
          "forbids": [
            "provider_source_patch",
            "rerun_without_failure_evidence"
          ]
        },
        "artifacts": {
          "required": [
            "eval-verdict.json",
            "runner-metadata.json",
            "provider-response.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "transitionStyle == recovery",
            "failurePath in [provider-handoff,deploy-verify,retry]"
          ],
          "avoidWhen": [
            "comparisonNeed in [runner-candidates,judge-panel]",
            "workUnitShape == human-checkpoint"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "runner_artifacts",
            "skill_runtime_evidence"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "stage_bound_action"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence",
            "verifier_backed"
          ]
        },
        "promptReference": "prompts/roles/orchestrator/recovery-rerun.md",
        "selfReviewChecklist": [
          "Failure evidence is current and tied to the active dispatch.",
          "Retry and rerun policy is bounded.",
          "Provider handoff is requested without patching provider source.",
          "Deploy verification evidence is required before rerun when configured."
        ]
      },
      {
        "id": "orchestrator.parallel-capacity",
        "role": "orchestrator",
        "roleFamily": "manager",
        "title": "Parallel Capacity Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "autonomyLevel": 4,
        "specialization": "parallel-capacity",
        "purpose": "Dispatch bounded parallel runner candidates or lanes while preserving candidate identity and deferring final selection to judgment.",
        "autonomyEvidence": [
          "candidate dispatch identities",
          "lane capacity policy",
          "candidate output manifests",
          "comparative judgment verdict"
        ],
        "autonomyLimits": [
          "cannot choose a winner without judgment verdict",
          "cannot merge candidate artifacts",
          "cannot exceed declared lane capacity"
        ],
        "signals": {
          "transitionStyle": [
            "strict-sequential"
          ],
          "failurePath": [
            "retry",
            "stop"
          ],
          "workUnitShape": [
            "parallel-candidate"
          ],
          "comparisonNeed": [
            "runner-candidates",
            "judge-panel"
          ]
        },
        "authority": {
          "adds": [
            "parallel_lane_capacity_gate",
            "candidate_identity_gate",
            "comparative_judgment_gate"
          ],
          "forbids": [
            "candidate_artifact_merge",
            "winner_selection_without_judgment"
          ]
        },
        "artifacts": {
          "required": [
            "dispatch-request.json",
            "output-manifest.json",
            "comparison-matrix.json",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "workUnitShape == parallel-candidate",
            "comparisonNeed in [runner-candidates,judge-panel]"
          ],
          "avoidWhen": [
            "comparisonNeed == none",
            "workUnitShape == human-checkpoint"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "candidate_output_identity",
            "runner_artifacts"
          ],
          "compatibleRunnerCapabilities": [
            "parallel_candidate"
          ],
          "compatibleJudgmentCapabilities": [
            "comparative",
            "challenge_review"
          ]
        },
        "promptReference": "prompts/roles/orchestrator/parallel-capacity.md",
        "selfReviewChecklist": [
          "Lane capacity is explicit and bounded.",
          "Every candidate keeps identity and provenance.",
          "Final winner selection is delegated to judgment.",
          "Parallel dispatch does not bypass required artifacts."
        ]
      }
    ],
    "runner": [
      {
        "id": "runner.artifact-producing",
        "role": "runner",
        "roleFamily": "performer",
        "title": "Artifact-Producing Runner",
        "inherits": "runner.shared",
        "level": 3,
        "autonomyLevel": 2,
        "specialization": "artifact-producing",
        "purpose": "Execute the assigned case or attempt and produce the required runner artifacts with provenance.",
        "autonomyEvidence": [
          "assigned case or attempt",
          "public skill boundary",
          "runner artifact provenance"
        ],
        "autonomyLimits": [
          "cannot decide final verdict",
          "cannot repair provider source",
          "cannot continue into unassigned work"
        ],
        "signals": {
          "workUnitShape": [
            "single-case",
            "repeated-case"
          ],
          "runtimeBoundary": [
            "public-skill-only",
            "allowed-runtime-call"
          ],
          "mutationBoundary": [
            "consumer-output",
            "no-mutation"
          ]
        },
        "authority": {
          "adds": [
            "execute_one_case_attempt",
            "write_required_output_manifest",
            "report_blocked_or_unsupported"
          ],
          "forbids": [
            "final_verdict_claim",
            "unassigned_stage_execution"
          ]
        },
        "artifacts": {
          "required": [
            "runner-report.md",
            "runner-metadata.json",
            "output-manifest.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "workUnitShape in [single-case,repeated-case]",
            "stageContracts.length == 0"
          ],
          "avoidWhen": [
            "workUnitShape == human-checkpoint",
            "workUnitShape == ordered-stage"
          ]
        },
        "compatibility": {
          "requiresOrchestratorCapabilities": [
            "single_active_dispatch",
            "judgment_required_advance"
          ],
          "compatibleOrchestratorCapabilities": [
            "single_active_dispatch",
            "deterministic_retry_limit"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/runner/artifact-producing.md",
        "selfReviewChecklist": [
          "The assigned case or attempt is the only work unit.",
          "The configured public skill or allowed runtime boundary is named.",
          "Required artifacts include provenance.",
          "Blocked or unsupported work is reported through artifacts."
        ]
      },
      {
        "id": "runner.human-checkpoint",
        "role": "runner",
        "roleFamily": "performer",
        "title": "Human-Checkpoint Runner",
        "inherits": "runner.shared",
        "level": 3,
        "autonomyLevel": 3,
        "specialization": "human-checkpoint",
        "purpose": "Prepare the assigned work, stop for a human-owned action, and record checkpoint evidence without replacing the human step.",
        "autonomyEvidence": [
          "checkpoint request",
          "human checkpoint evidence",
          "runner metadata"
        ],
        "autonomyLimits": [
          "cannot automate human-owned action",
          "cannot synthesize checkpoint evidence",
          "cannot continue after checkpoint without dispatch"
        ],
        "signals": {
          "workUnitShape": [
            "human-checkpoint",
            "ordered-stage"
          ],
          "runtimeBoundary": [
            "human-owned-runtime",
            "public-skill-only"
          ],
          "mutationBoundary": [
            "consumer-output",
            "no-mutation"
          ]
        },
        "authority": {
          "adds": [
            "prepare_checkpoint_context",
            "stop_for_human_action",
            "record_checkpoint_evidence"
          ],
          "forbids": [
            "automate_human_owned_action",
            "synthesize_checkpoint_evidence"
          ]
        },
        "artifacts": {
          "required": [
            "runner-report.md",
            "runner-metadata.json",
            "output-manifest.json",
            "checkpoint-evidence.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "workUnitShape == human-checkpoint",
            "evidenceStrictness == human-evidence-required"
          ],
          "avoidWhen": [
            "runtimeBoundary == station-owned-runtime",
            "workUnitShape == parallel-candidate"
          ]
        },
        "compatibility": {
          "requiresOrchestratorCapabilities": [
            "human_checkpoint_pause",
            "checkpoint_evidence_gate"
          ],
          "compatibleOrchestratorCapabilities": [
            "human_checkpoint_pause",
            "resume_after_human_evidence"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/runner/human-checkpoint.md",
        "selfReviewChecklist": [
          "The human-owned action is explicitly named.",
          "The runner stops instead of automating the human step.",
          "Checkpoint evidence is recorded with active dispatch identity.",
          "Synthetic checkpoint evidence remains forbidden."
        ]
      },
      {
        "id": "runner.stage-bound-action",
        "role": "runner",
        "roleFamily": "performer",
        "title": "Stage-Bound Action Runner",
        "inherits": "runner.shared",
        "level": 3,
        "autonomyLevel": 2,
        "specialization": "stage-bound-action",
        "purpose": "Execute exactly one declared stage through the allowed boundary, write stage artifacts, and stop before any later stage.",
        "autonomyEvidence": [
          "assigned stage contract",
          "allowed runtime boundary",
          "stage artifacts"
        ],
        "autonomyLimits": [
          "cannot infer later stages",
          "cannot advance station state",
          "cannot broaden task scope"
        ],
        "signals": {
          "workUnitShape": [
            "ordered-stage"
          ],
          "runtimeBoundary": [
            "public-skill-only",
            "allowed-runtime-call"
          ],
          "mutationBoundary": [
            "consumer-output",
            "no-mutation"
          ]
        },
        "authority": {
          "adds": [
            "execute_one_stage",
            "write_stage_artifacts",
            "stop_after_assigned_stage"
          ],
          "forbids": [
            "continue_unassigned_stage",
            "infer_next_stage_from_context"
          ]
        },
        "artifacts": {
          "required": [
            "runner-report.md",
            "runner-metadata.json",
            "output-manifest.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "stageContracts.length > 0",
            "workUnitShape == ordered-stage"
          ],
          "avoidWhen": [
            "workUnitShape == human-checkpoint",
            "stageContracts.length == 0"
          ]
        },
        "compatibility": {
          "requiresOrchestratorCapabilities": [
            "stage_order_gate",
            "single_active_stage"
          ],
          "compatibleOrchestratorCapabilities": [
            "stage_contract_dispatch",
            "single_active_stage"
          ],
          "compatibleJudgmentCapabilities": [
            "artifact_contract",
            "process_evidence"
          ]
        },
        "promptReference": "prompts/roles/runner/stage-bound-action.md",
        "selfReviewChecklist": [
          "The runner can name the assigned stage and stop condition.",
          "Later stages remain unassigned.",
          "Stage artifacts and provenance are written before reply.",
          "The runner does not advance the station."
        ]
      },
      {
        "id": "runner.parallel-candidate",
        "role": "runner",
        "roleFamily": "performer",
        "title": "Parallel Candidate Runner",
        "inherits": "runner.shared",
        "level": 3,
        "autonomyLevel": 4,
        "specialization": "parallel-candidate",
        "purpose": "Produce one bounded candidate output for the same contract while preserving candidate identity, provenance, and artifact isolation.",
        "autonomyEvidence": [
          "candidate id",
          "shared task contract",
          "candidate output manifest",
          "candidate provenance"
        ],
        "autonomyLimits": [
          "cannot compare candidates",
          "cannot declare winner",
          "cannot read or merge sibling candidate artifacts"
        ],
        "signals": {
          "workUnitShape": [
            "parallel-candidate"
          ],
          "runtimeBoundary": [
            "public-skill-only",
            "allowed-runtime-call"
          ],
          "mutationBoundary": [
            "consumer-output",
            "no-mutation"
          ]
        },
        "authority": {
          "adds": [
            "execute_one_candidate",
            "write_candidate_artifacts",
            "preserve_candidate_identity"
          ],
          "forbids": [
            "candidate_comparison",
            "winner_claim",
            "sibling_candidate_artifact_merge"
          ]
        },
        "artifacts": {
          "required": [
            "runner-report.md",
            "runner-metadata.json",
            "output-manifest.json",
            "candidate-manifest.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "workUnitShape == parallel-candidate",
            "comparisonNeed in [runner-candidates,judge-panel]"
          ],
          "avoidWhen": [
            "comparisonNeed == none",
            "workUnitShape == human-checkpoint"
          ]
        },
        "compatibility": {
          "requiresOrchestratorCapabilities": [
            "parallel_lane_capacity_gate",
            "candidate_identity_gate"
          ],
          "compatibleOrchestratorCapabilities": [
            "parallel_lane_capacity_gate",
            "comparative_judgment_gate"
          ],
          "compatibleJudgmentCapabilities": [
            "comparative",
            "challenge_review"
          ]
        },
        "promptReference": "prompts/roles/runner/parallel-candidate.md",
        "selfReviewChecklist": [
          "Candidate identity is visible in all produced artifacts.",
          "The runner does not inspect sibling candidates.",
          "The runner does not compare or rank candidates.",
          "Artifacts are isolated to this candidate assignment."
        ]
      }
    ],
    "judgment": [
      {
        "id": "judgment.artifact-contract",
        "role": "judgment",
        "roleFamily": "evaluator",
        "title": "Artifact-Contract Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "autonomyLevel": 2,
        "specialization": "artifact-contract",
        "purpose": "Evaluate required artifact existence, parseability, schema conformance, provenance, and freshness for the active dispatch.",
        "autonomyEvidence": [
          "required artifact list",
          "artifact schemas",
          "artifact provenance",
          "active dispatch identity"
        ],
        "autonomyLimits": [
          "cannot execute missing runner work",
          "cannot infer pass from chat summary",
          "cannot mutate station state"
        ],
        "signals": {
          "evidenceStrictness": [
            "artifacts-only",
            "schema-validated",
            "provenance-required"
          ],
          "comparisonNeed": [
            "none"
          ],
          "failurePath": [
            "retry",
            "stop"
          ]
        },
        "authority": {
          "adds": [
            "validate_required_artifacts",
            "validate_schema_conformance",
            "write_contract_verdict"
          ],
          "forbids": [
            "infer_pass_from_chat_summary",
            "repair_missing_artifact"
          ]
        },
        "artifacts": {
          "required": [
            "eval-report.md",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "requiredArtifacts.length > 0",
            "evidenceStrictness in [artifacts-only,schema-validated,provenance-required]"
          ],
          "avoidWhen": [
            "comparisonNeed in [runner-candidates,judge-panel]"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "runner_artifacts"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "stage_bound_action",
            "human_checkpoint"
          ],
          "compatibleOrchestratorCapabilities": [
            "judgment_required_advance",
            "single_active_dispatch"
          ]
        },
        "promptReference": "prompts/roles/judgment/artifact-contract.md",
        "selfReviewChecklist": [
          "Authoritative artifact inputs are named.",
          "Freshness and identity checks are explicit.",
          "Missing or invalid artifacts fail instead of being repaired.",
          "Verdict output is structured."
        ]
      },
      {
        "id": "judgment.comparative",
        "role": "judgment",
        "roleFamily": "evaluator",
        "title": "Comparative Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "autonomyLevel": 4,
        "specialization": "comparative",
        "purpose": "Compare multiple runner candidate outputs against the same contract and write a winner, no-pass, or rerun recommendation.",
        "autonomyEvidence": [
          "candidate output identities",
          "shared evaluation contract",
          "candidate provenance",
          "comparison matrix"
        ],
        "autonomyLimits": [
          "cannot merge candidate artifacts",
          "cannot create winning artifact",
          "cannot ignore candidate provenance"
        ],
        "signals": {
          "evidenceStrictness": [
            "artifacts-only",
            "schema-validated",
            "provenance-required"
          ],
          "comparisonNeed": [
            "runner-candidates",
            "judge-panel"
          ],
          "failurePath": [
            "retry",
            "stop"
          ]
        },
        "authority": {
          "adds": [
            "compare_runner_candidates",
            "rank_contract_fit",
            "write_comparative_verdict"
          ],
          "forbids": [
            "merge_candidate_outputs",
            "create_winning_artifact"
          ]
        },
        "artifacts": {
          "required": [
            "eval-report.md",
            "eval-verdict.json",
            "comparison-matrix.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "comparisonNeed in [runner-candidates,judge-panel]",
            "candidateCount > 1"
          ],
          "avoidWhen": [
            "candidateCount <= 1",
            "comparisonNeed == none"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "candidate_output_identity",
            "runner_artifacts"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing"
          ],
          "compatibleOrchestratorCapabilities": [
            "single_active_dispatch",
            "judgment_required_advance"
          ]
        },
        "promptReference": "prompts/roles/judgment/comparative.md",
        "selfReviewChecklist": [
          "Every candidate is tied to the same contract.",
          "The verdict explains winner, no-pass, or rerun recommendation.",
          "The judge does not merge or fabricate candidate artifacts.",
          "Candidate provenance and freshness are checked."
        ]
      },
      {
        "id": "judgment.process-evidence",
        "role": "judgment",
        "roleFamily": "evaluator",
        "title": "Process-Evidence Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "autonomyLevel": 3,
        "specialization": "process-evidence",
        "purpose": "Evaluate whether the runner stayed inside the allowed skill, runtime, mutation, and checkpoint boundaries while producing artifacts.",
        "autonomyEvidence": [
          "runner metadata",
          "skill runtime evidence",
          "mutation boundary evidence",
          "checkpoint evidence when required"
        ],
        "autonomyLimits": [
          "cannot execute missing process steps",
          "cannot accept output quality as process evidence",
          "cannot advance station state"
        ],
        "signals": {
          "evidenceStrictness": [
            "provenance-required",
            "verifier-required",
            "human-evidence-required"
          ],
          "comparisonNeed": [
            "none"
          ],
          "failurePath": [
            "retry",
            "human-pause",
            "stop"
          ]
        },
        "authority": {
          "adds": [
            "validate_runtime_boundary",
            "validate_mutation_boundary",
            "write_process_compliance_verdict"
          ],
          "forbids": [
            "accept_output_quality_without_process_evidence",
            "complete_missing_runner_evidence"
          ]
        },
        "artifacts": {
          "required": [
            "eval-report.md",
            "eval-verdict.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "runtimeBoundary != unrestricted",
            "mutationBoundary in [consumer-output,no-mutation]",
            "evidenceStrictness in [provenance-required,verifier-required,human-evidence-required]"
          ],
          "avoidWhen": [
            "requiredArtifacts.length == 0",
            "runtimeBoundary == unrestricted"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "skill_runtime_evidence",
            "provenance"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "stage_bound_action",
            "human_checkpoint"
          ],
          "compatibleOrchestratorCapabilities": [
            "judgment_required_advance",
            "checkpoint_evidence_gate"
          ]
        },
        "promptReference": "prompts/roles/judgment/process-evidence.md",
        "selfReviewChecklist": [
          "Allowed runtime and mutation boundaries are named.",
          "Process-boundary failure is separate from output-quality failure.",
          "Human checkpoint evidence is verified when required.",
          "The judge does not execute missing process steps."
        ]
      },
      {
        "id": "judgment.verifier-backed",
        "role": "judgment",
        "roleFamily": "evaluator",
        "title": "Verifier-Backed Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "autonomyLevel": 4,
        "specialization": "verifier-backed",
        "purpose": "Evaluate runner artifacts together with verifier output, schemas, provenance, identity, and freshness before writing a verdict.",
        "autonomyEvidence": [
          "verifier report",
          "artifact schemas",
          "runner artifact provenance",
          "active dispatch identity"
        ],
        "autonomyLimits": [
          "cannot treat verifier output as fresh when identity mismatches",
          "cannot repair failing artifacts",
          "cannot override missing required artifacts"
        ],
        "signals": {
          "evidenceStrictness": [
            "schema-validated",
            "provenance-required",
            "verifier-required"
          ],
          "comparisonNeed": [
            "none"
          ],
          "failurePath": [
            "retry",
            "provider-handoff",
            "deploy-verify",
            "stop"
          ]
        },
        "authority": {
          "adds": [
            "validate_verifier_output",
            "validate_artifact_freshness",
            "write_verifier_backed_verdict"
          ],
          "forbids": [
            "accept_stale_verifier_output",
            "repair_missing_artifact"
          ]
        },
        "artifacts": {
          "required": [
            "eval-report.md",
            "eval-verdict.json",
            "reports/verification.json"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "high",
          "preferredWhen": [
            "evidenceStrictness == verifier-required",
            "requiredArtifacts includes reports/verification.json"
          ],
          "avoidWhen": [
            "comparisonNeed in [runner-candidates,judge-panel]",
            "requiredArtifacts.length == 0"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "runner_artifacts",
            "skill_runtime_evidence",
            "provenance"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "stage_bound_action"
          ],
          "compatibleOrchestratorCapabilities": [
            "judgment_required_advance",
            "retry_rerun_gate",
            "stage_order_gate"
          ]
        },
        "promptReference": "prompts/roles/judgment/verifier-backed.md",
        "selfReviewChecklist": [
          "Verifier output identity matches the active dispatch.",
          "Artifact schema and provenance checks still run.",
          "A failing verifier produces a verdict, not a repair.",
          "Freshness is checked before pass."
        ]
      },
      {
        "id": "judgment.challenge-review",
        "role": "judgment",
        "roleFamily": "evaluator",
        "title": "Challenge Review Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "autonomyLevel": 4,
        "specialization": "challenge-review",
        "purpose": "Perform a second-pass review of provisional pass, comparative, or high-risk verdict evidence before the orchestrator advances.",
        "autonomyEvidence": [
          "provisional verdict",
          "runner artifacts",
          "comparison matrix when present",
          "risk or challenge criteria"
        ],
        "autonomyLimits": [
          "cannot perform missing runner work",
          "cannot silently override the primary verdict",
          "cannot mutate station state"
        ],
        "signals": {
          "evidenceStrictness": [
            "schema-validated",
            "provenance-required",
            "verifier-required"
          ],
          "comparisonNeed": [
            "challenge-review",
            "judge-panel",
            "runner-candidates"
          ],
          "failurePath": [
            "retry",
            "provider-handoff",
            "stop"
          ]
        },
        "authority": {
          "adds": [
            "challenge_provisional_verdict",
            "validate_high_risk_pass",
            "write_challenge_verdict"
          ],
          "forbids": [
            "silent_primary_verdict_override",
            "runner_artifact_fabrication"
          ]
        },
        "artifacts": {
          "required": [
            "eval-report.md",
            "eval-verdict.json",
            "challenge-report.md"
          ],
          "provenanceRequired": true
        },
        "recommendation": {
          "defaultConfidence": "medium",
          "preferredWhen": [
            "comparisonNeed in [challenge-review,judge-panel]",
            "failurePath in [provider-handoff,retry]"
          ],
          "avoidWhen": [
            "comparisonNeed == none",
            "requiredArtifacts.length == 0"
          ]
        },
        "compatibility": {
          "requiresRunnerCapabilities": [
            "runner_artifacts",
            "provenance"
          ],
          "compatibleRunnerCapabilities": [
            "artifact_producing",
            "parallel_candidate",
            "stage_bound_action"
          ],
          "compatibleOrchestratorCapabilities": [
            "comparative_judgment_gate",
            "judgment_required_advance",
            "retry_rerun_gate"
          ]
        },
        "promptReference": "prompts/roles/judgment/challenge-review.md",
        "selfReviewChecklist": [
          "The challenge input is a provisional verdict or high-risk pass.",
          "The challenge verdict records what changed or stayed accepted.",
          "The judge does not fabricate runner artifacts.",
          "The orchestrator still owns final state transition."
        ]
      }
    ]
  });
