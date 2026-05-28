import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeJson } from "./fs.js";

export function targetSkillSlug(config) {
  const name = config.targetSkillName;
  if (!name) return null;
  return skillSlug(name);
}

export function targetSkillInstallPath(config, targetSkill = null) {
  if (targetSkill?.installPath) return targetSkill.installPath;
  if (targetSkill?.targetSkillInstallPath) return targetSkill.targetSkillInstallPath;
  if (targetSkill?.path) return targetSkill.path;
  if (!targetSkill && config.locations.targetSkillInstallPath) return config.locations.targetSkillInstallPath;
  const slug = targetSkill ? skillSlug(targetSkill.name ?? targetSkill.targetSkillName ?? targetSkill.skill) : targetSkillSlug(config);
  if (!slug || !config.locations.consumerRoot) return null;
  return join(config.locations.consumerRoot, ".codex", "skills", slug);
}

export function configuredTargetSkills(config) {
  if (Array.isArray(config.targetSkills) && config.targetSkills.length > 0) {
    return config.targetSkills.map((targetSkill) => normalizeTargetSkill(config, targetSkill));
  }
  const slug = targetSkillSlug(config);
  const installPath = targetSkillInstallPath(config);
  if (!slug && !installPath) return [];
  return [normalizeTargetSkill(config, {
    name: config.targetSkillName,
    installPath
  })];
}

export function checkTargetSkillInstalled(runDir, config) {
  const result = inspectTargetSkill(config, { checkedAt: new Date().toISOString() });
  writeJson(join(runDir, "target-skill-check.json"), result);
  return result;
}

export function requireTargetSkillInstalled(runDir, config) {
  const result = checkTargetSkillInstalled(runDir, config);
  if (!result.ok) {
    const error = new Error(result.reason);
    error.code = "target_skill_missing";
    error.targetSkillCheck = result;
    throw error;
  }
  return result;
}

export function inspectTargetSkill(config, extra = {}) {
  if (config.targetSkillName && Array.isArray(config.targetSkills) && config.targetSkills.length > 0) {
    return {
      ...extra,
      ok: false,
      reason: "targetSkillName cannot be combined with targetSkills",
      skills: []
    };
  }
  const targets = configuredTargetSkills(config);
  if (targets.length !== 1 || (Array.isArray(config.targetSkills) && config.targetSkills.length > 0)) {
    return inspectTargetSkills(config, extra);
  }
  return inspectSingleTargetSkill(targets[0], extra);
}

export function inspectTargetSkills(config, extra = {}) {
  const skills = configuredTargetSkills(config).map((targetSkill) => inspectSingleTargetSkill(targetSkill));
  return {
    ...extra,
    ok: skills.every((skill) => skill.ok),
    reason: skills.find((skill) => !skill.ok)?.reason ?? null,
    skills
  };
}

export function inspectNamedTargetSkill(targetSkill, extra = {}) {
  const normalized = {
    slug: skillSlug(targetSkill?.name ?? targetSkill?.targetSkillName ?? targetSkill?.skill),
    targetSkillName: targetSkill?.targetSkillName ?? targetSkill?.name ?? targetSkill?.skill ?? null,
    installPath: targetSkill?.installPath ?? targetSkill?.targetSkillInstallPath ?? targetSkill?.path ?? null
  };
  return inspectSingleTargetSkill(normalized, extra);
}

function inspectSingleTargetSkill(targetSkill, extra = {}) {
  const slug = targetSkill.slug;
  const installPath = targetSkill.installPath;
  const result = {
    ...extra,
    name: slug,
    targetSkillName: targetSkill.targetSkillName,
    targetSkillSlug: slug,
    installPath,
    ok: true,
    reason: null,
    manifest: null,
    installPlan: installPlan(slug, installPath)
  };

  if (!slug && !installPath) return result;
  if (!installPath) return fail(result, "targetSkillInstallPath could not be resolved");
  if (!existsSync(installPath)) return fail(result, `target skill install path is missing: ${installPath}`);
  if (!statSync(installPath).isDirectory()) return fail(result, `target skill install path is not a directory: ${installPath}`);

  const skillFiles = readdirSync(installPath).filter((name) => name.toLowerCase() === "skill.md");
  if (skillFiles.length === 0) return fail(result, `target skill SKILL.md is missing under: ${installPath}`);
  if (skillFiles.length > 1) return fail(result, `target skill bundle contains multiple SKILL.md files under: ${installPath}`);

  const manifestPath = join(installPath, skillFiles[0]);
  const manifest = parseSkillManifest(readFileSync(manifestPath, "utf8"));
  if (!manifest.ok) return fail(result, manifest.reason);
  result.manifest = {
    path: manifestPath,
    name: manifest.name,
    description: manifest.description
  };
  if (slug && manifest.name !== slug) return fail(result, "target skill manifest name does not match targetSkillName");
  return result;
}

function normalizeTargetSkill(config, targetSkill) {
  const input = typeof targetSkill === "string" ? { name: targetSkill } : (targetSkill ?? {});
  const slug = skillSlug(input.name ?? input.targetSkillName ?? input.skill);
  const targetSkillName = slug ? `$${slug}` : (input.name ?? input.targetSkillName ?? null);
  return {
    ...input,
    slug,
    name: slug,
    targetSkillName,
    installPath: targetSkillInstallPath(config, input)
  };
}

function skillSlug(name) {
  if (!name) return null;
  return String(name).replace(/^\$/, "");
}

function installPlan(slug, destination) {
  return {
    defaultMode: "project-local-copy",
    destination,
    note: slug
      ? `Install or copy the ${slug} skill into the project-local consumer .codex/skills directory before dispatch.`
      : "Configure a target skill name and project-local install path before dispatch."
  };
}

function parseSkillManifest(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { ok: false, reason: "target skill SKILL.md is missing YAML front matter" };

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  if (!fields.name) return { ok: false, reason: "target skill SKILL.md front matter is missing name" };
  if (!fields.description) return { ok: false, reason: "target skill SKILL.md front matter is missing description" };
  return { ok: true, name: fields.name, description: fields.description };
}

function fail(result, reason) {
  result.ok = false;
  result.reason = reason;
  return result;
}
