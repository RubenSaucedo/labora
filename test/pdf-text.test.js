import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pdf-text does not treat --metadata as the extraction output path", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "src", "tools", "pdf-text.js"),
      "input.pdf",
      "--metadata",
      "metadata.json",
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--metadata requires output\.md/);
});
