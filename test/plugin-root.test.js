import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pluginRoot, pathLabel } from "../src/lib/paths.js";
import { pluginAgentFiles, pluginAgentPath } from "../src/lib/plugin-components.js";

function decoyWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-decoy-"));
  const files = {
    [path.join(root, "agents", "resume-reviewer.agent.md")]: "DECOY reviewer prompt\n",
    [path.join(root, "skills", "resume-conventions", "SKILL.md")]: "DECOY conventions\n",
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("pluginRoot is the plugin's own directory, not the caller's", () => {
  assert.ok(fs.existsSync(path.join(pluginRoot, "src", "lib", "paths.js")));
  assert.ok(fs.existsSync(path.join(pluginRoot, ".claude-plugin", "plugin.json")));
});

test("plugin component discovery ignores workspace prompt shadows", () => {
  const original = process.cwd();
  const decoy = decoyWorkspace();
  process.chdir(decoy);
  try {
    const agents = pluginAgentFiles(pluginRoot);
    const skills = walk(path.join(pluginRoot, "skills")).filter((file) => path.basename(file) === "SKILL.md");
    assert.ok(agents.length > 0);
    assert.ok(skills.length > 0);
    for (const file of [...agents, ...skills]) {
      assert.ok(file.startsWith(pluginRoot + path.sep), `${file} must come from the plugin`);
      assert.ok(!file.startsWith(decoy + path.sep), `${file} must not come from the workspace`);
    }
  } finally {
    process.chdir(original);
  }
});

test("pluginAgentPath resolves named agents from the plugin tree", () => {
  const reviewer = pluginAgentPath(pluginRoot, "resume-reviewer");
  assert.equal(path.basename(reviewer), "resume-reviewer.agent.md");
  assert.ok(reviewer.startsWith(pluginRoot + path.sep));
  assert.ok(fs.readFileSync(reviewer, "utf8").includes("rendered resume text"));
});

test("pathLabel names a file by the most specific root that contains it", () => {
  const roots = {
    plugin: "/p",
    persona: "/w/personas/example",
    application: "/w/personas/example/applications/job",
  };
  assert.equal(pathLabel("/p/skills/start/SKILL.md", roots), "plugin:skills/start/SKILL.md");
  assert.equal(pathLabel("/w/personas/example/profile/career.md", roots), "persona:profile/career.md");
  assert.equal(
    pathLabel("/w/personas/example/applications/job/resume.json", roots),
    "application:resume.json"
  );
  assert.equal(pathLabel("/elsewhere/file.md", roots), "absolute:/elsewhere/file.md");
});

test("no grouped tool resolves a persona through a hardcoded relative data path", () => {
  const toolsDir = path.join(pluginRoot, "src", "tools");
  const offenders = [];
  for (const file of walk(toolsDir)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    if (/path\.join\(\s*["'`]data\/personas/.test(source)) offenders.push(path.relative(toolsDir, file));
  }
  assert.deepEqual(
    offenders,
    [],
    "these tools must call resolvePersonaRoot() instead of joining a relative persona path",
  );
});
