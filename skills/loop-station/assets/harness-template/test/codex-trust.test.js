import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { codexConfigPath, markProjectsTrusted, missingTrustedRoots, trustedProjectRoots } from "../src/codex-trust.js";

describe("codex trust preflight", () => {
  it("marks missing roots as trusted in the codex config", () => {
    const home = mkdtempSync(join(tmpdir(), "loop-station-codex-trust-"));
    const configPath = codexConfigPath(home);
    const result = markProjectsTrusted(configPath, [
      "/tmp/loop-station-a",
      "/tmp/loop-station-b"
    ]);

    assert.equal(result.updated, true);
    assert.equal(existsSync(configPath), true);
    const text = readFileSync(configPath, "utf8");
    assert.match(text, /\[projects\."\/tmp\/loop-station-a"\]/);
    assert.match(text, /trust_level = "trusted"/);
    assert.deepEqual(trustedProjectRoots(text), ["/tmp/loop-station-a", "/tmp/loop-station-b"]);
  });

  it("treats descendant paths as already trusted when an ancestor root is trusted", () => {
    const text = `
[projects."/tmp/loop-station-root"]
trust_level = "trusted"
`;

    const missing = missingTrustedRoots([
      "/tmp/loop-station-root/subdir",
      "/tmp/other-root"
    ], text);

    assert.deepEqual(missing, ["/tmp/other-root"]);
  });
});
