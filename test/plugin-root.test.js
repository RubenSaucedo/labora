import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pluginRoot, pathLabel } from "../src/lib/paths.js";
import { stageDefinitions, stageStatus } from "../src/lib/run-manifest.js";

// A persona workspace that happens to contain directories named `agents/` and
// `skills/` - which the real one does, from an earlier copy of this plugin.
function decoyWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-decoy-"));
  const files = {
    [path.join(root, "agents", "judge-ats.agent.md")]: "DECOY judge prompt\n",
    [path.join(root, "agents", "judge-engineer.agent.md")]: "DECOY judge prompt\n",
    [path.join(root, "agents", "judge-hr.agent.md")]: "DECOY judge prompt\n",
    [path.join(root, "skills", "resume-conventions", "SKILL.md")]: "DECOY conventions\n",
    [path.join(root, "skills", "judge-ats", "SKILL.md")]: "DECOY judge skill\n",
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function fixtureApplication() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-app-"));
  const app = path.join(root, "personas", "example", "applications", "job");
  fs.mkdirSync(app, { recursive: true });
  return app;
}

test("pluginRoot is the plugin's own directory, not the caller's", () => {
  assert.ok(
    fs.existsSync(path.join(pluginRoot, "src", "lib", "run-manifest.js")),
    "pluginRoot must contain labora's sources"
  );
  assert.ok(
    fs.existsSync(path.join(pluginRoot, ".claude-plugin", "plugin.json")),
    "pluginRoot must contain the plugin manifest"
  );
});

test("stage dependencies on labora's own sources resolve from an unrelated cwd", () => {
  const app = fixtureApplication();
  const original = process.cwd();
  process.chdir(decoyWorkspace());
  try {
    const definitions = stageDefinitions({
      personaRoot: path.dirname(path.dirname(app)),
      applicationDir: app,
      style: 1,
    });
    const pluginPaths = Object.values(definitions)
      .flatMap((definition) => definition.dependencies || [])
      .filter((target) => target && target.startsWith(pluginRoot + path.sep));

    assert.ok(pluginPaths.length > 40, `expected labora's own sources among dependencies, got ${pluginPaths.length}`);
    const missing = pluginPaths.filter((target) => !fs.existsSync(target));
    assert.deepEqual(missing, [], "every declared plugin source must exist");
  } finally {
    process.chdir(original);
  }
});

// The regression this file exists for. A judge verdict is certified against a
// hash of the prompt it ran under. When that prompt was resolved from the
// current directory, a workspace holding its own copy of `agents/` and
// `skills/` silently supplied the text - so the artifact being judged could
// determine what the judge was measured against.
test("judge prompt inputs come from the plugin even when the workspace shadows them", () => {
  const app = fixtureApplication();
  const personaRoot = path.dirname(path.dirname(app));
  const decoy = decoyWorkspace();

  const judgeDependencies = () =>
    stageDefinitions({ personaRoot, applicationDir: app, style: 1 })
      .judge_ats.dependencies.filter((target) => /judge-ats|resume-conventions/.test(target));

  const original = process.cwd();
  process.chdir(decoy);
  let fromDecoy;
  try {
    fromDecoy = judgeDependencies();
  } finally {
    process.chdir(original);
  }

  assert.ok(fromDecoy.length >= 3, "expected the judge prompt inputs among dependencies");
  for (const target of fromDecoy) {
    assert.ok(
      target.startsWith(pluginRoot + path.sep),
      `judge prompt input must come from the plugin, got ${target}`
    );
    assert.ok(
      !target.startsWith(decoy + path.sep),
      `judge prompt input must not be readable from the workspace, got ${target}`
    );
  }
  assert.deepEqual(fromDecoy, judgeDependencies(), "judge prompt inputs must not depend on cwd");
});

test("a stage fingerprint is identical from the plugin root and from a decoy workspace", () => {
  const app = fixtureApplication();
  const original = process.cwd();

  process.chdir(pluginRoot);
  const fromPlugin = stageStatus({ applicationDir: app, style: 1 }).stages.judge_ats.fingerprint;
  process.chdir(decoyWorkspace());
  const fromDecoy = stageStatus({ applicationDir: app, style: 1 }).stages.judge_ats.fingerprint;
  process.chdir(original);

  assert.equal(fromDecoy, fromPlugin, "freshness must not change with the caller's directory");
});

// Absent files hash to the constant "MISSING", which is stable, so a wrong root
// makes every stage report fresh forever instead of failing.
test("a pluginRoot without labora's sources is refused rather than hashed as MISSING", () => {
  const app = fixtureApplication();
  assert.throws(
    () => stageStatus({ pluginRoot: os.tmpdir(), applicationDir: app, style: 1 }),
    /does not contain labora's sources/
  );
});

test("pathLabel names a file by the most specific root that contains it", () => {
  const roots = {
    plugin: "/p",
    persona: "/w/personas/ruben",
    application: "/w/personas/ruben/applications/job",
  };
  assert.equal(pathLabel("/p/skills/judge-ats/SKILL.md", roots), "plugin:skills/judge-ats/SKILL.md");
  assert.equal(pathLabel("/w/personas/ruben/profile/career.md", roots), "persona:profile/career.md");
  assert.equal(
    pathLabel("/w/personas/ruben/applications/job/resume.json", roots),
    "application:resume.json"
  );
  assert.equal(pathLabel("/elsewhere/file.md", roots), "absolute:/elsewhere/file.md");
});
