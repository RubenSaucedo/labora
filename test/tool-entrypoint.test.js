import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = path.join(ROOT, "src", "tools");

/**
 * A tool that decides whether it was run directly by comparing `import.meta.url`
 * against a hand-built `file://${process.argv[1]}` is comparing two different
 * things on Windows: Node produces `file:///C:/x/y.js` while the template
 * produces `file://C:\x\y.js`. The comparison is false, `main()` never runs, and
 * the process exits 0 having done nothing.
 *
 * That failure mode is worse than a crash. `labora validate-profile` returned
 * success and printed nothing, which reads exactly like a clean pass, so a
 * person could ship a resume believing it had been checked.
 */
test("no tool decides its entrypoint with a hand-built file:// URL", () => {
  const offenders = [];
  for (const entry of fs.readdirSync(TOOLS)) {
    if (!entry.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(TOOLS, entry), "utf-8");
    if (body.includes("`file://${process.argv[1]}`")) offenders.push(entry);
  }
  assert.deepEqual(
    offenders,
    [],
    `these compare import.meta.url to a hand-built URL and silently no-op on Windows: ${offenders.join(", ")}`
  );
});

test("the hand-built form and the correct form actually differ on Windows", () => {
  const sample = path.join(TOOLS, "validate-profile.js");
  const correct = pathToFileURL(sample).href;
  const handBuilt = `file://${sample}`;
  if (path.sep === "\\") {
    assert.notEqual(handBuilt, correct, "on Windows these must differ — that is the bug");
  } else {
    assert.equal(handBuilt, correct, "on POSIX they coincide, which is why this shipped");
  }
});

test("a tool invoked through the dispatcher actually runs its main path", () => {
  // The regression is silence, so the assertion has to be that output exists.
  // `--help`-less tools report usage on stderr and exit non-zero when given no
  // arguments; the failure being guarded against produced neither.
  const result = spawnSync(process.execPath, [path.join(ROOT, "bin", "labora"), "validate-profile"], {
    encoding: "utf-8",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, "a tool with no arguments must not report success");
  assert.ok(output.trim().length > 0, "a tool that runs must say something");
});
