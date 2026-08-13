import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GAP_STATUS,
  searchCorpus,
  findAdjacentClaims,
  collectionRoutes,
  triageRequirement,
} from "../src/lib/gap-triage.js";

function persona(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-gap-"));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return root;
}

const ledger = (facts) => ({
  claims: facts.map((fact, i) => ({ id: `c-${i + 1}`, fact, status: "verified" })),
});

// `validate-profile` checks that existing claims are grounded, never that
// existing evidence has been mined. So the corpus can hold the answer while the
// ledger reports a gap, and nothing flags the discrepancy.
test("evidence in the corpus makes it a bookkeeping gap, not a candidate gap", () => {
  const root = persona({
    "evidence/reviews/2025/text/review.md":
      "Designed and operated the Kubernetes migration for the billing platform.",
  });
  const result = triageRequirement(
    { text: "Experience with Kubernetes in production" },
    { personaRoot: root, ledger: ledger([]), identity: {} }
  );
  assert.equal(result.status, GAP_STATUS.UNMINED);
  assert.equal(result.escalateToHuman, false);
  assert.match(result.because, /not been derived into a claim/);
  assert.ok(result.evidence[0].path.includes("review.md"));
});

test("a single shared word is not a corpus hit", () => {
  const root = persona({
    "evidence/notes/2025/text/notes.md": "Worked on the platform team.",
  });
  assert.deepEqual(searchCorpus(root, { text: "Experience with Kubernetes" }), []);
});

// The expensive miss: the candidate owned a live public product, and minutes of
// scripted observation covered several "missing" requirements.
test("a reachable product the candidate owns is a collection route, not a gap", () => {
  const root = persona({});
  const result = triageRequirement(
    { text: "Experience building production web applications" },
    {
      personaRoot: root,
      ledger: ledger([]),
      identity: {
        projects: [{
          name: "Production web application",
          description: "A deployed web application serving real users",
          link: "https://example.com",
        }],
      },
    }
  );
  assert.equal(result.status, GAP_STATUS.COLLECTIBLE);
  assert.equal(result.escalateToHuman, false);
  assert.equal(result.routes[0].kind, "observe_live_product");
  assert.equal(result.routes[0].effort, "minutes");
});

// The case the tool used to handle worst. Someone who shipped agent workflows
// and reviewed a colleague's evaluation harness does not "lack evals" -- and
// also cannot claim to have built one. Both are true, so the answer is a
// question, never a verdict in either direction.
test("adjacent verified work produces a scoped question, not a verdict", () => {
  const root = persona({});
  const result = triageRequirement(
    { text: "Experience with agent evaluation and evals" },
    {
      personaRoot: root,
      ledger: ledger([
        "Designed and shipped agent workflows used across the team.",
        "Reviewed the agent evaluation harness in detail with the author.",
      ]),
      identity: {},
    }
  );
  assert.equal(result.status, GAP_STATUS.ADJACENT);
  assert.ok(result.adjacentClaims.length > 0);
  assert.match(result.routes[0].action, /actual involvement/);
  // Flexible in what it asks about, rigid in what it prints.
  assert.match(result.routes[0].action, /durable source before it can be printed/);
});

test("a scoped question names the adjacent claims rather than asking to self-assess", () => {
  const adjacent = findAdjacentClaims(
    ledger(["Built the agent orchestration layer.", "Unrelated payroll work."]),
    { text: "agent orchestration experience" }
  );
  assert.equal(adjacent[0].claimId, "c-1");
  assert.ok(adjacent[0].sharedTerms.includes("agent"));
});

// A real gap is the honest answer in one case only, and even then it is a thing
// a person can go and change -- never a disqualification.
test("a genuine absence is stated as an absence, not a disqualification", () => {
  const root = persona({});
  const result = triageRequirement(
    { text: "Ten years of embedded firmware development in automotive safety systems" },
    { personaRoot: root, ledger: ledger(["Wrote marketing copy."]), identity: {} }
  );
  assert.equal(result.status, GAP_STATUS.REAL_GAP);
  assert.match(result.routes[0].action, /not a disqualification/);
  assert.match(result.routes[0].action, /Apply on the strength of what is verified/);
});

// Asking a human is the slowest path available and produces self-report rather
// than evidence, so it must never outrank a route the candidate can just take.
test("a collection route outranks asking the human", () => {
  const root = persona({});
  const result = triageRequirement(
    { text: "Experience shipping production web applications" },
    {
      personaRoot: root,
      ledger: ledger(["Shipped a production web application end to end."]),
      identity: {
        projects: [{ name: "Web application", description: "production web application", link: "https://example.com" }],
      },
    }
  );
  assert.equal(result.status, GAP_STATUS.COLLECTIBLE);
  assert.equal(result.escalateToHuman, false);
});

test("every route carries an effort and a horizon", () => {
  const root = persona({});
  for (const requirement of [
    { text: "Kubernetes production experience" },
    { text: "agent evaluation experience" },
  ]) {
    const result = triageRequirement(requirement, {
      personaRoot: root,
      ledger: ledger(["Built agent tooling."]),
      identity: {},
    });
    for (const route of result.routes) {
      assert.ok(route.effort, "a route that ignores the candidate's time is not a route");
      assert.ok(route.horizon);
      assert.ok(route.action);
    }
  }
});

test("routes are only offered for relevant assets", () => {
  const routes = collectionRoutes(
    { projects: [{ name: "Recipe blog", description: "a static recipe site", link: "https://example.com" }] },
    { text: "Kubernetes operator development" }
  );
  assert.deepEqual(routes, [], "an unrelated project is not a route to the requirement");
});

// The status vocabulary is the contract: each status needs a different action,
// never one bucket called "pending".
test("no status collapses into a single pending bucket", () => {
  assert.deepEqual(
    Object.values(GAP_STATUS).sort(),
    ["adjacent", "collectible", "mention_only", "real_gap", "unmined"]
  );
});

// A skill token appearing in the corpus is not the candidate having done it.
// This ran in the wrong direction from the usual failure: the tool concluded
// the evidence was already there and closed the requirement, so no question was
// asked and no route was offered.
test("a teammate's work in the corpus is not the candidate's coverage", () => {
  const root = persona({
    "evidence/notes/team.md": "Priya owns the evaluation harness and reports on it weekly.",
  });
  const result = triageRequirement(
    { text: "Experience with an evaluation harness" },
    { personaRoot: root, ledger: ledger([]), identity: { name: "Ruben Saucedo" } }
  );
  assert.equal(result.status, GAP_STATUS.MENTION_ONLY);
  assert.equal(result.escalateToHuman, true, "a mention must reach a human, not close the requirement");
  assert.equal(result.routes[0].kind, "ask_scoped_question");
});

test("the candidate's own work in the corpus is still unmined", () => {
  const root = persona({
    "evidence/notes/mine.md": "I built the evaluation harness and ran it against every release.",
  });
  const result = triageRequirement(
    { text: "Experience with an evaluation harness" },
    { personaRoot: root, ledger: ledger([]), identity: { name: "Ruben Saucedo" } }
  );
  assert.equal(result.status, GAP_STATUS.UNMINED);
  assert.equal(result.escalateToHuman, false);
});

// Resume-register prose drops the subject; the subject is still the candidate.
test("subject-dropped resume prose counts as the candidate's action", () => {
  const root = persona({
    "evidence/notes/resume.md": "Built the evaluation harness used across three teams.",
  });
  const result = triageRequirement(
    { text: "Experience with an evaluation harness" },
    { personaRoot: root, ledger: ledger([]), identity: { name: "Ruben Saucedo" } }
  );
  assert.equal(result.status, GAP_STATUS.UNMINED);
});

// Deliberately not a negation detector. "We evaluated X and chose Y" is a
// first-person sentence about real work, and a claim derived from it would be
// honest. Negation in English is unbounded; a detector loses the same way a
// verb list does.
test("a first-person sentence with a negative outcome is still the candidate's work", () => {
  const root = persona({
    "evidence/notes/decision.md": "We evaluated the evaluation harness approach and chose not to adopt it.",
  });
  const result = triageRequirement(
    { text: "Experience with an evaluation harness" },
    { personaRoot: root, ledger: ledger([]), identity: { name: "Ruben Saucedo" } }
  );
  assert.equal(result.status, GAP_STATUS.UNMINED);
});

// Found by running triage against a real Vercel posting: a claim about payroll
// work was listed as adjacent to an evals requirement because both texts
// contained the word "including". Adjacency is what keeps a requirement from
// being reported as a real gap, so the listing itself is not the defect -- but
// calling it a reason to question a human is.
//
// The word has to be uncommon enough in the corpus to survive the
// uninformative-term cut and still be meaningless, which is exactly what the
// real corpus looked like: `including` in 8 of 188 claims.
const NOISE_CORPUS = [
  "Ran payroll reconciliation including quarterly reports.",
  "Migrated the billing service including its schema.",
  "Rewrote the notification pipeline for the mobile clients.",
  "Documented the deployment runbook and the rollback path.",
  "Audited vendor invoices against the signed statements of work.",
  "Tuned the nightly batch job to finish inside its window.",
  "Replaced the legacy cron scheduler with a managed queue.",
  "Backfilled the customer address table after the merge.",
  "Split the monolith test suite so it could run in parallel.",
  "Consolidated three staging environments into one.",
];

const asLedger = (facts) => ({
  claims: facts.map((fact, i) => ({ id: `c-${i + 1}`, fact, status: "verified" })),
});

test("a shared function word is incidental adjacency, not a question", () => {
  const found = findAdjacentClaims(
    asLedger(NOISE_CORPUS),
    { text: "Experience including distributed tracing" }
  );
  const payroll = found.find((c) => c.fact.includes("payroll"));
  assert.ok(payroll, "the claim is still listed, so this is not reported as a real gap");
  assert.equal(payroll.basis, "incidental");
  assert.deepEqual(payroll.distinctiveTerms, []);
});

test("incidental adjacency alone does not escalate to a human", () => {
  const result = triageRequirement(
    { text: "Experience including distributed tracing" },
    { personaRoot: persona({}), ledger: asLedger(NOISE_CORPUS), identity: {} }
  );
  assert.equal(result.status, GAP_STATUS.ADJACENT, "still not a real gap");
  assert.equal(result.escalateToHuman, false, "noise must not interrupt a human");
  assert.notEqual(result.routes[0].kind, "ask_scoped_question");
});

test("one rare ordinary word stays incidental in a large ledger", () => {
  const claims = Array.from({ length: 188 }, (_, index) => ({
    id: `c-${index + 1}`,
    fact: `Delivered ordinary project work item ${index}.`,
    status: "verified",
  }));
  claims[0].fact = "Helped hold a recurring planning meeting.";
  claims[1].fact = "Coordinated routine security onboarding.";
  const found = findAdjacentClaims(
    { claims },
    { text: "Must hold an active US Top Secret security clearance" }
  );
  const hold = found.find((claim) => claim.sharedTerms.includes("hold"));
  const security = found.find((claim) => claim.sharedTerms.includes("security"));
  assert.equal(hold?.basis, "incidental");
  assert.deepEqual(hold?.distinctiveTerms, []);
  assert.equal(security?.basis, "incidental");
  assert.deepEqual(security?.distinctiveTerms, []);
});

test("one recognized skill remains substantive in a large ledger", () => {
  const claims = Array.from({ length: 188 }, (_, index) => ({
    id: `c-${index + 1}`,
    fact: `Delivered ordinary project work item ${index}.`,
    status: "verified",
  }));
  claims[0].fact = "Maintained Kubernetes tooling for an internal service.";
  const found = findAdjacentClaims(
    { claims },
    { text: "Experience operating Kubernetes in production" }
  );
  const kubernetes = found.find((claim) => claim.sharedTerms.includes("kubernetes"));
  assert.equal(kubernetes?.basis, "named_skill");
});

test("multiple reinforcing clearance terms remain substantive", () => {
  const result = triageRequirement(
    { text: "Must hold an active US Top Secret security clearance" },
    {
      personaRoot: persona({}),
      ledger: asLedger([
        "Worked under an active Top Secret security clearance.",
        ...NOISE_CORPUS,
      ]),
      identity: {},
    }
  );
  assert.equal(result.status, GAP_STATUS.ADJACENT);
  assert.equal(result.escalateToHuman, true);
  assert.equal(result.routes[0].kind, "ask_scoped_question");
});

// The counterpart: a genuinely specific shared term must still reach a human.
test("reinforcing distinctive terms still produce a scoped question", () => {
  const result = triageRequirement(
    { text: "Experience with durable execution guarantees" },
    {
      personaRoot: persona({}),
      ledger: asLedger([
        "Designed the durable execution semantics for our workflow engine.",
        ...NOISE_CORPUS,
      ]),
      identity: {},
    }
  );
  assert.equal(result.status, GAP_STATUS.ADJACENT);
  assert.equal(result.escalateToHuman, true);
  assert.equal(result.routes[0].kind, "ask_scoped_question");
});

// Ranking must not be by raw count, or five function words would outrank one
// precise term.
test("relatedness ranks a precise match above several vague ones", () => {
  const facts = [
    "Designed durable execution semantics for the workflow engine.",
    "Delivered a project with a team using a process for a product with results.",
    "Shipped work on a product with results for a team using a process.",
    "Led a project for a product with results and a team.",
    "Ran a process for a team on a product with results.",
  ];
  const found = findAdjacentClaims(
    { claims: facts.map((fact, i) => ({ id: `c-${i + 1}`, fact, status: "verified" })) },
    { text: "durable execution for a product with results for a team using a process" }
  );
  assert.match(found[0].fact, /durable execution/);
});

// The status vocabulary lives in three places: the runtime enum, the schema
// agents write against, and the table agents read. #37 was a doc and a schema
// that disagreed, which is a contract that does not exist, and only a test
// reading both could notice. Same shape here, with one more source.
test("runtime, schema and skill table agree on the status vocabulary", () => {
  const schema = fs.readFileSync(
    new URL("../src/schemas/application-strategy.js", import.meta.url), "utf8"
  );
  const skill = fs.readFileSync(
    new URL("../skills/resume-application-strategy/SKILL.md", import.meta.url), "utf8"
  );
  const statuses = Object.values(GAP_STATUS).sort();

  // Anchored on a member rather than on the field name: the schema has more
  // than one `status` enum, and the first is the strategy's own readiness.
  const start = schema.lastIndexOf("z.enum([", schema.indexOf('"unmined"'));
  const schemaEnum = schema
    .slice(start, schema.indexOf("])", start))
    .match(/"([a-z_]+)"/g)
    .map((s) => s.replace(/"/g, ""))
    .sort();
  assert.deepEqual(schemaEnum, statuses, "schema enum drifted from GAP_STATUS");

  const documented = [...skill.matchAll(/^\s*\|\s*`([a-z_]+)`\s*\|/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(documented, statuses, "skill table drifted from GAP_STATUS");
});

// `body.includes(term)` matched substrings, so `rust` was satisfied by "trust"
// and `top` by "topics". `unmined` is the least alarming status and it *closes*
// the requirement -- no question, no route -- so a false one is silent. The
// candidate was told he was covered for a clearance he does not hold.
test("a term must match a whole word, not a fragment inside one", () => {
  const root = persona({
    "evidence/reviews/2025/text/review.md":
      "Built trust across the org while explaining complex topics such as deployment pipelines, and led the evaluation of vendor options.",
  });
  for (const text of [
    "Experience with Rust systems programming",
    "Must hold an active US Top Secret security clearance",
    "Experience building eval harnesses",
  ]) {
    const hits = searchCorpus(root, { text });
    assert.deepEqual(hits, [], `"${text}" must not match on a substring`);
  }
});

// Tokens keep `+`, `#` and `.` so these stay single words rather than
// fragmenting into pieces that match everything.
test("punctuated skill names survive tokenisation", () => {
  const root = persona({
    "evidence/reviews/2025/text/review.md":
      "Ported the c++ renderer to node.js and shipped the .net service.",
  });
  for (const term of ["c++", "node.js", ".net"]) {
    assert.ok(
      searchCorpus(root, { text: `Ported the ${term} renderer service` }).length > 0,
      `${term} should match as one token`
    );
  }
});

// The lexicon is a closed list, so the "a named skill must actually appear"
// guard silently vanished for any skill it had not been taught -- and the
// fallback, any two shared words, is something a real corpus always satisfies.
// The corpus itself says which term is specific: a requirement's rarest term is
// what it is really about, and a corpus that never contains it is not answering
// it.
test("prose around an unrecognised skill is not coverage of that skill", () => {
  const root = persona({
    "evidence/reviews/2025/text/review.md":
      "Held an active role on the security review board and presented systems programming guidance to the top of the org.",
  });
  const result = triageRequirement(
    { text: "Must hold an active US Top Secret security clearance" },
    { personaRoot: root, ledger: ledger([]), identity: {} }
  );
  assert.notEqual(result.status, GAP_STATUS.UNMINED);
  assert.deepEqual(searchCorpus(root, { text: "Experience with Rust systems programming" }), []);
});

// The guard must not swing so far that genuine coverage is discarded: when the
// corpus does contain the specific term, the hit still stands.
test("an unrecognised skill the corpus actually names is still a hit", () => {
  const root = persona({
    "evidence/reviews/2025/text/review.md":
      "Wrote the Rust ingestion service and its systems programming test harness.",
  });
  const hits = searchCorpus(root, { text: "Experience with Rust systems programming" });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].matchedTerms.includes("rust"));
});
