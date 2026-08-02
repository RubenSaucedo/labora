import test from "node:test";
import assert from "node:assert/strict";
import { applySeenLedger } from "../src/lib/job-search.js";

function report(candidates, overrides = {}) {
  return {
    schemaVersion: "1.0",
    persona: "example",
    runDate: "2026-08-01",
    preferencesHash: "a".repeat(64),
    sources: ["linkedin"],
    scouts: [],
    minAgreement: 2,
    consensusThreshold: 70,
    candidates,
    excluded: [],
    ...overrides,
  };
}

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
    ...overrides,
  };
}

test("first run marks every candidate new and seeds the ledger", () => {
  const { report: out, ledger } = applySeenLedger({
    report: report([candidate()]),
    ledger: null,
    runDate: "2026-08-01",
  });
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].isNew, true);
  assert.equal(out.candidates[0].firstSeenRunDate, "2026-08-01");
  assert.equal(out.candidates[0].timesSeen, 1);
  assert.equal(out.newLeadCount, 1);
  assert.equal(ledger.jobs["job-1"].timesSeen, 1);
  assert.equal(ledger.jobs["job-1"].firstSeenRunDate, "2026-08-01");
});

test("a resurfaced job is not new and preserves its firstSeenRunDate", () => {
  const first = applySeenLedger({
    report: report([candidate()]),
    ledger: null,
    runDate: "2026-08-01",
  });
  const second = applySeenLedger({
    report: report([candidate()], { runDate: "2026-08-05" }),
    ledger: first.ledger,
    runDate: "2026-08-05",
  });
  const c = second.report.candidates[0];
  assert.equal(c.isNew, false);
  assert.equal(c.firstSeenRunDate, "2026-08-01");
  assert.equal(c.timesSeen, 2);
  assert.equal(second.report.newLeadCount, 0);
  assert.equal(second.ledger.jobs["job-1"].lastSeenRunDate, "2026-08-05");
});

test("suppressSeen moves already-seen jobs to excluded but keeps new ones", () => {
  const first = applySeenLedger({
    report: report([candidate()]),
    ledger: null,
    runDate: "2026-08-01",
  });
  const second = applySeenLedger({
    report: report([candidate(), candidate({ jobId: "job-2", url: "https://x.co/2" })]),
    ledger: first.ledger,
    runDate: "2026-08-05",
    suppressSeen: true,
  });
  assert.deepEqual(second.report.candidates.map((c) => c.jobId), ["job-2"]);
  assert.ok(second.report.excluded.some((e) => e.jobId === "job-1" && e.reason === "already_seen"));
  assert.equal(second.report.newLeadCount, 1);
});

test("a disposed job is always excluded regardless of suppressSeen", () => {
  const ledger = {
    schemaVersion: "1.0",
    persona: "example",
    updatedAt: "2026-08-01T00:00:00.000Z",
    jobs: {
      "job-1": {
        title: "Senior Frontend Engineer",
        company: "Northwind",
        url: "https://x.co/1",
        firstSeenRunDate: "2026-07-20",
        lastSeenRunDate: "2026-07-20",
        timesSeen: 1,
        disposition: "applied",
      },
    },
  };
  const { report: out } = applySeenLedger({
    report: report([candidate()]),
    ledger,
    runDate: "2026-08-05",
    suppressSeen: false,
  });
  assert.equal(out.candidates.length, 0);
  assert.ok(out.excluded.some((e) => e.jobId === "job-1" && e.reason === "disposition_applied"));
});
