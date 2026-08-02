import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.join(repoRoot, "skills");
const agentsDir = path.join(repoRoot, "agents");
const commandsDir = path.join(repoRoot, ".claude", "commands");

function frontmatter(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  assert.ok(match, `${path.relative(repoRoot, file)} must open with YAML frontmatter`);
  const field = (key) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1]);
    return found ? found[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return { field, block: match[1], body: raw.slice(match[0].length) };
}

const skillDirs = fs
  .readdirSync(skillsDir)
  .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md")));

test("plugin.json declares directories that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugin.json"), "utf8"));
  for (const key of ["name", "description", "version", "agents", "skills"]) {
    assert.ok(manifest[key], `plugin.json is missing "${key}"`);
  }
  for (const key of ["agents", "skills"]) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, manifest[key])),
      `plugin.json points "${key}" at ${manifest[key]}, which does not exist`,
    );
  }
});

test("every skill name matches its directory", () => {
  assert.ok(skillDirs.length > 0, "no skills found");
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    assert.equal(
      field("name"),
      dir,
      `skills/${dir}/SKILL.md declares name "${field("name")}"; the loader resolves by ` +
        "directory, so a mismatch makes the skill unreachable",
    );
  }
});

// argument-hint is the only thing telling the operator what a user-invocable
// skill expects. Without it the skill is discoverable but not usable.
test("user-invocable skills carry an argument hint and a description", () => {
  const invocable = [];
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    if (field("user-invocable") !== "true") continue;
    invocable.push(dir);
    assert.ok(field("argument-hint"), `skills/${dir} is user-invocable but has no argument-hint`);
    assert.ok(field("description"), `skills/${dir} is user-invocable but has no description`);
  }
  assert.ok(invocable.length > 0, "no user-invocable entry points; the plugin has no front door");
});

test("commands reference skills and agents that exist", () => {
  const missing = [];
  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(commandsDir, file), "utf8");

    for (const [, skill] of text.matchAll(/skills\/([a-z0-9-]+)\/SKILL\.md/g)) {
      if (!skillDirs.includes(skill)) missing.push(`${file} -> skills/${skill}/SKILL.md`);
    }
    for (const [, agent] of text.matchAll(/agents\/([a-z0-9-]+)\.agent\.md/g)) {
      if (!fs.existsSync(path.join(agentsDir, `${agent}.agent.md`))) {
        missing.push(`${file} -> agents/${agent}.agent.md`);
      }
    }
  }
  assert.deepEqual(missing, [], `commands point at files that do not exist:\n${missing.join("\n")}`);
});

// Agents are only reachable as task agent_types once the plugin is installed.
// A skill that names one must name it exactly, or dispatch fails at run time.
test("skills dispatching to agents name real agents", () => {
  const missing = [];
  for (const dir of skillDirs) {
    const raw = fs.readFileSync(path.join(skillsDir, dir, "SKILL.md"), "utf8");
    for (const [, agent] of raw.matchAll(/labora:([a-z0-9-]+)/g)) {
      if (!fs.existsSync(path.join(agentsDir, `${agent}.agent.md`))) {
        missing.push(`skills/${dir} dispatches to labora:${agent}, which has no agent file`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});
