import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginAgentFiles } from "../src/lib/plugin-components.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(repoRoot, ".claude-plugin", "plugin.json");
const MARKETPLACE_PATH = path.join(repoRoot, ".claude-plugin", "marketplace.json");
const skillsDir = path.join(repoRoot, "skills");

function walk(dir, predicate = () => true) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, predicate));
    else if (predicate(full)) found.push(full);
  }
  return found;
}

function frontmatter(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  assert.ok(match, `${path.relative(repoRoot, file)} must open with YAML frontmatter`);
  const field = (key) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1]);
    return found ? found[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return { field, block: match[1], body: raw.slice(match[0].length), raw };
}

const skillDirs = fs
  .readdirSync(skillsDir)
  .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md")))
  .sort();
const skillFiles = skillDirs.map((dir) => path.join(skillsDir, dir, "SKILL.md"));
const contractMarkdownFiles = [
  ...skillFiles,
  ...walk(path.join(repoRoot, "skills"), (file) => file.endsWith(".md") && path.basename(file) !== "SKILL.md"),
  ...pluginAgentFiles(repoRoot),
].sort();

function toolCommands() {
  const toolsDir = path.join(repoRoot, "src", "tools");
  const commands = new Set();
  for (const group of fs.readdirSync(toolsDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(toolsDir, group.name))) {
      if (entry.endsWith(".js")) commands.add(`${group.name} ${entry.slice(0, -3)}`);
    }
  }
  return commands;
}

test("plugin.json declares directories that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const key of ["name", "description", "version", "agents", "skills"]) {
    assert.ok(manifest[key], `plugin.json is missing "${key}"`);
  }
  for (const key of ["agents", "skills"]) {
    const configuredPaths = Array.isArray(manifest[key]) ? manifest[key] : [manifest[key]];
    for (const configuredPath of configuredPaths) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, configuredPath)),
        `plugin.json points "${key}" at ${configuredPath}, which does not exist`,
      );
    }
  }
});

// The three manifests describe one installable artifact. A drift here publishes
// a version that depends on which file a consumer trusted.
test("every declared version agrees", () => {
  const plugin = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(MARKETPLACE_PATH, "utf8"));
  const entry = market.plugins.find((candidate) => candidate.name === plugin.name);
  assert.equal(plugin.version, pkg.version, "plugin.json and package.json versions differ");
  assert.equal(entry?.version, plugin.version, "marketplace entry and plugin.json versions differ");
});

test("every skill name matches its directory", () => {
  assert.ok(skillDirs.length > 0, "no skills found");
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    assert.equal(
      field("name"),
      dir,
      `skills/${dir}/SKILL.md declares name "${field("name")}"; the loader resolves by directory`,
    );
  }
});

// `user-invocable` defaults to true. Internal helper skills must say false out
// loud or they publish as slash commands by accident.
test("every skill declares user-invocable explicitly", () => {
  const undeclared = [];
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    const declared = field("user-invocable");
    if (declared !== "true" && declared !== "false") undeclared.push(dir);
  }
  assert.deepEqual(undeclared, [], `skills missing user-invocable:\n${undeclared.join("\n")}`);
});

// argument-hint is the operator's shortest path to using a public slash command
// correctly. Private skills do not need one because another contract calls them.
test("user-invocable skills carry an argument hint and a description", () => {
  const invocable = [];
  for (const dir of skillDirs) {
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    if (field("user-invocable") !== "true") continue;
    invocable.push(dir);
    assert.ok(field("argument-hint"), `skills/${dir} is user-invocable but has no argument-hint`);
    assert.ok(field("description"), `skills/${dir} is user-invocable but has no description`);
  }
  assert.deepEqual(invocable.sort(), [
    "brainstorm", "draft-resume", "job-search", "log-application",
    "render-resume", "review-resume", "start", "tailor-resume",
  ].sort());
});

test("internal writing and convention skills stay internal", () => {
  const mustBeInternal = ["resume-conventions", "resume-writing", "resume-interview"];
  const exposed = [];
  for (const dir of mustBeInternal) {
    assert.ok(skillDirs.includes(dir), `skills/${dir} is missing`);
    const { field } = frontmatter(path.join(skillsDir, dir, "SKILL.md"));
    if (field("user-invocable") !== "false") exposed.push(dir);
  }
  assert.deepEqual(exposed, [], `these must not be user-invocable:\n${exposed.join("\n")}`);
});

// Slash commands only ship from skills/. Anything under .claude/ is project
// config and is invisible to installed users.
test("no slash commands hide in project-scoped .claude/", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, ".claude", "commands")),
    false,
    ".claude/commands/ is project config, not a plugin path",
  );
});

// A plugin is installed to an unpredictable path and invoked from the persona
// workspace, so implementation files are never a stable command surface.
test("no instruction file tells an agent to run a tool by relative path", () => {
  const offenders = [];
  for (const root of ["skills", "agents", "templates", "src"]) {
    const absolute = path.join(repoRoot, root);
    if (!fs.existsSync(absolute)) continue;
    for (const file of walk(absolute, (candidate) => /\.(md|js)$/.test(candidate))) {
      const raw = fs.readFileSync(file, "utf8");
      if (raw.includes("node src/tools/")) offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [], `relative tool invocations:\n${offenders.join("\n")}`);
});

// The grouped namespace is executable documentation. If prose names a command,
// that exact src/tools/<group>/<name>.js file has to exist.
test("every labora tool an agent or skill names exists in the grouped namespace", () => {
  const known = toolCommands();
  const missing = [];
  const topLevel = new Set(["announce", "doctor", "list", "setup"]);
  for (const doc of contractMarkdownFiles) {
    const text = fs.readFileSync(doc, "utf8");
    for (const match of text.matchAll(/\blabora\s+([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/g)) {
      const [, group, name] = match;
      if (!name) {
        if (!topLevel.has(group)) missing.push(`${path.relative(repoRoot, doc)} -> labora ${group} (missing tool name)`);
        continue;
      }
      const command = `${group} ${name}`;
      if (!known.has(command)) missing.push(`${path.relative(repoRoot, doc)} -> labora ${command}`);
    }
  }
  assert.deepEqual(missing, [], `documented labora commands do not exist:\n${missing.join("\n")}`);
});

// The refactor removed release gates. Contract prose must not reintroduce a
// blocking verdict by habit. Negated examples are allowed because they teach the
// boundary; web pages may be "blocked" without blocking the person.
test("skill and agent prose avoids blocking verdict vocabulary", () => {
  const offenders = [];
  const forbidden = [
    { label: "not a fit", pattern: /\bnot a fit\b/i, allowed: /no\s+"not a fit"|never\s+(?:emit|say|write)[^\n]*"?not a fit|^\s*-\s*"not a fit";?\s*$/i },
    { label: "refuse to render", pattern: /\brefuse to render\b/i, allowed: /do not|never/i },
    { label: "release gate", pattern: /\brelease gate\b/i, allowed: /no\s+release gate|removed|deleted/i },
    { label: "must not proceed", pattern: /\bmust not proceed\b/i, allowed: /never|do not/i },
    { label: "hard blocker", pattern: /\bhard blocker\b/i, allowed: /never|no\s+hard blocker/i },
    { label: "blocked", pattern: /\bblocked\b/i, allowed: /blocked page|board could not be read|do not block|never blocks/i },
  ];
  for (const file of contractMarkdownFiles) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of forbidden) {
        if (rule.pattern.test(line) && !rule.allowed.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)}:${index + 1}: ${rule.label}: ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `blocking vocabulary found:\n${offenders.join("\n")}`);
});

// Public skills should hand control back to the person with an action or a
// choice. Ending in a verdict is the old product failure in a new wrapper.
test("public skills hand control back instead of ending in a verdict", () => {
  const offenders = [];
  const control = /\b(next useful (?:step|command|question)|next action|choices? available|person(?:\'s)? decision|person deciding|someone deciding|operator is allowed to see|decision belongs|person decides|accept, edit, or reject|Never end with a verdict|what remains open|which suggestions to accept|next reminder|report what actually rendered|List artifact paths|summarize every material change)\b/i;
  for (const dir of skillDirs) {
    const file = path.join(skillsDir, dir, "SKILL.md");
    const { field, raw } = frontmatter(file);
    if (field("user-invocable") !== "true") continue;
    if (!control.test(raw)) offenders.push(dir);
  }
  assert.deepEqual(offenders, [], `public skills do not hand control back:\n${offenders.join("\n")}`);
});

// The dispatcher is the one thing that must explain a broken install. It may
// import labora's own dependency-free sources, but no package dependency.
test("the dispatcher depends on nothing but Node itself", () => {
  const entry = path.join(repoRoot, "bin", "labora");
  const offenders = [];
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const raw = fs.readFileSync(file, "utf8");
    for (const [, spec] of raw.matchAll(/^\s*import\s+.*?from\s+"([^"]+)"/gm)) {
      if (spec.startsWith("node:")) continue;
      if (!spec.startsWith(".")) {
        offenders.push(`${path.relative(repoRoot, file)} -> ${spec}`);
        continue;
      }
      queue.push(path.resolve(path.dirname(file), spec));
    }
  }

  assert.ok(seen.size > 1, "expected the walk to follow the dispatcher's own imports");
  assert.deepEqual(offenders, [], `bin/labora reaches packages:\n${offenders.join("\n")}`);
  assert.ok(fs.readFileSync(entry, "utf8").startsWith("#!/usr/bin/env node"));
  assert.ok(fs.statSync(entry).mode & 0o111, "bin/labora must be executable");
});

test("the plugin registers a hook that announces the dispatcher", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.hooks, "hooks.json", "plugin.json must point at the hook file");
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest.hooks), "utf8"));

  assert.ok(config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks));
  assert.ok(!config.sessionStart, "sessionStart belongs under hooks");
  const handlers = config.hooks.sessionStart || [];
  assert.ok(handlers.length > 0, "a sessionStart handler is required");
  for (const handler of handlers) {
    assert.equal(handler.type, "command");
    assert.ok(handler.timeoutSec > 0);
  }
  const commands = handlers.map((h) => h.bash || h.command || "");
  assert.ok(commands.some((c) => c.includes("PLUGIN_ROOT") && c.includes("bin/labora")));
});

// The hook's stdout is parsed as JSON by the runtime. A stray log line would
// make the plugin fail before any skill loaded.
test("announce emits exactly one line of parseable hook output", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "labora"), "announce"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "announce must succeed even when dependencies are missing");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "multi-line output would not parse as a hook response");
  const parsed = JSON.parse(lines[0]);
  assert.equal(typeof parsed.additionalContext, "string");
  assert.ok(parsed.additionalContext.includes(path.join(repoRoot, "bin", "labora")));
});

test("announce reports inert workspace prompt shadows without reading them", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "labora-shadow-"));
  const copiedAgents = path.join(workspace, "agents");
  const linkedSkills = path.join(workspace, "skills");
  fs.mkdirSync(copiedAgents);
  fs.writeFileSync(path.join(copiedAgents, "must-not-be-read.txt"), "untrusted instructions");
  fs.symlinkSync(skillsDir, linkedSkills, process.platform === "win32" ? "junction" : "dir");

  const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "labora"), "announce"], {
    cwd: workspace,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const context = JSON.parse(result.stdout).additionalContext;
  assert.match(context, /WORKSPACE ADVISORY/);
  assert.match(context, /agents\/ is a real directory/);
  assert.match(context, /skills\/ is an inert link into the loaded plugin/);
  assert.match(context, /never reads these paths/);
  assert.doesNotMatch(context, /untrusted instructions/);
});

test("announce distinguishes links to another install from dangling links", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "labora-shadow-links-"));
  const otherInstall = fs.mkdtempSync(path.join(os.tmpdir(), "labora-other-install-"));
  const removedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "labora-removed-install-"));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(otherInstall, path.join(workspace, "agents"), linkType);
  fs.symlinkSync(removedTarget, path.join(workspace, "skills"), linkType);
  fs.rmdirSync(removedTarget);

  const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "labora"), "announce"], {
    cwd: workspace,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const context = JSON.parse(result.stdout).additionalContext;
  assert.match(context, /agents\/ is a link outside the loaded plugin/);
  assert.match(context, /skills\/ is a dangling link/);
});

test("the repo serves itself as a marketplace", () => {
  assert.ok(fs.existsSync(MARKETPLACE_PATH));
  const market = JSON.parse(fs.readFileSync(MARKETPLACE_PATH, "utf8"));
  assert.ok(market.name);
  assert.ok(Array.isArray(market.plugins) && market.plugins.length > 0);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const entry = market.plugins.find((candidate) => candidate.name === manifest.name);
  assert.ok(entry, `the marketplace must list ${manifest.name}`);
  assert.equal(entry.source, "./");
});

test("there is exactly one plugin manifest", () => {
  const candidates = [
    "plugin.json",
    path.join(".plugin", "plugin.json"),
    path.join(".github", "plugin", "plugin.json"),
    path.join(".claude-plugin", "plugin.json"),
  ].filter((rel) => fs.existsSync(path.join(repoRoot, rel)));
  assert.deepEqual(candidates, [path.join(".claude-plugin", "plugin.json")]);
});

test("the manifest carries the metadata a marketplace listing shows", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const key of ["description", "license", "homepage", "repository"]) {
    assert.ok(manifest[key], `plugin.json is missing "${key}"`);
  }
});

// Public issues and PRs cannot be unpublished. The rule that prevents leaking a
// real application has to stay in the agent instructions, not in memory.
test("AGENTS.md carries the mandatory no-personal-data rule for public artifacts", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
  const heading = raw.split(/^## /m).find((section) => /^Issues, PRs and commits/.test(section));
  assert.ok(heading, "AGENTS.md must carry a section covering issues, PRs and commits");
  assert.match(heading, /\*\*Mandatory\.\*\*/);
  for (const term of [/\bNames\b/, /Employers or companies/, /Job titles/, /persona slug/]) {
    assert.match(heading, term, `the rule must name ${term.source}`);
  }
  assert.match(heading, /example/);
});
