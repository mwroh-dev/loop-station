import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function codexConfigPath(home = process.env.HOME ?? homedir()) {
  return resolve(home, ".codex", "config.toml");
}

export function trustedProjectRoots(text) {
  const trusted = [];
  const blocks = text.matchAll(/\[projects\."([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g);
  for (const [, path, body] of blocks) {
    if (/trust_level\s*=\s*["']trusted["']/.test(body)) trusted.push(resolve(path));
  }
  return trusted;
}

export function missingTrustedRoots(roots, text = "") {
  const trusted = trustedProjectRoots(text);
  return [...new Set(roots.map((root) => resolve(root)).filter(Boolean))]
    .filter((root) => !trusted.some((trustedRoot) => root === trustedRoot || root.startsWith(`${trustedRoot}/`)));
}

export function markProjectsTrusted(configPath, roots) {
  const path = resolve(configPath);
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const missing = missingTrustedRoots(roots, current);
  if (missing.length === 0) return { updated: false, missing: [] };
  const appended = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${missing.map((root) => `\n[projects."${root.replaceAll("\"", "\\\"")}"]\ntrust_level = "trusted"\n`).join("")}`;
  writeFileSync(path, appended);
  return { updated: true, missing };
}
