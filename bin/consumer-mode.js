#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function canonicalSourceRoot() {
  return REPO_ROOT;
}

export function projectLocalLoopStationSkillRoot(project) {
  return join(project, ".codex", "skills", "loop-station");
}

export function detectLoopStationContext({ cwd = process.cwd(), canonicalRoot = canonicalSourceRoot() } = {}) {
  const resolvedCwd = resolve(cwd);
  const resolvedCanonical = resolve(canonicalRoot);
  if (isSameOrChildPath(resolvedCwd, resolvedCanonical)) {
    return {
      mode: "canonical_source",
      projectRoot: resolvedCanonical,
      skillRoot: join(resolvedCanonical, "skills", "loop-station")
    };
  }

  const projectRoot = nearestProjectRootWithLoopStationSkill(resolvedCwd);
  if (!projectRoot) {
    return {
      mode: "outside_workspace",
      projectRoot: resolvedCwd,
      skillRoot: null
    };
  }

  const skillRoot = projectLocalLoopStationSkillRoot(projectRoot);
  const runtimeRoot = join(projectRoot, ".loop-station");
  return {
    mode: existsSync(runtimeRoot) ? "consumer_project_post_setup" : "consumer_project_pre_setup",
    projectRoot,
    skillRoot
  };
}

export function assertConsumerSafeSetupSpec(project, spec, { canonicalRoot = canonicalSourceRoot() } = {}) {
  const context = detectLoopStationContext({ cwd: project, canonicalRoot });
  if (!context.mode.startsWith("consumer_project_")) return context;

  const installedSkillRoot = context.skillRoot;
  const mutableCandidates = [
    ...mutableLocationCandidates(spec.locations ?? {}),
    ...mutableRoleCandidates(spec.customRoles ?? [], "customRoles"),
    ...mutableRoleCandidates(spec.layout?.groups ?? [], "layout.groups"),
    ...mutableStageCandidates(spec.stageContracts ?? [])
  ];

  for (const candidate of mutableCandidates) {
    const resolved = resolve(project, candidate.value);
    if (isSameOrChildPath(resolved, installedSkillRoot)) {
      throw new Error(
        `Consumer mode rejects mutable target inside installed loop-station bundle: ${candidate.path}=${candidate.value}. ` +
        `Modify the canonical source repo or use .loop-station/** / wrapper skills outside .codex/skills/loop-station.`
      );
    }
  }
  return context;
}

function mutableLocationCandidates(locations) {
  return Object.entries(locations)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .map(([key, value]) => ({ path: `locations.${key}`, value }));
}

function mutableRoleCandidates(items, prefix) {
  return items.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    if (typeof item.cwd !== "string" || item.cwd.trim() === "") return [];
    return [{ path: `${prefix}[${index}].cwd`, value: item.cwd }];
  });
}

function mutableStageCandidates(stages) {
  return stages.flatMap((stage, index) => {
    if (!stage || typeof stage !== "object") return [];
    const candidates = [];
    if (typeof stage.installPath === "string" && stage.installPath.trim() !== "") {
      candidates.push({ path: `stageContracts[${index}].installPath`, value: stage.installPath });
    }
    return candidates;
  });
}

function nearestProjectRootWithLoopStationSkill(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".codex", "skills", "loop-station", "SKILL.md"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isSameOrChildPath(target, root) {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(`..${sep}`));
}
