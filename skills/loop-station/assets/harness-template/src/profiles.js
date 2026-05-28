const PROFILE_DEFINITIONS = {
  "evaluation-loop": {
    topologyPreset: "evaluation-visible",
    phaseGraph: ["run", "judgment"],
    defaultRoleCounts: {
      runner: 1,
      judgment: 1
    },
    repairContract: null
  },
  "recovery-loop": {
    topologyPreset: "legacy-aligned-visible",
    phaseGraph: [
      "run",
      "judgment",
      "challenge_review",
      "provider_fix",
      "consumer_install",
      "deploy_verify",
      "rerun_gate"
    ],
    defaultRoleCounts: {
      runner: 2,
      judgment: 1,
      observer: 1,
      provider_engineer: 1,
      deploy_verifier: 1
    },
    repairContract: {
      requireConsumerInstall: true,
      requireDeployVerification: true,
      requireReleaseConsumerHashMatch: true
    }
  },
  "installation-loop": {
    topologyPreset: "installation-visible",
    phaseGraph: ["consumer_install", "deploy_verify", "judgment"],
    defaultRoleCounts: {
      installer: 1,
      judgment: 1,
      observer: 1,
      deploy_verifier: 1
    },
    repairContract: {
      requireConsumerInstall: true,
      requireDeployVerification: true,
      requireReleaseConsumerHashMatch: false
    }
  },
  "action-pipeline": {
    topologyPreset: "action-pipeline-visible",
    phaseGraph: ["run", "judgment"],
    defaultRoleCounts: {
      runner: 2,
      judgment: 1,
      observer: 1
    },
    repairContract: null
  }
};

const SCRIPT_ROLES = new Set(["orchestrator", "station_control"]);
const MODEL_ROLES = new Set(["runner", "judgment", "observer", "provider_engineer", "deploy_verifier", "installer"]);

const ROLE_ALIASES = new Map([
  ["orchestrator", "orchestrator"],
  ["station_control", "station_control"],
  ["station-control", "station_control"],
  ["stationcontrol", "station_control"],
  ["runner", "runner"],
  ["judgment", "judgment"],
  ["judge", "judgment"],
  ["evaluator", "judgment"],
  ["observer", "observer"],
  ["monitor", "observer"],
  ["provider_engineer", "provider_engineer"],
  ["provider-engineer", "provider_engineer"],
  ["provider", "provider_engineer"],
  ["providercodex", "provider_engineer"],
  ["deploy_verifier", "deploy_verifier"],
  ["deploy-verifier", "deploy_verifier"],
  ["deployverifier", "deploy_verifier"],
  ["installer", "installer"]
]);

export function profileDefinition(loopProfile) {
  return PROFILE_DEFINITIONS[loopProfile] ?? null;
}

export function profileModeForConfig(config = {}) {
  if (config.profileMode) return String(config.profileMode);
  if (config.loopProfile) return "preset";
  return "advanced-legacy";
}

export function isPresetConfig(config = {}) {
  return profileModeForConfig(config) === "preset";
}

export function isRecoveryLoop(config = {}) {
  return isPresetConfig(config) && config.loopProfile === "recovery-loop";
}

export function canonicalRole(input) {
  if (!input) return null;
  if (typeof input === "object") {
    if (input.role) return canonicalRole(input.role);
    if (input.name) return canonicalRoleFromName(input.name);
    return null;
  }
  const key = String(input).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ROLE_ALIASES.get(key) ?? null;
}

export function executionForRole(role) {
  const canonical = canonicalRole(role);
  if (!canonical) return null;
  if (SCRIPT_ROLES.has(canonical)) return "script";
  if (MODEL_ROLES.has(canonical)) return "model";
  return null;
}

export function normalizeAgentExecution(agent = {}) {
  return agent.execution ?? legacyKindToExecution(agent.kind) ?? executionForRole(agent.role ?? agent.name) ?? null;
}

export function normalizeProfileConfig(rawConfig = {}) {
  const profileMode = profileModeForConfig(rawConfig);
  const profileMetadata = {
    profileMode,
    rawHasAgents: Array.isArray(rawConfig.agents),
    rawHasLayoutGroups: Array.isArray(rawConfig.layout?.groups) && rawConfig.layout.groups.length > 0,
    rawHasCustomRoles: Array.isArray(rawConfig.customRoles) && rawConfig.customRoles.length > 0
  };
  if (profileMode !== "preset") {
    return {
      ...rawConfig,
      profileMode,
      profileMetadata
    };
  }

  const definition = profileDefinition(rawConfig.loopProfile);
  const defaultRoleCounts = definition?.defaultRoleCounts ?? {};
  const roleCounts = normalizeRoleCounts({ ...defaultRoleCounts, ...(rawConfig.roleCounts ?? {}) });
  const loopProfile = rawConfig.loopProfile ?? "evaluation-loop";
  const topologyPreset = rawConfig.topologyPreset ?? definition?.topologyPreset ?? `${loopProfile}-visible`;
  const phaseGraph = rawConfig.phaseGraph ?? definition?.phaseGraph ?? [];
  const repairContract = rawConfig.repairContract ?? definition?.repairContract ?? null;
  const runtimePolicy = {
    attachRequired: true,
    allowDetached: false,
    allowGenericActionStages: rawConfig.runtimePolicy?.allowGenericActionStages === true,
    transportPolicy: {
      activationFailurePolicy: normalizeActivationFailurePolicy(rawConfig.runtimePolicy?.transportPolicy ?? {})
    }
  };
  const agents = materializePresetAgents({
    ...rawConfig,
    loopProfile,
    roleCounts
  });
  return {
    ...rawConfig,
    profileMode,
    loopProfile,
    topologyPreset,
    phaseGraph,
    roleCounts,
    repairContract,
    runtimePolicy,
    agents,
    profileMetadata
  };
}

function normalizeActivationFailurePolicy(transportPolicy = {}) {
  if (transportPolicy.activationFailurePolicy === "fail_fast" || transportPolicy.activationFailurePolicy === "recycle_once") {
    return transportPolicy.activationFailurePolicy;
  }
  if (transportPolicy.firstSubmitMustStart === true) return "fail_fast";
  return "recycle_once";
}

export function validateProfileContract(config = {}) {
  const profileMode = profileModeForConfig(config);
  if (profileMode !== "preset") {
    return { ok: true, profileMode, loopProfile: config.loopProfile ?? null, advancedLegacy: true };
  }
  const definition = profileDefinition(config.loopProfile);
  if (!definition) {
    return { ok: false, reason: "unknown_loop_profile", loopProfile: config.loopProfile ?? null, profileMode };
  }
  const metadata = config.profileMetadata ?? {};
  if (metadata.rawHasAgents) return { ok: false, reason: "preset_raw_agents_forbidden", loopProfile: config.loopProfile, profileMode };
  if (metadata.rawHasLayoutGroups) return { ok: false, reason: "preset_layout_groups_forbidden", loopProfile: config.loopProfile, profileMode };
  if (metadata.rawHasCustomRoles) return { ok: false, reason: "preset_custom_roles_forbidden", loopProfile: config.loopProfile, profileMode };
  if (JSON.stringify(config.phaseGraph ?? []) !== JSON.stringify(definition.phaseGraph ?? [])) {
    return { ok: false, reason: "profile_phase_graph_drift", loopProfile: config.loopProfile, profileMode };
  }
  if ((config.topologyPreset ?? null) !== (definition.topologyPreset ?? null)) {
    return { ok: false, reason: "profile_topology_preset_drift", loopProfile: config.loopProfile, profileMode };
  }
  const expectedRoleCounts = normalizeRoleCounts(definition.defaultRoleCounts);
  const actualRoleCounts = normalizeRoleCounts(config.roleCounts ?? {});
  for (const [role, count] of Object.entries(expectedRoleCounts)) {
    if ((actualRoleCounts[role] ?? 0) < count) {
      return { ok: false, reason: "profile_role_counts_incomplete", loopProfile: config.loopProfile, profileMode, role };
    }
  }
  const roleViolations = presetRoleViolations(config);
  if (roleViolations.length > 0) {
    return { ok: false, reason: "profile_role_backend_mismatch", loopProfile: config.loopProfile, profileMode, roleViolations };
  }
  if (config.loopProfile === "recovery-loop") {
    const missing = [];
    if (!config.locations?.providerRoot) missing.push("providerRoot");
    if (!config.locations?.releaseRoot) missing.push("releaseRoot");
    if (!config.locations?.consumerRoot) missing.push("consumerRoot");
    if (!config.locations?.consumerInstallTarget) missing.push("consumerInstallTarget");
    if (!config.locations?.targetSkillInstallPath) missing.push("targetSkillInstallPath");
    if (missing.length > 0) {
      return { ok: false, reason: "recovery_profile_missing_locations", loopProfile: config.loopProfile, profileMode, missing };
    }
  }
  return { ok: true, profileMode, loopProfile: config.loopProfile };
}

export function providerEngineerAgentName(config = {}) {
  return firstAgentNameForCanonicalRole(config.agents ?? [], "provider_engineer") ?? "ProviderCodex-Model";
}

export function deployVerifierAgentName(config = {}) {
  return firstAgentNameForCanonicalRole(config.agents ?? [], "deploy_verifier") ?? "DeployVerifier-Model";
}

function presetRoleViolations(config) {
  return (config.agents ?? []).flatMap((agent) => {
    const role = canonicalRole(agent);
    if (!role) return [`unknown role for ${agent.name}`];
    const execution = normalizeAgentExecution(agent);
    const expected = executionForRole(role);
    if (execution !== expected) return [`${agent.name}:${role}:${execution}->${expected}`];
    return [];
  });
}

function normalizeRoleCounts(roleCounts = {}) {
  const counts = {};
  for (const [key, value] of Object.entries(roleCounts)) {
    const role = canonicalRole(key);
    if (!role) continue;
    const count = Number.parseInt(String(value ?? 0), 10);
    if (Number.isFinite(count) && count > 0) counts[role] = count;
  }
  return counts;
}

function materializePresetAgents(config) {
  const counts = normalizeRoleCounts(config.roleCounts ?? {});
  const agents = [
    scriptAgent("Orchestrator", "orchestrator", "stationRoot", false),
    scriptAgent("StationControl", "station_control", "stationRoot", true)
  ];
  for (let index = 1; index <= (counts.runner ?? 0); index += 1) {
    agents.push(modelAgent(`RunnerAgent-${index}-Model`, "runner", "consumerRoot", "attempt-scoped", ["RUN_SKILL_CASE", "RUN_ACTION_STAGE"], ["runner-report.md", "runner-metadata.json", "output-manifest.json"]));
  }
  for (let index = 1; index <= (counts.judgment ?? 0); index += 1) {
    const suffix = counts.judgment > 1 ? `-${index}` : "";
    agents.push(modelAgent(`JudgmentAgent${suffix}-Model`, "judgment", "stationRoot", "attempt-scoped", ["EVALUATE_CASE", "CHALLENGE_REVIEW"], ["eval-report.md", "eval-verdict.json", "challenge-report.md", "challenge-verdict.json"]));
  }
  for (let index = 1; index <= (counts.observer ?? 0); index += 1) {
    const suffix = counts.observer > 1 ? `-${index}` : "";
    agents.push(modelAgent(`ObserverAgent${suffix}-Model`, "observer", "stationRoot", "run-scoped", ["RUN_STATUS"], []));
  }
  for (let index = 1; index <= (counts.provider_engineer ?? 0); index += 1) {
    const suffix = counts.provider_engineer > 1 ? `-${index}` : "";
    agents.push(modelAgent(`ProviderEngineer${suffix}-Model`, "provider_engineer", "providerRoot", "case-scoped", ["REPORT_CASE_RESULT_TO_PROVIDER_CODEX", "FOLLOW_UP_PROVIDER_RESPONSE"], ["provider-response.md", "provider-response.json", "provider-fix-report.md", "provider-fix.json", "consumer-install-report.md", "consumer-install.json"]));
  }
  for (let index = 1; index <= (counts.deploy_verifier ?? 0); index += 1) {
    const suffix = counts.deploy_verifier > 1 ? `-${index}` : "";
    agents.push(modelAgent(`DeployVerifier${suffix}-Model`, "deploy_verifier", "stationRoot", "case-scoped", ["DEPLOY_VERIFY"], ["deploy-verify-report.md", "deploy-verify.json"]));
  }
  for (let index = 1; index <= (counts.installer ?? 0); index += 1) {
    const suffix = counts.installer > 1 ? `-${index}` : "";
    agents.push(modelAgent(`InstallerAgent${suffix}-Model`, "installer", "consumerRoot", "case-scoped", ["RUN_INSTALLATION"], ["consumer-install-report.md", "consumer-install.json"]));
  }
  return agents;
}

function modelAgent(name, role, cwd, lifecycle, inputs, requiredArtifacts) {
  return {
    name,
    role,
    execution: "model",
    kind: "model",
    cwd,
    lifecycle,
    visible: true,
    inputs,
    requiredArtifacts
  };
}

function scriptAgent(name, role, cwd, visible) {
  return {
    name,
    role,
    execution: "script",
    kind: "code",
    cwd,
    lifecycle: "run-scoped",
    visible,
    inputs: [],
    requiredArtifacts: []
  };
}

function legacyKindToExecution(kind) {
  if (kind === "code") return "script";
  if (kind === "model") return "model";
  return null;
}

function canonicalRoleFromName(name) {
  const value = String(name ?? "");
  if (value === "Orchestrator") return "orchestrator";
  if (value === "StationControl") return "station_control";
  if (/^RunnerAgent(?:-\d+)?-Model$/.test(value) || /^Runner\d+-Model$/.test(value)) return "runner";
  if (/^(?:JudgmentAgent|JudgeAgent|EvaluatorAgent)(?:-\d+)?-Model$/.test(value)) return "judgment";
  if (/^(?:ObserverAgent|MonitorAgent)(?:-\d+)?-Model$/.test(value)) return "observer";
  if (/^(?:ProviderEngineer|ProviderCodex|ProviderAgent)(?:-\d+)?-Model$/.test(value)) return "provider_engineer";
  if (/^(?:DeployVerifier)(?:-\d+)?-Model$/.test(value)) return "deploy_verifier";
  if (/^(?:InstallerAgent)(?:-\d+)?-Model$/.test(value)) return "installer";
  return null;
}

function firstAgentNameForCanonicalRole(agents, role) {
  return agents.find((agent) => canonicalRole(agent) === role)?.name ?? null;
}
