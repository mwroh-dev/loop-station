import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasManagedSectionLayout, materializeAgentsFromLayout, normalizeLayoutConfig } from "./layout-config.js";
import { normalizeAgentExecution, normalizeProfileConfig } from "./profiles.js";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CONFIG_PATH = process.env.STATION_CONFIG ?? join(ROOT, "station.json");

export function runsDir() {
  if (process.env.STATION_RUNS_DIR) return resolve(process.env.STATION_RUNS_DIR);
  return join(dirname(resolve(CONFIG_PATH)), "runs");
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`Missing station config: ${CONFIG_PATH}`);
  const baseDir = dirname(resolve(CONFIG_PATH));
  const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const preNormalized = normalizeProfileConfig(rawConfig);
  const layout = normalizeLayoutConfig(preNormalized.layout ?? {});
  const agents = preNormalized.profileMode === "preset"
    ? (preNormalized.agents ?? [])
    : hasManagedSectionLayout({ ...preNormalized, layout })
    ? materializeAgentsFromLayout(layout)
    : (preNormalized.agents ?? []);
  return {
    ...preNormalized,
    layout,
    runtimePolicy: normalizeRuntimePolicy(preNormalized.runtimePolicy ?? {}),
    codexRuntime: normalizeCodexRuntime(preNormalized.codexRuntime ?? {}),
    agents: agents.map((agent) => ({
      ...agent,
      execution: normalizeAgentExecution(agent)
    })),
    caseManifest: resolveLocation(preNormalized.caseManifest, baseDir),
    targetSkills: normalizeTargetSkills(preNormalized.targetSkills ?? null, baseDir),
    stageContracts: normalizeStageContracts(preNormalized.stageContracts ?? [], baseDir),
    locations: normalizeLocations(preNormalized.locations ?? {}, baseDir)
  };
}

export function resolveLocation(value, baseDir = ROOT) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

function normalizeLocations(locations, baseDir = ROOT) {
  return Object.fromEntries(
    Object.entries(locations).map(([key, value]) => [key, resolveLocation(value, baseDir)])
  );
}

function normalizeTargetSkills(targetSkills, baseDir = ROOT) {
  if (!Array.isArray(targetSkills)) return targetSkills;
  return targetSkills.map((skill) => {
    if (typeof skill === "string") return { name: skill };
    const installPath = skill.installPath ?? skill.targetSkillInstallPath ?? skill.path ?? null;
    const sourcePath = skill.sourcePath ?? null;
    const providerRoot = skill.providerRoot ?? null;
    return {
      ...skill,
      ...(installPath ? { installPath: resolveLocation(installPath, baseDir) } : {}),
      ...(sourcePath ? { sourcePath: resolveLocation(sourcePath, baseDir) } : {}),
      ...(providerRoot ? { providerRoot: resolveLocation(providerRoot, baseDir) } : {})
    };
  });
}

function normalizeStageContracts(stageContracts, baseDir = ROOT) {
  if (!Array.isArray(stageContracts)) return [];
  return stageContracts.map((stage) => {
    const next = { ...stage };
    for (const key of ["installPath", "sourcePath", "providerRoot", "handoffArtifact"]) {
      if (typeof next[key] === "string") next[key] = resolveLocation(next[key], baseDir);
    }
    return next;
  });
}

function normalizeRuntimePolicy(runtimePolicy) {
  return {
    attachRequired: runtimePolicy.attachRequired === true,
    allowDetached: runtimePolicy.allowDetached !== false,
    transportPolicy: {
      activationFailurePolicy: normalizeActivationFailurePolicy(runtimePolicy.transportPolicy ?? {})
    }
  };
}

function normalizeActivationFailurePolicy(transportPolicy) {
  const configured = transportPolicy?.activationFailurePolicy;
  if (configured === "fail_fast" || configured === "recycle_once") return configured;
  if (transportPolicy?.firstSubmitMustStart === true) return "fail_fast";
  return "recycle_once";
}

function normalizeCodexRuntime(codexRuntime) {
  return {
    invokerDefault: normalizeCodexProfile(codexRuntime.invokerDefault ?? {}),
    roleDefaults: Object.fromEntries(
      Object.entries(codexRuntime.roleDefaults ?? {}).map(([role, profile]) => [role, normalizeCodexProfile(profile)])
    ),
    agentOverrides: Object.fromEntries(
      Object.entries(codexRuntime.agentOverrides ?? {}).map(([name, profile]) => [name, normalizeCodexProfile(profile)])
    )
  };
}

function normalizeCodexProfile(profile) {
  const next = {};
  if (profile?.model) next.model = String(profile.model);
  if (profile?.model_reasoning_effort) next.model_reasoning_effort = String(profile.model_reasoning_effort);
  return next;
}
