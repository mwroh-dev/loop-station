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

export function isRoleType(value) {
  return ROLE_TYPE_VALUES.includes(value);
}

export const SHARED_TRAIT_PACKS = Object.freeze({
    "orchestrator": {
      "id": "orchestrator.shared",
      "role": "orchestrator",
      "title": "Shared Orchestrator Traits",
      "level": 3,
      "purpose": "Own station state transitions, dispatch gates, pause/rerun decisions, and handoff boundaries without performing model-owned work.",
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
      "title": "Shared Runner Traits",
      "level": 3,
      "purpose": "Execute exactly one assigned case, stage, or task through the allowed public boundary and produce required runner-owned artifacts.",
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
      "title": "Shared Judgment Traits",
      "level": 3,
      "purpose": "Evaluate runner output and process evidence for the active dispatch, then write verdict artifacts without executing runner work or mutating station state.",
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
        "title": "Human-Gated Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "specialization": "human-gated",
        "purpose": "Pause at human-owned checkpoints and resume only after explicit checkpoint evidence belongs to the active dispatch.",
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
        "title": "Multi-Stage Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "specialization": "multi-stage",
        "purpose": "Dispatch ordered stage contracts one at a time and prevent a runner from continuing into unassigned stages.",
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
        "title": "Strict Sequential Orchestrator",
        "inherits": "orchestrator.shared",
        "level": 3,
        "specialization": "strict-sequential",
        "purpose": "Run one active case or stage at a time and advance only after activation, artifact, verifier, and judgment gates are satisfied.",
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
      }
    ],
    "runner": [
      {
        "id": "runner.artifact-producing",
        "role": "runner",
        "title": "Artifact-Producing Runner",
        "inherits": "runner.shared",
        "level": 3,
        "specialization": "artifact-producing",
        "purpose": "Execute the assigned case or attempt and produce the required runner artifacts with provenance.",
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
        "title": "Human-Checkpoint Runner",
        "inherits": "runner.shared",
        "level": 3,
        "specialization": "human-checkpoint",
        "purpose": "Prepare the assigned work, stop for a human-owned action, and record checkpoint evidence without replacing the human step.",
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
        "title": "Stage-Bound Action Runner",
        "inherits": "runner.shared",
        "level": 3,
        "specialization": "stage-bound-action",
        "purpose": "Execute exactly one declared stage through the allowed boundary, write stage artifacts, and stop before any later stage.",
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
      }
    ],
    "judgment": [
      {
        "id": "judgment.artifact-contract",
        "role": "judgment",
        "title": "Artifact-Contract Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "specialization": "artifact-contract",
        "purpose": "Evaluate required artifact existence, parseability, schema conformance, provenance, and freshness for the active dispatch.",
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
        "title": "Comparative Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "specialization": "comparative",
        "purpose": "Compare multiple runner candidate outputs against the same contract and write a winner, no-pass, or rerun recommendation.",
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
        "title": "Process-Evidence Judgment",
        "inherits": "judgment.shared",
        "level": 3,
        "specialization": "process-evidence",
        "purpose": "Evaluate whether the runner stayed inside the allowed skill, runtime, mutation, and checkpoint boundaries while producing artifacts.",
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
      }
    ]
  });

export const ROLE_PRESET_PROMPTS = Object.freeze({
    "orchestrator.human-gated": "# Human-Gated Orchestrator\n\nPause when the station reaches a human-owned checkpoint. Resume only after explicit checkpoint evidence matches the active run, case, stage, attempt, and message.\n\nNever automate, synthesize, or silently skip the human-owned checkpoint.",
    "orchestrator.multi-stage": "# Multi-Stage Orchestrator\n\nDispatch ordered stage contracts one at a time. Close the current stage gate before dispatching the next stage, and prevent runner context from expanding beyond the assigned stage.\n\nNever skip stage order or advance from runner self-report alone.",
    "orchestrator.strict-sequential": "# Strict Sequential Orchestrator\n\nDispatch one active case or stage at a time. Advance only after current activation evidence, required artifacts, verifier output when configured, and judgment verdict all belong to the active dispatch.\n\nNever perform runner work, fabricate model artifacts, or treat chat-only self-report as completion evidence.",
    "runner.artifact-producing": "# Artifact-Producing Runner\n\nExecute the assigned case or attempt through the configured public skill or allowed runtime boundary. Write `runner-report.md`, `runner-metadata.json`, `output-manifest.json`, and required contract artifacts with provenance.\n\nNever make the final station verdict, repair provider source, patch case inputs, or continue into unassigned work.",
    "runner.human-checkpoint": "# Human-Checkpoint Runner\n\nPrepare the assigned work up to the human-owned checkpoint, stop for the human action, and record checkpoint evidence after the human action is complete.\n\nNever replace the human step with automation or synthetic evidence.",
    "runner.stage-bound-action": "# Stage-Bound Action Runner\n\nExecute exactly the assigned stage. Produce the stage artifacts and runner metadata, then stop and reply through the expected mailbox path.\n\nNever infer, start, or complete later stages unless the orchestrator dispatches them separately.",
    "judgment.artifact-contract": "# Artifact-Contract Judgment\n\nEvaluate required artifacts for existence, parseability, schema conformance, provenance, identity, and freshness. Write `eval-report.md` and `eval-verdict.json`.\n\nNever create missing runner artifacts or infer pass from chat-only summaries.",
    "judgment.comparative": "# Comparative Judgment\n\nCompare multiple runner candidates against the same contract. Write a structured verdict that names the winner, no-pass result, or rerun recommendation with candidate-specific evidence.\n\nNever merge candidates, fabricate a winning artifact, or ignore candidate provenance.",
    "judgment.process-evidence": "# Process-Evidence Judgment\n\nEvaluate whether the runner stayed inside the allowed skill, runtime, mutation, and checkpoint boundaries. Separate process-boundary failures from output-quality failures in the verdict.\n\nNever execute missing runner steps or accept output quality as a substitute for required process evidence."
  });
