import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function requiredJsonArtifactsForStage(stage = {}) {
  const names = new Set(["runner-metadata.json", "output-manifest.json"]);
  for (const name of stage.requiredArtifacts ?? []) {
    if (String(name).endsWith(".json")) names.add(String(name));
  }
  for (const name of stage.outputs ?? []) {
    if (String(name).endsWith(".json")) names.add(String(name));
  }
  return [...names];
}

export function mergedArtifactSchemas(stage = {}) {
  return {
    "runner-metadata.json": defaultRunnerMetadataSchema(),
    "output-manifest.json": defaultOutputManifestSchema(),
    ...(stage.artifactSchemas ?? {})
  };
}

export function validateStageArtifactSchemasDeclared(stage = {}) {
  const schemas = mergedArtifactSchemas(stage);
  const missing = requiredJsonArtifactsForStage(stage).filter((name) => !schemas[name]);
  return {
    ok: missing.length === 0,
    missing
  };
}

export function validateStageArtifacts(stageDir, stage = {}) {
  const schemas = mergedArtifactSchemas(stage);
  const violations = [];
  for (const name of requiredJsonArtifactsForStage(stage)) {
    const path = join(stageDir, name);
    // Single stat in a guard: no double statSync, and a file that vanishes
    // between checks is treated as missing instead of throwing ENOENT.
    let stat = null;
    try { stat = statSync(path); } catch {}
    if (!stat || !stat.isFile() || stat.size === 0) {
      violations.push(`${name}: missing_or_empty`);
      continue;
    }
    let value;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      violations.push(`${name}: invalid_json (${error.message})`);
      continue;
    }
    const schema = schemas[name];
    if (!schema) {
      violations.push(`${name}: missing_schema`);
      continue;
    }
    const errors = validateValueAgainstSchema(value, schema, "$");
    for (const error of errors) violations.push(`${name}: ${error}`);
  }
  return violations;
}

export function evidenceIncludesSkill(evidence, stageSkill) {
  if (!stageSkill) return true;
  const expected = String(stageSkill).replace(/^\$/, "");
  const items = Array.isArray(evidence) ? evidence : [evidence];
  return items.some((item) => {
    if (typeof item === "string") return item.includes(expected) || item.includes(`$${expected}`);
    if (item && typeof item === "object") {
      const skill = String(item.skill ?? item.name ?? "");
      return skill === expected || skill === `$${expected}` || skill.replace(/^\$/, "") === expected;
    }
    return false;
  });
}

function defaultRunnerMetadataSchema() {
  return {
    type: "object",
    required: ["messageId", "agentName", "phaseEvidence", "skillRuntimeEvidence", "status"],
    properties: {
      messageId: { type: "string", minLength: 1 },
      agentName: { type: "string", minLength: 1 },
      phaseEvidence: {
        anyOf: [
          { type: "array", minItems: 1 },
          { type: "string", minLength: 1 },
          { type: "object", minProperties: 1 }
        ]
      },
      skillRuntimeEvidence: {
        anyOf: [
          { type: "array", minItems: 1 },
          { type: "string", minLength: 1 },
          { type: "object", minProperties: 1 }
        ]
      },
      status: { type: "string", minLength: 1 }
    }
  };
}

function defaultOutputManifestSchema() {
  return {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", minLength: 1 },
      outputs: { type: "array" },
      verification: { type: "object" }
    }
  };
}

function validateValueAgainstSchema(value, schema, path) {
  const errors = [];
  if (schema.anyOf) {
    const anyErrors = schema.anyOf.map((candidate) => validateValueAgainstSchema(value, candidate, path));
    if (anyErrors.every((candidateErrors) => candidateErrors.length > 0)) {
      errors.push(`${path}: no anyOf schema matched`);
    }
    return errors;
  }

  if (schema.type) {
    const actual = valueType(value);
    if (schema.type !== actual) {
      errors.push(`${path}: expected ${schema.type}, got ${actual}`);
      return errors;
    }
  }

  if (schema.minLength && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.minItems && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path}: fewer than minItems ${schema.minItems}`);
  }
  if (schema.minProperties && isPlainObject(value) && Object.keys(value).length < schema.minProperties) {
    errors.push(`${path}: fewer than minProperties ${schema.minProperties}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: not in enum`);
  }
  if (schema.required && isPlainObject(value)) {
    for (const key of schema.required) {
      if (!(key in value)) errors.push(`${path}.${key}: missing`);
    }
  }
  if (schema.properties && isPlainObject(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (!(key in value)) continue;
      errors.push(...validateValueAgainstSchema(value[key], childSchema, `${path}.${key}`));
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validateValueAgainstSchema(item, schema.items, `${path}[${index}]`));
    });
  }
  return errors;
}

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value === "object" ? "object" : typeof value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
