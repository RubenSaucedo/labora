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

// The status vocabulary is the contract: four statuses that need four different
// actions, never one bucket called "pending".
test("no status collapses into a single pending bucket", () => {
  assert.deepEqual(
    Object.values(GAP_STATUS).sort(),
    ["adjacent", "collectible", "real_gap", "unmined"]
  );
});
