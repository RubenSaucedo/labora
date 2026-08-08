import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.join(repoRoot, "skills");
const agentsDir = path.join(repoRoot, "agents");

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

// The manifest and the package describe the same artifact. Bumping one and
// forgetting the other publishes a version that resolves differently depending
// on which file the consumer trusts.
test("plugin.json and package.json versions match", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugin.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    plugin.version,
    pkg.version,
    `plugin.json is ${plugin.version} but package.json is ${pkg.version}`,
  );
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

// `user-invocable` defaults to TRUE in Claude Code, so a skill that omits it is
// published as a slash command by accident. Internal pipeline stages must say
// `false` out loud; leaving it off would expose the judges and the tailoring
// stage as a public API the operator can invoke outside its isolated agent.
test("every skill declares user-invocable explicitly", () => {
  const undeclared = [];
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    const declared = field("user-invocable");
    if (declared !== "true" && declared !== "false") undeclared.push(dir);
  }
  assert.deepEqual(
    undeclared,
    [],
    "these skills omit user-invocable, so the runtime default decides whether " +
      `they are public:\n${undeclared.join("\n")}`,
  );
});

// The stages below either write profile/generated/, run inside a deliberately
// isolated agent, or grade the pipeline. Exposing any of them as a slash command
// hands the operator a documented way around the boundary it enforces.
test("isolated and generated-writing stages stay internal", () => {
  const mustBeInternal = [
    "judge-ats",
    "judge-engineer",
    "judge-hr",
    "resume-persona",
    "resume-tailor",
    "scaffold-persona",
  ];
  const exposed = [];
  for (const dir of mustBeInternal) {
    assert.ok(skillDirs.includes(dir), `skills/${dir} is missing`);
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    if (field("user-invocable") !== "false") exposed.push(dir);
  }
  assert.deepEqual(exposed, [], `these must not be user-invocable:\n${exposed.join("\n")}`);
});

// Slash commands only ship from skills/. `.claude/` is project configuration:
// Copilot CLI's plugin loader recognises *.agent.md, **\/SKILL.md, mcp-config.json
// and plugin.json, and nothing else, so anything left there reaches only people
// sitting in this repo.
test("no slash commands hide in project-scoped .claude/", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, ".claude", "commands")),
    false,
    ".claude/commands/ is project config, not a plugin path; installed users never see it",
  );
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

// A plugin is installed to an unpredictable path and invoked from the persona
// workspace, so "node src/tools/x.js" resolves to nothing. Every documented
// invocation has to go through the dispatcher, which locates itself.
test("no instruction file tells an agent to run a tool by relative path", () => {
  const offenders = [];
  const roots = ["skills", "agents", "templates", "src"];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|js)$/.test(entry.name)) {
        const raw = fs.readFileSync(full, "utf8");
        if (raw.includes("node src/tools/")) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));
  assert.deepEqual(
    offenders,
    [],
    `these tell the caller to run a tool relative to the plugin root, which is not the working directory:\n${offenders.join("\n")}`,
  );
});

// The dispatcher's whole job is to report a broken install. If it imported a
// dependency it would crash exactly when it is most needed.
test("the dispatcher depends on nothing but Node itself", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "bin", "labora"), "utf8");
  const external = [...raw.matchAll(/^import\s+.*?from\s+"([^"]+)"/gm)]
    .map(([, spec]) => spec)
    .filter((spec) => !spec.startsWith("node:"));
  assert.deepEqual(
    external,
    [],
    `bin/labora must run on an install where nothing is installed, but imports ${external.join(", ")}`,
  );
  assert.ok(raw.startsWith("#!/usr/bin/env node"), "bin/labora needs a shebang to be executable");
  // eslint-disable-next-line no-bitwise
  assert.ok(fs.statSync(path.join(repoRoot, "bin", "labora")).mode & 0o111, "bin/labora must be executable");
});

// The hook is what tells the model where the dispatcher actually lives.
//
// The events must sit under a "hooks" key. A file that puts them at the top
// level parses as valid JSON and is silently discarded - the CLI logs
// "hooks must be an object" to a debug log and starts normally, so the only
// visible symptom is a hook that never runs. This shipped once already.
test("the plugin registers a hook that announces the dispatcher", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugin.json"), "utf8"));
  assert.equal(manifest.hooks, "hooks.json", "plugin.json must point at the hook file");
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest.hooks), "utf8"));

  assert.ok(
    config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks),
    'hook events must be nested under a "hooks" object, or the runtime discards the file silently',
  );
  assert.ok(
    !config.sessionStart,
    "sessionStart is at the top level, where the runtime will not look for it",
  );

  const handlers = config.hooks.sessionStart || [];
  assert.ok(handlers.length > 0, "a sessionStart handler is required");
  for (const handler of handlers) {
    assert.equal(handler.type, "command", "each handler needs an explicit type");
    assert.ok(handler.timeoutSec > 0, "a hook without a timeout can hang session startup");
  }
  const commands = handlers.map((h) => h.bash || h.command || "");
  assert.ok(
    commands.some((c) => c.includes("PLUGIN_ROOT") && c.includes("bin/labora")),
    "the sessionStart hook must resolve bin/labora through the plugin root the runtime provides",
  );
});

// The hook's stdout is parsed as JSON by the runtime. If announce ever printed
// a bare string or a stray log line, the hook would fail the same silent way.
test("announce emits exactly one line of parseable hook output", () => {
  const result = spawnSync(path.join(repoRoot, "bin", "labora"), ["announce"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "announce must succeed even when dependencies are missing");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "multi-line output would not parse as a hook response");
  const parsed = JSON.parse(lines[0]);
  assert.equal(typeof parsed.additionalContext, "string");
  assert.ok(
    parsed.additionalContext.includes(path.join(repoRoot, "bin", "labora")),
    "the announcement must carry the absolute dispatcher path; that is its whole purpose",
  );
});
