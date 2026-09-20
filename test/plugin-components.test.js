import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  pluginAgentFiles,
  pluginAgentLogicalPath,
  pluginAgentPath,
  pluginAgentPromptLabel,
  pluginComponentDirectories,
} from "../src/lib/plugin-components.js";

function pluginFixture(agentDirectories) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-plugin-components-"));
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "fixture", agents: agentDirectories })
  );
  return root;
}

function writeAgent(root, directory, name) {
  const target = path.join(root, directory, `${name}.agent.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `---\nname: ${name}\n---\n`);
  return target;
}

test("agent discovery follows every directory declared by the plugin manifest", () => {
  const root = pluginFixture(["agents/judges/", "agents/builders/"]);
  const judge = writeAgent(root, "agents/judges", "judge-example");
  const builder = writeAgent(root, "agents/builders", "builder-example");

  assert.deepEqual(pluginAgentFiles(root), [builder, judge].sort());
  assert.equal(pluginAgentPath(root, "judge-example"), judge);
});

test("agent lookup rejects duplicate names across configured directories", () => {
  const root = pluginFixture(["agents/first/", "agents/second/"]);
  writeAgent(root, "agents/first", "duplicate");
  writeAgent(root, "agents/second", "duplicate");

  assert.throws(
    () => pluginAgentPath(root, "duplicate"),
    /Expected exactly one plugin agent named "duplicate", found 2/
  );
});

test("agent logical identity does not depend on its configured directory", () => {
  assert.equal(
    pluginAgentLogicalPath("agents/judges/judge-example.agent.md"),
    "agents/judge-example.agent.md"
  );
  assert.equal(
    pluginAgentLogicalPath("agents/legacy/judge-example.agent.md"),
    "agents/judge-example.agent.md"
  );
  assert.equal(
    pluginAgentPromptLabel("agents/judges/judge-example.agent.md"),
    path.join("agents", "judge-example.agent.md")
  );
});

test("component directories cannot escape the plugin root", () => {
  const root = pluginFixture(["../outside/"]);

  assert.throws(
    () => pluginComponentDirectories(root, "agents", "agents/"),
    /must stay inside the plugin root/
  );
});
