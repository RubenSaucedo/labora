import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { pluginRoot } from "../src/lib/paths.js";
import { requiredDependencies } from "../src/lib/tool-dependencies.js";

const toolsDir = path.join(pluginRoot, "src", "tools");
const declared = Object.keys(
  JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).dependencies || {}
);
const tools = fs
  .readdirSync(toolsDir)
  .filter((entry) => entry.endsWith(".js"))
  .map((entry) => entry.slice(0, -3));

const depsFor = (tool) => requiredDependencies(path.join(toolsDir, `${tool}.js`), declared);

test("a tool never requires a package the plugin does not declare", () => {
  for (const tool of tools) {
    for (const name of depsFor(tool)) {
      assert.ok(declared.includes(name), `${tool} requires undeclared ${name}`);
    }
  }
});

// The regression. Gating every tool on every dependency meant that on a machine
// which cannot install - no network route to a registry, or no npm at all - even
// tools importing nothing beyond Node were refused, so the pipeline looked
// entirely dead when a third of it was fine.
test("tools that import no dependency require none", () => {
  for (const tool of ["run-state", "triage-gaps", "parse-job", "resume-text"]) {
    assert.deepEqual(depsFor(tool), [], `${tool} must run with no dependency installed`);
  }
});

test("the walk follows internal imports transitively, not just direct ones", () => {
  // quality-gate.js imports no package directly; it reaches mammoth and
  // pdf-parse only through src/lib. A direct-import check would clear it and
  // then fail at runtime inside a library.
  const source = fs.readFileSync(path.join(toolsDir, "quality-gate.js"), "utf8");
  for (const name of ["mammoth", "pdf-parse"]) {
    assert.ok(!source.includes(`"${name}"`), `${name} is expected to be an indirect import`);
    assert.ok(depsFor("quality-gate").includes(name), `quality-gate must require ${name}`);
  }
});

test("rendering and validation still require their packages", () => {
  assert.deepEqual(depsFor("format-docx"), ["docx", "puppeteer-core", "zod"]);
  assert.ok(depsFor("validate-claims").includes("zod"));
  assert.ok(depsFor("artifact-text").includes("pdf-parse"));
});

test("an optional dependency never gates a tool", () => {
  const optional = Object.keys(
    JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"))
      .optionalDependencies || {}
  );
  assert.ok(optional.length > 0, "expected at least one optional dependency to guard");
  for (const tool of tools) {
    for (const name of optional) {
      assert.ok(!depsFor(tool).includes(name), `${tool} must not be gated on optional ${name}`);
    }
  }
});

// bin/labora runs before anything is installed, so it may import only Node's
// standard library and labora's own dependency-free sources.
test("the dependency gate itself loads with no dependency installed", () => {
  const entry = path.join(pluginRoot, "src", "lib", "tool-dependencies.js");
  const reachable = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    const source = fs.readFileSync(file, "utf8");
    // Anchored to the start of a line so prose in a comment that happens to
    // contain `from "x"` is not read as an import.
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)[^\n]*?from\s*["']([^"']+)["']/gm)) {
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith("."), `${path.basename(file)} may not import ${specifier}`);
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
});

test("a dependency-free tool is dispatched rather than refused when node_modules is absent", () => {
  // `--help` exits non-zero by design, so the exit code says nothing about the
  // gate. What matters is which message came back: the tool's own usage means
  // it was dispatched, the refusal means the gate stopped it.
  const result = spawnSync(
    process.execPath,
    [path.join(pluginRoot, "bin", "labora"), "run-state", "--help"],
    { encoding: "utf8" }
  );
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(
    !/not installed/.test(output),
    `a dependency-free tool must not be refused by the dependency gate, got: ${output}`
  );
  assert.match(output, /Usage: labora run-state/, "expected the tool's own usage");
});

test("a tool that needs a package is still refused, and the message names only that package", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(pluginRoot, "bin", "labora"), "format-docx"],
    { encoding: "utf8" }
  );
  if (!/not installed/.test(result.stderr)) return; // dependencies are installed here
  assert.match(result.stderr, /format-docx needs/, "the refusal must name the tool");
  assert.ok(
    !/mammoth/.test(result.stderr.split("These")[0]),
    "the refusal must not name a package this tool does not use"
  );
});
