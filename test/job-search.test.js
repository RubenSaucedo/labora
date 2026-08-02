import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCandidates,
  canonicalJobId,
  postingHash,
  validateDiscoveryReport,
  validateFitReportGrounding,
  validateScoutReportsAgainstDiscovery,
} from "../src/lib/job-search.js";
import { ZCompanyCoverage, ZAdjacentCompany } from "../src/schemas/job-search.js";

function cand(overrides = {}) {
  return {
    jobId: "",
    title: "Senior Frontend Engineer",
    company: "Northwind",
    location: "San Francisco, CA",
    url: "",
    officialUrl: "",
    remote: "hybrid",
    compensation: null,
    postedDate: null,
    observedAt: "",
    postingHash: "",
    status: "unknown",
    source: "linkedin",
    angle: "fit",
    score: 80,
    rationale: "matches",
    matchedClaims: [],
    matchedPreferences: [],
    concerns: [],
    ...overrides,
  };
}

function report(angle, candidates) {
  return { angle, candidates: candidates.map((c) => ({ ...c, angle })) };
}

test("canonicalJobId collapses aggregator and official URLs for the same role", () => {
  const a = canonicalJobId(cand({ url: "https://linkedin.com/jobs/123" }));
  const b = canonicalJobId(cand({ url: "https://careers.northwind.example/jobs/456" }));
  assert.equal(a, b);
});

test("canonicalJobId falls back to company|title|location without a url", () => {
  const a = canonicalJobId(cand({ company: "Acme", title: "SWE", location: "SF" }));
  const b = canonicalJobId(cand({ company: "acme ", title: " swe", location: "sf" }));
  assert.equal(a, b);
});

test("promotes a job only when >= minAgreement distinct angles pool it", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates, excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 90 })]),
    report("market", [cand({ ...j, score: 80 })]),
    report("growth", [cand({ jobId: "job-2", url: "https://x.co/2", score: 95 })]),
  ], { minAgreement: 2, consensusThreshold: 70 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].jobId, "job-1");
  assert.equal(candidates[0].agreementCount, 2);
  assert.equal(candidates[0].consensusScore, 85);
  assert.equal(candidates[0].promoteToApplication, true);
  assert.ok(excluded.some((e) => e.jobId === "job-2" && e.reason === "missing_fit_score"));
});

test("excludes a job below the consensus threshold even with enough agreement", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates, excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 60 })]),
    report("market", [cand({ ...j, score: 62 })]),
  ], { minAgreement: 2, consensusThreshold: 70 });

  assert.equal(candidates.length, 0);
  assert.ok(excluded.some((e) => /below_threshold/.test(e.reason)));
});

test("market and growth agreement cannot promote a job without a fit score", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates, excluded } = reconcileCandidates([
    report("market", [cand({ ...j, score: 95 })]),
    report("growth", [cand({ ...j, score: 95 })]),
  ], { minAgreement: 2, consensusThreshold: 70 });

  assert.equal(candidates.length, 0);
  assert.ok(excluded.some((e) => e.reason === "missing_fit_score"));
});

test("fit floor excludes attractive jobs that are not credible matches", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates, excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 50 })]),
    report("market", [cand({ ...j, score: 95 })]),
    report("growth", [cand({ ...j, score: 90 })]),
  ], { minAgreement: 2, consensusThreshold: 70, fitFloor: 60 });

  assert.equal(candidates.length, 0);
  assert.ok(excluded.some((e) => /below_fit_floor/.test(e.reason)));
});

test("avoid list excludes a matching company before scoring gates", () => {
  const j = { jobId: "job-1", url: "https://x.co/1", company: "CryptoCasino Inc" };
  const { candidates, excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 95 })]),
    report("market", [cand({ ...j, score: 95 })]),
  ], { minAgreement: 2, consensusThreshold: 70, avoid: ["CryptoCasino"] });

  assert.equal(candidates.length, 0);
  assert.ok(excluded.some((e) => e.reason === "avoid_list"));
});

test("consensus score uses the max per angle and averages present angles", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 70 }), cand({ ...j, score: 90 })]),
    report("market", [cand({ ...j, score: 80 })]),
  ], { minAgreement: 2, consensusThreshold: 70 });

  assert.equal(candidates[0].scores.fit, 90);
  assert.equal(candidates[0].scores.market, 80);
  assert.equal(candidates[0].scores.growth, null);
  assert.equal(candidates[0].consensusScore, 85);
});

test("unions matched claims/preferences/concerns and records per-angle rationale", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { candidates } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 88, matchedClaims: ["c1"], concerns: ["x"] })]),
    report("growth", [cand({ ...j, score: 82, matchedClaims: ["c1", "c2"], matchedPreferences: ["goal"] })]),
  ], { minAgreement: 2, consensusThreshold: 70 });

  const c = candidates[0];
  assert.deepEqual(c.matchedClaims.sort(), ["c1", "c2"]);
  assert.deepEqual(c.matchedPreferences, ["goal"]);
  assert.deepEqual(c.concerns, ["x"]);
  assert.equal(c.rationale.length, 2);
  assert.equal(c.recommendation, "lead");
});

test("requires every scoring scout to evaluate the shared discovered set", () => {
  const discoveredJob = {
    ...cand({ jobId: "job-1", angle: undefined }),
    officialUrl: "",
    observedAt: "",
    postingHash: "",
    status: "unknown",
  };
  delete discoveredJob.angle;
  delete discoveredJob.score;
  delete discoveredJob.rationale;
  delete discoveredJob.matchedClaims;
  delete discoveredJob.matchedPreferences;
  delete discoveredJob.concerns;
  const discovery = { jobs: [discoveredJob] };
  const reports = [
    report("fit", [cand({ jobId: "job-1" })]),
    report("market", [cand({ jobId: "job-1" })]),
    report("growth", [cand({ jobId: "job-1" })]),
  ];
  assert.equal(validateScoutReportsAgainstDiscovery(discovery, reports), true);

  reports[2].candidates = [];
  assert.throws(
    () => validateScoutReportsAgainstDiscovery(discovery, reports),
    /coverage differs/
  );
});

test("scouts cannot mutate discovery-owned posting fields", () => {
  const discoveredJob = {
    ...cand({ jobId: "job-1", angle: undefined }),
  };
  delete discoveredJob.angle;
  delete discoveredJob.score;
  delete discoveredJob.rationale;
  delete discoveredJob.matchedClaims;
  delete discoveredJob.matchedPreferences;
  delete discoveredJob.concerns;
  const reports = [
    report("fit", [cand({ jobId: "job-1" })]),
    report("market", [cand({ jobId: "job-1" })]),
    report("growth", [cand({ jobId: "job-1" })]),
  ];
  reports[1].candidates[0].remote = "remote";
  assert.throws(
    () => validateScoutReportsAgainstDiscovery({ jobs: [discoveredJob] }, reports),
    /changed discovered identity/
  );
});

test("discovery validates posting snapshots and run freshness", () => {
  const postingText = "Senior Frontend Engineer\nBuild React applications.";
  const job = {
    title: "Senior Frontend Engineer",
    company: "Northwind",
    location: "Remote",
  };
  const discovery = {
    generatedAt: "2026-07-29T04:05:00.000Z",
    metadata: { evaluatedAt: "2026-07-29T04:04:00.000Z" },
    jobs: [{
      ...job,
      jobId: canonicalJobId(job),
      observedAt: "2026-07-29T03:05:00.000Z",
      postingText,
      postingHash: postingHash(postingText),
    }],
  };
  assert.equal(validateDiscoveryReport(discovery, { runDate: "2026-07-29" }), true);
  assert.throws(
    () => validateDiscoveryReport(
      { ...discovery, jobs: [{ ...discovery.jobs[0], postingHash: "0".repeat(64) }] },
      { runDate: "2026-07-29" }
    ),
    /postingHash mismatch/
  );
  assert.throws(
    () => validateDiscoveryReport(discovery, { runDate: "2026-07-30" }),
    /must match run date/
  );
  assert.throws(
    () => validateDiscoveryReport(
      {
        ...discovery,
        jobs: [{
          ...discovery.jobs[0],
          observedAt: "2026-07-29T05:05:00.000Z",
        }],
      },
      { runDate: "2026-07-29" }
    ),
    /outside the 24-hour run window/
  );
  assert.throws(
    () => validateDiscoveryReport(
      {
        ...discovery,
        metadata: { evaluatedAt: "2030-01-01T00:00:00.000Z" },
      },
      { runDate: "2026-07-29" }
    ),
    /evaluatedAt must match run date/
  );
  assert.equal(
    validateDiscoveryReport(
      {
        ...discovery,
        generatedAt: "2026-07-31T04:05:00.000Z",
        metadata: { evaluatedAt: "2026-07-31T04:04:00.000Z" },
        jobs: [{
          ...discovery.jobs[0],
          observedAt: "2026-07-31T03:05:00.000Z",
        }],
      },
      { runDate: "2026-07-30", timeZone: "America/Los_Angeles" }
    ),
    true
  );
  assert.throws(
    () => validateDiscoveryReport(
      {
        ...discovery,
        jobs: [
          discovery.jobs[0],
          { ...discovery.jobs[0] },
        ],
      },
      { runDate: "2026-07-29" }
    ),
    /duplicate jobId/
  );
  assert.throws(
    () => validateDiscoveryReport(
      {
        ...discovery,
        jobs: [{ ...discovery.jobs[0], jobId: "wrong-id" }],
      },
      { runDate: "2026-07-29" }
    ),
    /jobId mismatch/
  );
});

test("scout reports must be generated during the dated discovery run", () => {
  const discoveredJob = {
    ...cand({
      jobId: "job-1",
      angle: undefined,
      observedAt: "2026-07-29T04:05:00.000Z",
      postingHash: "a".repeat(64),
    }),
  };
  delete discoveredJob.angle;
  delete discoveredJob.score;
  delete discoveredJob.rationale;
  delete discoveredJob.matchedClaims;
  delete discoveredJob.matchedPreferences;
  delete discoveredJob.concerns;
  const reports = ["fit", "market", "growth"].map((angle) => ({
    ...report(angle, [cand({
      jobId: "job-1",
      observedAt: discoveredJob.observedAt,
      postingHash: discoveredJob.postingHash,
    })]),
    generatedAt: "2026-07-29T04:10:00.000Z",
    metadata: { evaluatedAt: "2026-07-29T04:09:00.000Z" },
  }));
  assert.equal(
    validateScoutReportsAgainstDiscovery(
      { generatedAt: "2026-07-29T04:05:00.000Z", jobs: [discoveredJob] },
      reports,
      { runDate: "2026-07-29" }
    ),
    true
  );
  reports[0].generatedAt = "2026-07-30T04:10:00.000Z";
  assert.throws(
    () => validateScoutReportsAgainstDiscovery(
      { generatedAt: "2026-07-29T04:05:00.000Z", jobs: [discoveredJob] },
      reports,
      { runDate: "2026-07-29" }
    ),
    /must match run date/
  );
  reports[0].generatedAt = "2026-07-29T04:10:00.000Z";
  reports[0].metadata = { evaluatedAt: "2030-01-01T00:00:00.000Z" };
  assert.throws(
    () => validateScoutReportsAgainstDiscovery(
      { generatedAt: "2026-07-29T04:05:00.000Z", jobs: [discoveredJob] },
      reports,
      { runDate: "2026-07-29" }
    ),
    /evaluatedAt must match run date/
  );
});

test("fit scores at the promotion floor require verified claim and preference grounding", () => {
  const reports = [
    report("fit", [cand({
      jobId: "job-1",
      score: 80,
      matchedClaims: ["claim-react"],
      matchedPreferences: ["React"],
    })]),
  ];
  const claims = {
    claims: [{ id: "claim-react", status: "verified" }],
  };
  const preferences = {
    targetTitles: [],
    targetLevels: [],
    locations: [],
    mustHaves: ["React"],
    goals: [],
    remotePreference: "any",
  };
  assert.equal(
    validateFitReportGrounding(reports, claims, preferences, { fitFloor: 60 }),
    true
  );
  assert.throws(
    () => validateFitReportGrounding(
      [report("fit", [cand({
        jobId: "job-1",
        score: 80,
        matchedClaims: ["invented"],
        matchedPreferences: ["React"],
      })])],
      claims,
      preferences,
      { fitFloor: 60 }
    ),
    /unverified or unknown claims/
  );
  assert.throws(
    () => validateFitReportGrounding(
      [report("fit", [cand({ jobId: "job-1", score: 80 })])],
      claims,
      preferences,
      { fitFloor: 60 }
    ),
    /lacks both verified claim and preference grounding/
  );
});

test("all scouts must use verified claims and configured preferences", () => {
  const reports = [
    report("fit", [cand({
      jobId: "job-1",
      score: 80,
      matchedClaims: ["claim-react"],
      matchedPreferences: ["React"],
    })]),
    report("growth", [cand({
      jobId: "job-1",
      matchedClaims: ["invented"],
      matchedPreferences: ["React"],
    })]),
  ];
  assert.throws(
    () => validateFitReportGrounding(
      reports,
      { claims: [{ id: "claim-react", status: "verified" }] },
      {
        targetTitles: [],
        targetLevels: [],
        locations: [],
        mustHaves: ["React"],
        goals: [],
        remotePreference: "any",
        minCompensation: null,
      },
      { fitFloor: 60 }
    ),
    /growth scout.*unverified or unknown claims/
  );
});

test("a rejected posting keeps the reasoning that explains the rejection", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 30, rationale: "wants security ownership", concerns: ["no security history"], matchedClaims: [] })]),
    report("market", [cand({ ...j, score: 90, rationale: "comp clears floor" })]),
  ]);
  assert.equal(excluded.length, 1);
  // "below_fit_floor (30/60)" alone is not a finding; the reason must survive.
  assert.match(excluded[0].rationale.find((r) => r.angle === "fit").text, /security ownership/);
  assert.deepEqual(excluded[0].concerns, ["no security history"]);
  assert.equal(excluded[0].scores.fit, 30);
});

test("a weak req at a named target company is watched, not written off", () => {
  const j = { jobId: "job-1", url: "https://x.co/1", company: "Northwind" };
  const scouts = [
    report("fit", [cand({ ...j, score: 30 })]),
    report("market", [cand({ ...j, score: 90 })]),
  ];
  const watched = reconcileCandidates(scouts, { targetCompanies: ["Northwind"] });
  assert.equal(watched.excluded[0].disposition, "watch");

  const unnamed = reconcileCandidates(scouts, { targetCompanies: ["Contoso"] });
  assert.equal(unnamed.excluded[0].disposition, "no_fit");
});

test("target-company matching survives legal suffixes and punctuation", () => {
  const j = { jobId: "job-1", url: "https://x.co/1", company: "Globex, Inc" };
  const { excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 30 })]),
    report("market", [cand({ ...j, score: 90 })]),
  ], { targetCompanies: ["Globex"] });
  assert.equal(excluded[0].disposition, "watch");
});

test("clearing fit but missing the threshold is blocked, and names the weak angle", () => {
  const j = { jobId: "job-1", url: "https://x.co/1" };
  const { excluded } = reconcileCandidates([
    report("fit", [cand({ ...j, score: 85 })]),
    report("growth", [cand({ ...j, score: 40 })]),
  ], { consensusThreshold: 70 });
  assert.equal(excluded[0].disposition, "blocked");
  assert.match(excluded[0].blocker, /growth/);
  assert.match(excluded[0].blocker, /by 7/);
});

test("target companies count as citable preference evidence", () => {
  const prefs = {
    targetTitles: ["Senior Frontend Engineer"],
    targetCompanies: ["Northwind"],
    remotePreference: "any",
    minCompensation: null,
  };
  const scouts = [report("fit", [cand({
    jobId: "job-1", url: "https://x.co/1", score: 80,
    matchedClaims: ["claim-1"], matchedPreferences: ["Northwind"],
  })])];
  const ledger = { claims: [{ id: "claim-1", status: "verified" }] };
  assert.doesNotThrow(() => validateFitReportGrounding(scouts, ledger, prefs));

  // Without the company in preferences the same citation is ungrounded.
  assert.throws(
    () => validateFitReportGrounding(scouts, ledger, { ...prefs, targetCompanies: [] }),
    /unknown preferences: Northwind/,
  );
});

test("a company that found nothing cannot be recorded without saying why", () => {
  const entry = (o) => ({ company: "Initech", queries: ["q"], found: 0, read: 0, zeroReason: "", zeroCause: null, requested: true, ...o });
  assert.throws(() => ZCompanyCoverage.parse(entry({})), /must record why/);
  assert.doesNotThrow(() => ZCompanyCoverage.parse(entry({ zeroReason: "titles are unleveled" })));
  // A company with hits owes no explanation.
  assert.doesNotThrow(() => ZCompanyCoverage.parse(entry({ found: 2, read: 2 })));
});

test("an adjacent company cannot be marked verified without the postings that verify it", () => {
  const base = { company: "Contoso", because: "same design-tool category as Fabrikam", anchorCompany: "Fabrikam", verified: true };
  assert.throws(() => ZAdjacentCompany.parse({ ...base, openings: [] }));
  assert.throws(() => ZAdjacentCompany.parse({ ...base, verified: false, openings: [{ title: "Senior SWE", url: "https://f.co/1" }] }));
  assert.doesNotThrow(() =>
    ZAdjacentCompany.parse({ ...base, openings: [{ title: "Senior SWE", location: "NY", url: "https://f.co/1" }] })
  );
});
