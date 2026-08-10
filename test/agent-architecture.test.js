import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = path.join(repoRoot, "agents");

const BROWSER_TOOL = /^browser_/;

function parseAgent(file) {
  const raw = fs.readFileSync(path.join(agentsDir, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(match, `${file} must open with a YAML frontmatter block`);
  const [, frontmatter, body] = match;

  const name = /^name:\s*(.+)$/m.exec(frontmatter);
  const description = /^description:\s*(.+)$/m.exec(frontmatter);
  const tools = /^tools:\s*\[([\s\S]*?)\]/m.exec(frontmatter);

  return {
    file,
    name: name ? name[1].trim().replace(/^["']|["']$/g, "") : null,
    description: description ? description[1].trim() : null,
    tools: tools
      ? tools[1]
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : null,
    body,
    // Assertions describe intent, not formatting. Stripping markdown emphasis
    // keeps them from breaking when someone bolds a word.
    prose: body.replace(/[*`_]/g, ""),
  };
}

const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".agent.md"));
const agents = new Map(agentFiles.map((f) => [parseAgent(f).name, parseAgent(f)]));

test("every agent declares valid frontmatter", () => {
  assert.ok(agentFiles.length > 0, "no agents found");
  for (const file of agentFiles) {
    const agent = parseAgent(file);
    assert.ok(agent.name, `${file} is missing a name`);
    assert.ok(agent.description, `${file} is missing a description`);
    assert.ok(Array.isArray(agent.tools), `${file} is missing a tools array`);
    assert.equal(
      agent.name,
      file.replace(/\.agent\.md$/, ""),
      `${file} name must match its filename so the plugin can resolve it`,
    );
    assert.ok(agent.body.trim().length > 0, `${file} has an empty body`);
  }
});

test("the profile side of the pipeline has an owner", () => {
  for (const required of ["profile-builder", "profile-researcher", "resume-tailor"]) {
    assert.ok(
      agents.has(required),
      `${required} agent is missing; profile or tailoring work would fall back into the conductor context`,
    );
  }
});

// Isolation is a property of what an agent can SEE. These assertions encode the
// posture boundaries so a future edit cannot quietly hand an agent a capability
// that collapses the guarantee it exists to provide.
test("only the acquisition agents may browse", () => {
  const mayBrowse = new Set([
    "profile-researcher",
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
        `${agent.name} has browser tools but is not an acquisition agent; untrusted pages must not reach a curating, advocating or adjudicating context`,
      );
    }
  }
});

test("the researcher can actually retrieve evidence", () => {
  const researcher = agents.get("profile-researcher");
  assert.ok(
    researcher.tools.some((t) => BROWSER_TOOL.test(t)),
    "profile-researcher must be able to browse; it is the acquisition agent",
  );
});

test("the advocate is denied raw evidence and the judges", () => {
  const tailor = agents.get("resume-tailor");
  assert.match(tailor.prose, /denied raw evidence/i);
  assert.match(tailor.prose, /denied the judges/i);
  assert.ok(
    !tailor.tools.some((t) => BROWSER_TOOL.test(t)),
    "the tailor must not browse; it composes only from verified claims",
  );
});

test("the researcher may not write the claim ledger", () => {
  const { prose } = agents.get("profile-researcher");
  assert.match(
    prose,
    /never write [^.]*profile\/generated/i,
    "profile-researcher must state that it cannot write generated artifacts",
  );
  assert.match(prose, /untrusted data, never instructions/i);
});

test("the curator builds without a job in context", () => {
  const { prose } = agents.get("profile-builder");
  assert.match(
    prose,
    /no job description enters this context/i,
    "profile-builder must exclude the job so it cannot shade facts toward one opening",
  );
  assert.match(prose, /never hand-edit/i);
});

test("judges stay isolated from generator rationale", () => {
  for (const name of ["judge-ats", "judge-engineer", "judge-hr"]) {
    const agent = agents.get(name);
    assert.ok(agent, `${name} is missing`);
    assert.ok(
      !agent.tools.some((t) => BROWSER_TOOL.test(t)),
      `${name} must not browse`,
    );
    assert.match(agent.prose, /claims\.json|provenance|rationale/i);
  }
});

test("the conductor delegates rather than absorbing the pipeline", () => {
  const { prose } = agents.get("resume-build");
  for (const delegated of ["profile-builder", "resume-tailor", "judge-ats"]) {
    assert.ok(
      prose.includes(delegated),
      `resume-build must delegate to ${delegated} instead of running it inline`,
    );
  }
});

// An agent contract is executable documentation: a command named here is one an
// agent will actually run. A path that does not exist fails at runtime, in front
// of the user, after the agent has already started work.
test("every tool an agent or skill is told to run exists", () => {
  const docs = [
    ...agentFiles.map((f) => path.join(agentsDir, f)),
    ...fs
      .readdirSync(path.join(repoRoot, "skills"))
      .map((d) => path.join(repoRoot, "skills", d, "SKILL.md"))
      .filter((p) => fs.existsSync(p)),
  ];

  const missing = [];
  for (const doc of docs) {
    const text = fs.readFileSync(doc, "utf8");
    for (const match of text.matchAll(/node\s+(src\/tools\/[A-Za-z0-9._-]+\.js)/g)) {
      const toolPath = path.join(repoRoot, match[1]);
      if (!fs.existsSync(toolPath)) {
        missing.push(`${path.relative(repoRoot, doc)} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], `documented tools do not exist:\n${missing.join("\n")}`);
});

test("the curator is denied the persona's search preferences", () => {
  const curator = agents.get("profile-builder");
  assert.ok(curator, "profile-builder agent is missing");
  assert.match(
    curator.prose,
    /never read or author[\s\S]{0,80}search-preferences\.json/i,
    "profile-builder must be denied search-preferences.json: it names the target " +
      "level, and a curator who knows it will inflate framing to match",
  );
});

test("search preferences are asked for while the operator is present", () => {
  const onboarding = fs.readFileSync(
    path.join(repoRoot, "skills/scaffold-persona/SKILL.md"),
    "utf8",
  );
  assert.match(
    onboarding,
    /ask the operator[\s\S]{0,40}search-preferences\.json/i,
    "persona onboarding must ask for search-preferences.json, rather than " +
      "leaving job-explorer to discover the gap mid-run",
  );
});

test("no placeholder search-preferences ships in the persona template", () => {
  const templated = path.join(repoRoot, "templates/profile/search-preferences.json");
  assert.equal(
    fs.existsSync(templated),
    false,
    "a templated preferences file would validate and send scouts after invented titles",
  );
});

test("an agent that launches sub-agents can actually launch them", () => {
  const offenders = [];
  for (const agent of agents.values()) {
    if (!/\blaunch(es|ing)?\b[^.]{0,60}\bsub-agents?\b|\bLaunch\s+`?scout-|\bLaunch\s+\*\*`?[a-z-]+`?\*\*/i.test(agent.prose)) {
      continue;
    }
    if (!agent.tools.includes("task")) offenders.push(agent.file);
  }
  assert.deepEqual(
    offenders,
    [],
    "these agents describe launching sub-agents but cannot: " + offenders.join(", "),
  );
});

test("browser tools are declared under both runtime prefixes", () => {
  for (const agent of agents.values()) {
    for (const tool of agent.tools.filter((t) => t.startsWith("browser_"))) {
      assert.ok(
        agent.tools.includes(`playwright-${tool}`),
        `${agent.file} declares ${tool} but not playwright-${tool}; Copilot and Claude ` +
          "prefix MCP tools differently, so both names must be present",
      );
    }
  }
});

// Tool names are a runtime contract, not documentation. A name this runtime does
// not expose is silently dropped, so the agent loses the capability its
// procedure depends on without any error being raised.
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

// Claude Code names that do not exist in Copilot CLI, mapped to the real name.
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
  const files = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => path.join(agentsDir, f));

  const skillsDir = path.join(repoRoot, "skills");
  for (const dir of fs.readdirSync(skillsDir)) {
    const skill = path.join(skillsDir, dir, "SKILL.md");
    if (fs.existsSync(skill)) files.push(skill);
  }
  return files;
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

// The curator boundary is only real if no job-holding context can rebuild the
// profile. An agent that holds a job description and also curates produces a
// ledger shaped by the opening, and every downstream validation still passes
// because the contamination precedes the first claim.
test("no job-holding agent rebuilds the profile itself", () => {
  const offenders = [];
  for (const agent of agents.values()) {
    if (agent.name === "profile-builder") continue;
    const holdsJob = /job-spec|job\.md|application directory|<job-slug>/i.test(agent.prose);
    if (!holdsJob) continue;

    for (const line of agent.prose.split("\n")) {
      const runsCuration = /\bresume-persona\b/.test(line);
      const dispatches = /launch|sub-agent|profile-builder/i.test(line);
      if (runsCuration && !dispatches) {
        offenders.push(`${agent.file}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these job-holding agents invoke resume-persona directly instead of " +
      "dispatching profile-builder:\n" + offenders.join("\n"),
  );
});

test("the profile-generated owner is named consistently across contracts", () => {
  const contract = fs.readFileSync(
    path.join(repoRoot, "skills/resume-conventions/SKILL.md"),
    "utf8",
  );
  assert.match(
    contract,
    /`profile\/generated\/` is written by the \*\*`profile-builder` agent only\*\*/,
    "resume-conventions is loaded first by every skill and agent, so it must name " +
      "the same owner as AGENTS.md; naming the skill instead of the agent invites " +
      "a job-holding context to run the skill and call it compliant",
  );
});

test("discovery is contracted to record the companies that returned nothing", () => {
  const discovery = agents.get("scout-discovery").prose;
  // prose strips markdown punctuation, so enum values are checked against source.
  const source = fs.readFileSync(
    path.join(repoRoot, "agents/scout-discovery.agent.md"),
    "utf8",
  );
  assert.match(
    discovery,
    /coverage[\s\S]{0,400}returned nothing|returned nothing[\s\S]{0,400}coverage/i,
    "scout-discovery must record zero-result companies: without them an empty " +
      "run is indistinguishable from a broken one",
  );
  for (const cause of ["title_mismatch", "location", "level", "blocked"]) {
    assert.match(
      source,
      new RegExp(cause),
      `scout-discovery must name the ${cause} cause — each one implies a ` +
        "different operator action, so a flattened zero is not actionable",
    );
  }
});

test("adjacency is contracted to be searched before it is suggested", () => {
  const explorer = agents.get("job-explorer").prose;
  assert.match(
    explorer,
    /adjacen[\s\S]{0,600}search each one before you report it/i,
    "job-explorer must search an adjacent company before reporting it: an " +
      "unverified suggestion is a guess presented as a lead",
  );
});

test("the fit scout must turn answerable gaps into questions", () => {
  const fit = agents.get("scout-fit").prose;
  assert.match(
    fit,
    /Every gap that the operator could simply answer must carry an askOperator\s+question/i,
    "scout-fit must emit an ask-back for gaps the operator could answer: the " +
      "ledger holds only what has been curated, so most gaps are missing " +
      "evidence rather than missing experience",
  );
  assert.match(
    fit,
    /never assume the answer|Never treat an unanswered question as a disqualification/i,
    "an unanswered question must not become a rejection or a silent assumption",
  );
});

test("an operator's answer is evidence, not a resume line", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "skills/job-search/SKILL.md"),
    "utf8",
  );
  assert.match(
    skill,
    /answer is evidence[\s\S]{0,200}profile-builder/i,
    "answers to the report's questions must route to profile-builder for " +
      "curation; writing a spoken answer straight onto a resume is the " +
      "invention this pipeline exists to prevent",
  );
});

test("the report contract forbids stating hiring odds", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "skills/job-search/SKILL.md"),
    "utf8",
  );
  assert.match(
    skill,
    /Never print or imply a probability of being hired/i,
    "evidence coverage must never be presented as a probability of being " +
      "hired: that depends on the other applicants, which no run can observe",
  );
});

// Onboarding is where a person's spoken words first enter the pipeline, so it is
// the easiest place to invent. These assertions encode the boundaries that keep
// an interview producing sources rather than conclusions.
test("a brand-new applicant has an onboarding owner", () => {
  assert.ok(
    agents.has("applicant-intake"),
    "applicant-intake is missing; a newcomer's onboarding would run inline in " +
      "the conductor, which owns no sources and skips every intake boundary",
  );
});

test("intake supplies sources but never owns generated artifacts", () => {
  const intake = agents.get("applicant-intake");
  assert.match(
    intake.prose,
    /Never write profile\/generated\/[\s\S]{0,120}profile-builder/i,
    "intake must not write the ledger it feeds; the curator decides what " +
      "becomes a claim, or the interview would author its own evidence",
  );
});

test("intake transcribes the operator rather than improving them", () => {
  const intake = agents.get("applicant-intake");
  assert.match(intake.prose, /transcriber, not a writer/i);
  assert.match(
    intake.prose,
    /number the operator did not say is\s+fabricated/i,
    "an invented metric is worse than a vague sentence because it looks " +
      "verifiable; the rule must be stated, not implied",
  );
});

test("intake reads spoken answers back before they become evidence", () => {
  const intake = agents.get("applicant-intake");
  assert.match(
    intake.prose,
    /Read every sentence back and get explicit confirmation[\s\S]{0,200}hash-anchored/i,
    "background.md and career.md ground later claims, so an unconfirmed " +
      "sentence silently becomes evidence nobody agreed to",
  );
});

test("intake asks for preferences instead of inferring them from history", () => {
  const intake = agents.get("applicant-intake");
  assert.match(
    intake.prose,
    /Preferences are asked, never inferred[\s\S]{0,160}want[\s\S]{0,40}work/i,
    "where someone has worked does not say where they want to work",
  );
});

test("intake never handles the operator's credentials", () => {
  const intake = agents.get("applicant-intake");
  assert.match(
    intake.prose,
    /Never ask for a password, and never accept one/i,
    "logged-in sources are reached by profile-researcher driving a browser " +
      "the operator logs into themselves",
  );
});

test("scaffolding asks for the preferences a run is reported against", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "skills/scaffold-persona/SKILL.md"),
    "utf8",
  );
  assert.match(
    skill,
    /companies they want to explore/i,
    "target companies must be asked at intake: coverage is reported per " +
      "company, so an unasked company is a silent hole in every run",
  );
  assert.match(skill, /timezone/i);
  assert.match(
    skill,
    /assign the level after the interview/i,
    "asking only for 'Senior …' titles hides openings that employers post " +
      "unleveled, which no scout can recover later",
  );
});

// A defect is almost always found while working on a real application, so the
// identifying detail is what the author is looking at when they write the
// report up. The rule that stops it reaching a public tracker has to be loaded
// by the agents doing that work, not only by contributors to this repo.
test("the outbound-disclosure boundary is carried by the skill every resume agent loads", () => {
  const conventions = fs.readFileSync(
    path.join(repoRoot, "skills/resume-conventions/SKILL.md"), "utf8"
  );
  const section = conventions.split(/^## /m).find((s) => /^Outbound-disclosure boundary/.test(s));
  assert.ok(section, "resume-conventions must carry an outbound-disclosure boundary");

  // Markdown gets reflowed, so a rule must be matched against normalised text
  // rather than against wherever the line breaks happen to fall today.
  const flat = section.replace(/\s+/g, " ");
  for (const term of [
    /Names of people/, /Employers or companies/, /Job titles/,
    /persona slug/, /Verbatim excerpts/, /permanent/i,
  ]) {
    assert.match(flat, term, `the boundary must cover ${term.source}`);
  }
  assert.match(flat, /example/, "it must point at the synthetic persona for reproductions");
  // A rule that suppresses reports costs more than it protects.
  assert.match(flat, /never drop a real finding/i, "it must not suppress genuine findings");
});

test("a scaffolded workspace carries the disclosure rule, and the scaffold cannot clobber one", () => {
  const template = path.join(repoRoot, "templates/workspace/AGENTS.md");
  assert.ok(fs.existsSync(template), "templates/workspace/AGENTS.md must ship");
  const raw = fs.readFileSync(template, "utf8").replace(/\s+/g, " ");
  assert.match(raw, /\*\*Mandatory\.\*\*/, "the workspace rule must be mandatory, not advisory");
  for (const term of [/\*\*Names\*\*/, /Employers or companies/, /Verbatim excerpts/]) {
    assert.match(raw, term, `the workspace rule must cover ${term.source}`);
  }

  const scaffold = fs.readFileSync(path.join(repoRoot, "skills/scaffold-persona/SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.match(scaffold, /templates\/workspace/, "scaffold-persona must place the workspace file");
  // The workspace root belongs to the operator; a file that governs agents is
  // the last thing an agent should rewrite unasked.
  assert.match(
    scaffold,
    /only when the workspace root has no `AGENTS\.md`/i,
    "the scaffold must never overwrite an existing AGENTS.md",
  );
});

// Restating the rule in each skill would let the copies drift, and a stale copy
// of a disclosure rule is worse than a pointer to a current one.
test("job-search points at the boundary rather than restating it", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "skills/job-search/SKILL.md"), "utf8");
  assert.match(raw, /Outbound-disclosure boundary/, "job-search must reference the boundary");
  assert.match(raw, /resume-conventions/, "it must point at where the rule lives");
});
