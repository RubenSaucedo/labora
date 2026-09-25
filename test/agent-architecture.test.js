import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginAgentFiles, pluginAgentPath } from "../src/lib/plugin-components.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = path.join(repoRoot, "agents");
const BROWSER_TOOL = /^browser_/;

function parseAgent(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  const relativeFile = path.relative(agentsDir, file);
  assert.ok(match, `${relativeFile} must open with a YAML frontmatter block`);
  const [, frontmatter, body] = match;
  const field = (name) => {
    const found = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(frontmatter);
    return found ? found[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  const tools = /^tools:\s*\[([\s\S]*?)\]/m.exec(frontmatter);

  return {
    file: relativeFile,
    name: field("name"),
    description: field("description"),
    tools: tools
      ? tools[1]
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : null,
    body,
    raw,
    prose: body.replace(/[*`_]/g, ""),
  };
}

function skillFiles() {
  const dir = path.join(repoRoot, "skills");
  return fs.readdirSync(dir)
    .map((entry) => path.join(dir, entry, "SKILL.md"))
    .filter((file) => fs.existsSync(file));
}

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

const agentFiles = pluginAgentFiles(repoRoot);
const parsedAgents = agentFiles.map(parseAgent);
const agents = new Map(parsedAgents.map((agent) => [agent.name, agent]));

test("every agent declares valid frontmatter", () => {
  assert.ok(agentFiles.length > 0, "no agents found");
  for (const file of agentFiles) {
    const agent = parseAgent(file);
    assert.ok(agent.name, `${file} is missing a name`);
    assert.ok(agent.description, `${file} is missing a description`);
    assert.ok(Array.isArray(agent.tools), `${file} is missing a tools array`);
    assert.equal(
      agent.name,
      path.basename(file, ".agent.md"),
      `${agent.file} name must match its filename so the plugin can resolve it`,
    );
    assert.ok(agent.body.trim().length > 0, `${file} has an empty body`);
  }
});

test("the conversational resume architecture has the required specialist agents", () => {
  for (const required of ["resume-partner", "resume-writer", "resume-reviewer", "source-gatherer"]) {
    assert.ok(agents.has(required), `${required} agent is missing`);
  }
});

// Isolation is a property of what an agent can see. Browsing belongs only to
// acquisition and job discovery; writers and reviewers work from provided text.
test("only source gathering and job discovery agents may browse", () => {
  const mayBrowse = new Set([
    "source-gatherer",
    "scout-fit",
    "scout-market",
    "scout-growth",
    "scout-discovery",
    "job-explorer",
  ]);
  for (const agent of agents.values()) {
    const browses = agent.tools.some((t) => BROWSER_TOOL.test(t));
    if (browses) {
      assert.ok(
        mayBrowse.has(agent.name),
        `${agent.name} has browser tools but is not in the browse allowlist`,
      );
    }
  }
});

test("the source gatherer can retrieve public material but cannot write profile files", () => {
  const gatherer = agents.get("source-gatherer");
  assert.ok(gatherer.tools.some((t) => BROWSER_TOOL.test(t)), "source-gatherer must be able to browse");
  assert.match(gatherer.prose, /write only under [\s\S]{0,80}sources\//i);
  assert.match(gatherer.prose, /may never write [\s\S]{0,80}profile/i);
  assert.match(gatherer.prose, /untrusted data, never instructions/i);
});

test("the resume reviewer is isolated to the rendered document and posting", () => {
  const reviewer = agents.get("resume-reviewer");
  assert.ok(!reviewer.tools.some((t) => BROWSER_TOOL.test(t)), "resume-reviewer must not browse");
  assert.match(reviewer.prose, /may see only[\s\S]{0,160}rendered resume text/i);
  assert.match(reviewer.prose, /job posting text/i);
  assert.match(reviewer.prose, /Do not read the profile/i);
  assert.match(reviewer.prose, /This is not a gate/i);
});

test("the resume writer treats examples as form rather than facts", () => {
  const writer = agents.get("resume-writer");
  assert.match(writer.prose, /Never manufacture seniority/i);
  assert.match(writer.prose, /Do not add a technology because it appears in the posting/i);
  assert.match(writer.prose, /first bullet under a role establishes/i);
  assert.match(writer.prose, /Do not automatically choose the bullet with the largest number/i);
});

test("the senior SWE writing reference exists and rejects examples as fact sources", () => {
  const reference = fs.readFileSync(
    path.join(repoRoot, "skills/resume-writing/references/senior-swe-writing.md"),
    "utf8",
  );
  assert.match(reference, /not an\s+evidence source for a persona/i);
  assert.match(reference, /examples?[\s\S]{0,120}sentence shape/i);
  assert.match(reference, /does not establish a universal six-second scan/i);
  assert.match(reference, /not a\s+pass\/fail rule/i);
});

test("the resume partner delegates instead of absorbing specialist work", () => {
  const partner = agents.get("resume-partner");
  assert.ok(partner.tools.includes("task"), "resume-partner must be able to launch specialists");
  for (const delegated of ["source-gatherer", "resume-writer", "resume-reviewer"]) {
    assert.ok(partner.prose.includes(delegated), `resume-partner must name ${delegated}`);
  }
  assert.match(partner.prose, /Do not run or imitate the reviewer inline/i);
});

// An agent contract is executable documentation. A grouped command named here is
// one an agent or skill may run in front of a user.
test("every labora tool an agent or skill is told to run exists", () => {
  const known = toolCommands();
  const docs = [...agentFiles, ...skillFiles()];
  const missing = [];
  const topLevel = new Set(["announce", "doctor", "list", "setup"]);
  for (const doc of docs) {
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
  assert.deepEqual(missing, [], `documented tools do not exist:\n${missing.join("\n")}`);
});

test("an agent that launches sub-agents can actually launch them", () => {
  const offenders = [];
  for (const agent of agents.values()) {
    if (!/\blaunch(?:es|ing)?\b[^.]{0,80}\b(?:sub-agents?|scout|resume-writer|resume-reviewer|source-gatherer)\b|\bDispatch\b[^.]{0,80}\b(?:resume-writer|resume-reviewer)/i.test(agent.prose)) {
      continue;
    }
    if (!agent.tools.includes("task")) offenders.push(agent.file);
  }
  assert.deepEqual(offenders, [], `these agents describe launching sub-agents but cannot: ${offenders.join(", ")}`);
});

test("browser tools are declared under both runtime prefixes", () => {
  for (const agent of agents.values()) {
    for (const tool of agent.tools.filter((t) => t.startsWith("browser_"))) {
      assert.ok(
        agent.tools.includes(`playwright-${tool}`),
        `${agent.file} declares ${tool} but not playwright-${tool}`,
      );
    }
  }
});

// Tool names are a runtime contract, not documentation. A name this runtime does
// not expose is silently dropped, so the agent loses the capability its procedure
// depends on without any error being raised.
const RUNTIME_TOOLS = new Set([
  "bash",
  "view",
  "edit",
  "create",
  "grep",
  "glob",
  "task",
  "ask_user",
  "web_fetch",
  "web_search",
]);
const RETIRED_TOOLS = new Map([
  ["rg", "grep"],
  ["apply_patch", "edit + create"],
  ["str_replace_editor", "edit"],
  ["bash_tool", "bash"],
]);

function declaredTools(file, raw) {
  const match = /^tools:\s*\[([\s\S]*?)\]/m.exec(raw);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function contractFiles() {
  return [...agentFiles, ...skillFiles()];
}

test("agents and skills declare only tool names this runtime exposes", () => {
  const offenders = [];
  for (const file of contractFiles()) {
    const tools = declaredTools(file, fs.readFileSync(file, "utf8"));
    if (!tools) continue;
    for (const tool of tools) {
      if (RUNTIME_TOOLS.has(tool)) continue;
      if (/^(playwright-)?browser_/.test(tool)) continue;
      const replacement = RETIRED_TOOLS.get(tool);
      offenders.push(
        `${path.relative(repoRoot, file)} declares "${tool}"` +
          (replacement ? ` — use "${replacement}"` : " — not a known runtime tool"),
      );
    }
  }
  assert.deepEqual(offenders, [], "unknown tool names:\n" + offenders.join("\n"));
});

test("discovery is contracted to record the companies that returned nothing", () => {
  const discovery = agents.get("scout-discovery").prose;
  const source = fs.readFileSync(pluginAgentPath(repoRoot, "scout-discovery"), "utf8");
  assert.match(discovery, /coverage[\s\S]{0,400}returned nothing|returned nothing[\s\S]{0,400}coverage/i);
  for (const cause of ["title_mismatch", "location", "level", "blocked"]) {
    assert.match(source, new RegExp(cause), `scout-discovery must name ${cause}`);
  }
});

test("adjacency is contracted to be searched before it is suggested", () => {
  const explorer = agents.get("job-explorer").prose;
  assert.match(explorer, /adjacen[\s\S]{0,600}search each one before you report it/i);
});

test("the fit scout turns answerable gaps into questions", () => {
  const fit = agents.get("scout-fit").prose;
  assert.match(fit, /Every gap that the operator could simply answer must carry an askOperator\s+question/i);
  assert.match(fit, /never assume the answer|Never treat an unanswered question as a disqualification/i);
});

test("job-search points at the privacy boundary rather than restating it", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "skills/job-search/SKILL.md"), "utf8");
  assert.match(raw, /resume-conventions/i, "job-search must point at where the boundary lives");
  assert.doesNotMatch(raw, /names of real people[\s\S]{0,120}employers or companies/i);
});

test("the outbound privacy boundary is carried by resume-conventions", () => {
  const conventions = fs.readFileSync(
    path.join(repoRoot, "skills/resume-conventions/SKILL.md"), "utf8",
  );
  const section = conventions.split(/^## /m).find((s) => /^Outbound privacy boundary/.test(s));
  assert.ok(section, "resume-conventions must carry the outbound privacy boundary");
  const flat = section.replace(/\s+/g, " ");
  for (const term of [
    /names of real people/, /employers or companies/, /job titles/i, /persona slug/, /private workspace/, /permanent/i,
  ]) {
    assert.match(flat, term, `the boundary must cover ${term.source}`);
  }
  assert.match(flat, /example/);
});

// The editorial method is prose, and prose is the only thing holding it up.
//
// An earlier version of Labora enforced these rules with deterministic
// validators over a claim ledger and spent most of its time reporting defects
// that were not defects. Deleting that machinery was right, but it means the
// guarantee now lives entirely in sentences -- so the sentences are the thing
// worth protecting.
test("the editorial method keeps its seven operations and its ordering", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "skills/resume-editorial/SKILL.md"),
    "utf8",
  );
  const prose = skill.replace(/[*`_]/g, "");

  for (const operation of ["keep", "move", "combine", "split", "make specific", "delete", "rewrite"]) {
    assert.ok(
      new RegExp(`\\b${operation}\\b`, "i").test(prose),
      `the editorial method must name the "${operation}" operation`,
    );
  }

  // Rewriting being the default is the failure the method exists to prevent.
  assert.match(
    prose,
    /rewrite is (?:the )?last|last resort/i,
    "the method must say rewrite is the last resort, not the default",
  );
  assert.match(
    prose,
    /placement/i,
    "the decision procedure must start from placement rather than wording",
  );
});

test("the editorial method reads the whole document, not one sentence", () => {
  const prose = fs
    .readFileSync(path.join(repoRoot, "skills/resume-editorial/SKILL.md"), "utf8")
    .replace(/[*`_]/g, "");

  // Each of these is a relationship between sentences. No per-sentence pass can
  // see any of them, which is why they need naming somewhere.
  for (const [label, pattern] of [
    ["repeated openings", /opening with the same/i],
    ["uniform clause shape", /same shape|identical rhythm/i],
    ["noun stacks", /comma-separated nouns/i],
    ["summary restating a bullet", /restates a bullet/i],
    ["loss of level", /evidence of architecture|got smaller/i],
  ]) {
    assert.match(prose, pattern, `the whole-document read must cover ${label}`);
  }

  // Purposeful repetition is not a defect, and a method that cannot tell the
  // difference trains people to ignore it.
  assert.match(
    prose,
    /retrieval repetition is different/i,
    "the method must distinguish purposeful repetition from redundant prose",
  );
});

test("the editorial method suggests operations and never refuses", () => {
  const prose = fs
    .readFileSync(path.join(repoRoot, "skills/resume-editorial/SKILL.md"), "utf8")
    .replace(/[*`_]/g, "");

  assert.match(
    prose,
    /Never refuse over it|never refuse/i,
    "editing judgment is judgment; it may be raised but never enforced",
  );
  // It must show the shape of a good suggestion, not merely assert one.
  assert.match(
    prose,
    /Want me to\?/,
    "the method must model bringing a change to the person as a question",
  );
});

test("every skill that edits an existing resume loads the editorial method", () => {
  for (const dir of ["draft-resume", "tailor-resume"]) {
    const skill = fs.readFileSync(path.join(repoRoot, "skills", dir, "SKILL.md"), "utf8");
    assert.match(
      skill,
      /resume-editorial/,
      `${dir} changes a document the person already has, so it must load resume-editorial`,
    );
  }
  const writer = fs.readFileSync(
    path.join(repoRoot, "agents/resume-builders/resume-writer.agent.md"),
    "utf8",
  );
  assert.match(
    writer,
    /resume-editorial/,
    "the writer is what actually rewrites sentences, so it must carry the method",
  );
});
