import { canonicalRole, executionForRole } from "./profiles.js";

const DEFAULT_GROUP_ORDER = ["control", "runners", "evaluators", "providers", "monitors", "custom"];

export function normalizeLayoutConfig(layout = {}) {
  return {
    mode: layout.mode ?? "full-team-visible",
    splitFallback: layout.splitFallback ?? "new-window",
    sectionDirection: layout.sectionDirection === "horizontal" ? "horizontal" : "vertical",
    operatorPanePolicy: layout.operatorPanePolicy ?? "retain-left",
    groupOrder: Array.isArray(layout.groupOrder) && layout.groupOrder.length > 0 ? layout.groupOrder : DEFAULT_GROUP_ORDER,
    groups: Array.isArray(layout.groups) ? layout.groups.map(normalizeGroup) : []
  };
}

export function normalizeGroup(group = {}) {
  const role = canonicalRole(group.role) ?? String(group.role ?? "").trim();
  return {
    role,
    count: normalizeCount(group.count),
    visible: group.visible !== false,
    cwd: group.cwd ?? defaultCwdForRole(role),
    inputs: Array.isArray(group.inputs) ? group.inputs : defaultInputsForRole(role),
    requiredArtifacts: Array.isArray(group.requiredArtifacts) ? group.requiredArtifacts : defaultArtifactsForRole(role),
    alias: group.alias ? String(group.alias).trim() : null
  };
}

export function hasManagedSectionLayout(config) {
  return config.profileMode === "preset" || (Array.isArray(config.layout?.groups) && config.layout.groups.length > 0);
}

export function materializeAgentsFromLayout(layout) {
  const groups = sortGroups(layout.groups ?? [], layout.groupOrder ?? DEFAULT_GROUP_ORDER);
  const agents = [];
  for (const group of groups) {
    if (!group.visible || group.count < 1) continue;
    for (let index = 1; index <= group.count; index += 1) {
      const agent = agentForGroup(group, index);
      if (agent) agents.push(agent);
    }
  }
  return agents;
}

export function agentNamesForRole(config, role) {
  const wanted = canonicalRole(role) ?? role;
  return (config.agents ?? [])
    .filter((agent) => agentRole(agent) === wanted)
    .map((agent) => agent.name);
}

export function firstAgentNameForRole(config, role) {
  return agentNamesForRole(config, role)[0] ?? null;
}

export function reviewRoleNames(config) {
  const judges = agentNamesForRole(config, "judgment");
  if (judges.length > 0) return judges;
  return [...agentNamesForRole(config, "evaluator"), ...agentNamesForRole(config, "judge")];
}

export function agentRole(agent = {}) {
  const role = canonicalRole(agent);
  if (role) return role;
  return agent.kind === "code" ? "code" : "custom";
}

export function roleBucket(role) {
  switch (role) {
    case "orchestrator":
    case "station_control":
    case "installer":
      return "control";
    case "runner":
      return "runners";
    case "judgment":
      return "evaluators";
    case "provider_engineer":
    case "deploy_verifier":
      return "providers";
    case "observer":
      return "monitors";
    default:
      return "custom";
  }
}

function sortGroups(groups, groupOrder) {
  const order = new Map(groupOrder.map((name, index) => [name, index]));
  return [...groups].sort((left, right) => {
    const leftBucket = order.get(roleBucket(left.role)) ?? Number.MAX_SAFE_INTEGER;
    const rightBucket = order.get(roleBucket(right.role)) ?? Number.MAX_SAFE_INTEGER;
    if (leftBucket !== rightBucket) return leftBucket - rightBucket;
    return String(left.role).localeCompare(String(right.role));
  });
}

function normalizeCount(value) {
  const count = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function defaultCwdForRole(role) {
  switch (role) {
    case "runner":
      return "consumerRoot";
    case "provider_engineer":
      return "providerRoot";
    case "installer":
      return "consumerRoot";
    default:
      return "stationRoot";
  }
}

function defaultInputsForRole(role) {
  switch (role) {
    case "runner":
      return ["RUN_SKILL_CASE"];
    case "judgment":
      return ["EVALUATE_CASE"];
    case "provider_engineer":
      return ["REPORT_CASE_RESULT_TO_PROVIDER_CODEX", "FOLLOW_UP_PROVIDER_RESPONSE"];
    case "deploy_verifier":
      return ["DEPLOY_VERIFY"];
    case "observer":
      return ["RUN_STATUS"];
    case "installer":
      return ["RUN_INSTALLATION"];
    default:
      return [];
  }
}

function defaultArtifactsForRole(role) {
  switch (role) {
    case "runner":
      return ["runner-report.md", "runner-metadata.json", "output-manifest.json"];
    case "judgment":
      return ["eval-report.md", "eval-verdict.json"];
    case "provider_engineer":
      return ["provider-response.md", "provider-response.json"];
    case "deploy_verifier":
      return ["deploy-verify-report.md", "deploy-verify.json"];
    case "installer":
      return ["consumer-install-report.md", "consumer-install.json"];
    default:
      return [];
  }
}

function agentForGroup(group, index) {
  const role = group.role;
  const base = {
    role,
    cwd: group.cwd,
    visible: group.visible,
    inputs: group.inputs,
    requiredArtifacts: group.requiredArtifacts
  };
  switch (role) {
    case "orchestrator":
      return { ...base, name: "Orchestrator", execution: executionForRole(role), kind: "code", lifecycle: "run-scoped" };
    case "station_control":
      return { ...base, name: "StationControl", execution: executionForRole(role), kind: "code", lifecycle: "run-scoped" };
    case "runner":
      return { ...base, name: `RunnerAgent-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "attempt-scoped" };
    case "judgment":
      return { ...base, name: `JudgmentAgent-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "attempt-scoped" };
    case "provider_engineer":
      return { ...base, name: `ProviderEngineer-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "case-scoped" };
    case "deploy_verifier":
      return { ...base, name: `DeployVerifier-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "case-scoped" };
    case "observer":
      return { ...base, name: `ObserverAgent-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "run-scoped" };
    case "installer":
      return { ...base, name: `InstallerAgent-${index}-Model`, execution: executionForRole(role), kind: "model", lifecycle: "run-scoped" };
    default: {
      const alias = group.alias || role || "CustomAgent";
      const safeAlias = alias
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "CustomAgent";
      return { ...base, name: `${safeAlias}-${index}-Model`, execution: executionForRole(role) ?? "model", kind: "model", lifecycle: "run-scoped" };
    }
  }
}
