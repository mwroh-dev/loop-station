#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { ROLE_PRESET_DEFINITIONS, ROLE_TYPE_ORDER, SHARED_TRAIT_PACKS } from "./definitions.js";

const presetRoot = dirname(fileURLToPath(import.meta.url));

export function generatePresetArtifacts(root = presetRoot) {
  const sharedRoot = join(root, "shared");
  const rolesRoot = join(root, "roles");

  rmSync(sharedRoot, { recursive: true, force: true });
  rmSync(rolesRoot, { recursive: true, force: true });

  for (const role of ROLE_TYPE_ORDER) {
    writeJson(join(sharedRoot, `${role}.json`), SHARED_TRAIT_PACKS[role]);
    for (const preset of ROLE_PRESET_DEFINITIONS[role] ?? []) {
      writeJson(join(rolesRoot, role, `${preset.specialization}.json`), preset);
    }
  }
}

function writeJson(path, value) {
  writeText(path, JSON.stringify(value, null, 2));
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${value.trimEnd()}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generatePresetArtifacts();
}
