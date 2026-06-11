import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  // Write-then-rename keeps state files readable even if the process dies mid-write.
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tempPath, path);
  } catch (error) {
    // Don't leave an orphaned temp file behind on a failed write/rename.
    try { rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

export function appendJsonLine(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "a" });
}

export function removePath(path) {
  rmSync(path, { recursive: true, force: true });
}
