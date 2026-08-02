import test from "node:test";
import assert from "node:assert/strict";
import { renderJobSearchReport } from "../src/lib/job-search.js";

function candidate(overrides = {}) {
  return {
    jobId: "job-1",
    title: "Senior Frontend Engineer",
    company: "Northwind",
    location: "SF",
    url: "https://x.co/1",
    remote: "hybrid",
    compensation: null,
    postedDate: null,
    source: "linkedin",
    angles: ["fit", "market"],
    agreementCount: 2,
    scores: { fit: 90, market: 80, growth: null },
    consensusScore: 85,
    rationale: [{ angle: "fit", text: "match" }],
    matchedClaims: [],
    matchedPreferences: [],
    concerns: [],
    recommendation: "lead",
    promoteToApplication: true,
    isNew: true,
    firstSeenRunDate: "2026-08-05",
    timesSeen: 1,
    ...overrides,
  };
}

function report(candidates, overrides = {}) {
  return {
    schemaVersion: "1.0",
    persona: "example",
    runDate: "2026-08-05",
    preferencesHash: "a".repeat(64),
    sources: ["linkedin"],
    scouts: [{ angle: "fit", model: "m", candidateCount: 1 }],
    minAgreement: 2,
    consensusThreshold: 70,
    candidates,
    excluded: [],
    newLeadCount: null,
    ...overrides,
  };
}

test("without dedup data the report omits the new-lead surface", () => {
  const md = renderJobSearchReport(report([candidate()]));
  assert.match(md, /## Your top matches/);
  assert.doesNotMatch(md, /🆕/);
  assert.doesNotMatch(md, /seen ×/);
});

test("with dedup data each card says whether it is new or resurfaced", () => {
  const seen = candidate({ jobId: "job-2", company: "Acme", url: "https://x.co/2", isNew: false, firstSeenRunDate: "2026-07-20", timesSeen: 4 });
  const md = renderJobSearchReport(report([candidate(), seen], { newLeadCount: 1 }));
  assert.match(md, /🆕 new/);
  assert.match(md, /seen ×4 since 2026-07-20/);
});

test("cards rank by evidence, not by recency", () => {
  // A strong resurfaced role must outrank a weak new one: the operator is
  // choosing where to apply, not catching up on a feed.
  const strongOld = candidate({ jobId: "job-2", company: "Acme", url: "https://x.co/2", isNew: false, timesSeen: 3, scores: { fit: 90, market: 70, growth: null } });
  const weakNew = candidate({ jobId: "job-3", company: "Zephyr", url: "https://x.co/3", isNew: true, scores: { fit: 40, market: 70, growth: null } });
  const md = renderJobSearchReport(report([weakNew, strongOld], { newLeadCount: 1 }));
  assert.ok(md.indexOf("Acme") < md.indexOf("Zephyr"), "the stronger match leads regardless of recency");
  assert.match(md, /### 1\. Acme/);
});

test("coverage reports zero-result companies and why, not just the ones with hits", () => {
  const md = renderJobSearchReport(report([], {
    coverage: [
      { company: "Northwind", queries: ["Senior SWE"], found: 2, read: 2, zeroReason: "", zeroCause: null, requested: true },
      { company: "Initech", queries: ["Senior SWE"], found: 0, read: 0, zeroReason: "Titles are unleveled", zeroCause: "title_mismatch", requested: true },
    ],
  }));
  assert.match(md, /## Appendix — coverage \(2 companies searched, 1 returned nothing\)/);
  assert.match(md, /Titles are unleveled/);
  assert.match(md, /\*\*Initech\*\*/);
});

test("zero-result causes are grouped into search tuning, never flattened together", () => {
  const md = renderJobSearchReport(report([], {
    coverage: [
      { company: "Initech", queries: ["q"], found: 0, read: 0, zeroReason: "unleveled titles", zeroCause: "title_mismatch", requested: true },
      { company: "Umbrella", queries: ["q"], found: 0, read: 0, zeroReason: "unprefixed titles", zeroCause: "title_mismatch", requested: true },
      { company: "Vandelay", queries: ["q"], found: 0, read: 0, zeroReason: "all SF hybrid", zeroCause: "location", requested: true },
    ],
  }));
  assert.match(md, /## Want me to widen the net\?/);
  // Same cause groups together; a different cause must not be folded in with it.
  assert.match(md, /\*\*Initech, Umbrella\*\* post this work under titles/);
  assert.match(md, /\*\*Vandelay\*\* are hiring, but not where you can work/);
  // The finding is paired with an offer to act on it, not left as a note.
  assert.match(md, /Say the word and I'll re-run these on unprefixed titles/);
});

test("a watched posting keeps the scout reasoning that explains it", () => {
  const md = renderJobSearchReport(report([], {
    excluded: [{
      jobId: "job-9", title: "Senior Security Engineer", company: "Northwind",
      reason: "below_fit_floor (38/60)", disposition: "watch", blocker: "this req, not this company",
      url: "https://x.co/9", location: "NY", remote: "any", compensation: null,
      scores: { fit: 38, market: 80, growth: 55 },
      rationale: [{ angle: "fit", text: "wants a security-title engineer; ledger has product engineering" }],
      matchedClaims: ["claim-react"], concerns: ["no security ownership"],
    }],
  }));
  assert.match(md, /### 1\. Northwind — Senior Security Engineer/);
  assert.match(md, /a company you named — this particular req is the mismatch/);
  assert.match(md, /wants a security-title engineer/);
  assert.match(md, /no security ownership/);
});

test("a blocked posting names the single gate standing in the way", () => {
  const md = renderJobSearchReport(report([], {
    excluded: [{
      jobId: "job-8", title: "Senior Web Developer", company: "Fabrikam",
      reason: "below_threshold (64/70)", disposition: "blocked",
      blocker: "missed the 70 gate by 6, on growth alone",
      url: "https://x.co/8", location: "NY", remote: "any", compensation: null,
      scores: { fit: 85, market: 72, growth: 40 },
      rationale: [{ angle: "fit", text: "strong match" }], matchedClaims: [], concerns: [],
    }],
  }));
  assert.match(md, /\*\*If you apply\*\*/);
  assert.match(md, /One thing stands in the way: missed the 70 gate by 6, on growth alone/);
});

test("a card attributes each fit point to the claims that carry it", () => {
  const md = renderJobSearchReport(report([candidate({
    fitEvidence: [
      { point: "Agent orchestration and tool-calling", claims: ["claim-agent-stack", "claim-mcp"] },
      { point: "React and TypeScript in production", claims: ["claim-react"] },
    ],
  })]));
  assert.match(md, /\*\*Why you fit\*\*/);
  assert.match(md, /Agent orchestration and tool-calling — `claim-agent-stack`, `claim-mcp`/);
  assert.match(md, /React and TypeScript in production — `claim-react`/);
});

test("a gap the operator could answer is rendered as a question, not a verdict", () => {
  const md = renderJobSearchReport(report([candidate({
    gaps: [
      { requirement: "Kubernetes experience", askOperator: "Have you run anything on K8s, even internally?", blocking: false },
      { requirement: "US citizenship required", askOperator: "", blocking: true },
    ],
  })]));
  assert.match(md, /Kubernetes experience$/m);
  assert.match(md, /❓ Have you run anything on K8s, even internally\?/);
  // A hard requirement is marked as such; a nice-to-have is not.
  assert.match(md, /US citizenship required \*\*\(blocking\)\*\*/);
});

test("evidence gaps and things to weigh are kept in separate sections", () => {
  const md = renderJobSearchReport(report([candidate({
    concernsByAngle: [
      { angle: "fit", text: "No Go experience verified" },
      { angle: "market", text: "Band tops out below your floor" },
      { angle: "growth", text: "Lateral, not a step up" },
    ],
  })]));
  const gapsAt = md.indexOf("What they ask that your evidence does not cover");
  const applyAt = md.indexOf("If you apply");
  const gapsBlock = md.slice(gapsAt, applyAt);
  assert.match(gapsBlock, /No Go experience verified/);
  // Comp and trajectory are considerations, not holes in the evidence.
  assert.doesNotMatch(gapsBlock, /Band tops out below your floor/);
  assert.match(md.slice(applyAt), /Band tops out below your floor/);
  assert.match(md.slice(applyAt), /Lateral, not a step up/);
});

test("the report never states a probability of being hired", () => {
  const md = renderJobSearchReport(report([candidate()]));
  assert.match(md, /not a hiring probability/);
  assert.doesNotMatch(md, /likely to be hired|chance of (?:getting|being) hired|% likely/i);
});

test("cards cover postings the gate rejected, not just the ones it passed", () => {
  const md = renderJobSearchReport(report([], {
    excluded: [{
      jobId: "job-5", title: "Senior AI Engineer", company: "Initrode",
      reason: "below_threshold (67/70)", disposition: "blocked",
      blocker: "missed the 70 gate by 3, on market alone",
      url: "https://x.co/5", location: "Remote-US", remote: "remote", compensation: null,
      scores: { fit: 75, market: 55, growth: 70 },
      rationale: [{ angle: "fit", text: "close analog to verified agent work" }],
      matchedClaims: ["claim-agent-stack"], concerns: [],
    }],
  }));
  assert.match(md, /### 1\. Initrode — Senior AI Engineer/);
  assert.match(md, /close analog to verified agent work/);
});

test("only the strongest ten postings become cards", () => {
  const many = Array.from({ length: 14 }, (_, i) =>
    candidate({ jobId: `job-${i}`, company: `Co${String(i).padStart(2, "0")}`, url: `https://x.co/${i}`, scores: { fit: 90 - i, market: 70, growth: null } })
  );
  const md = renderJobSearchReport(report(many));
  assert.match(md, /### 10\. Co09/);
  assert.doesNotMatch(md, /### 11\./);
  // The rest are still reported, just not as full cards.
  assert.match(md, /## Also scored — 4/);
  assert.match(md, /\*\*Co13\*\*/);
});
