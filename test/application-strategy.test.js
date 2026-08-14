import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateApplicationStrategy } from "../src/lib/application-strategy.js";
import { ZApplicationStrategy } from "../src/schemas/application-strategy.js";

function fixture() {
  return {
    jobSpec: {
      requirements: [
        { id: "req-001", severity: "core", text: "React experience" },
        { id: "req-002", severity: "preferred", text: "GraphQL experience" },
      ],
    },
    claimLedger: {
      claims: [
        { id: "claim-1", status: "verified", fact: "Built React applications." },
        { id: "claim-2", status: "needs_review", fact: "Used GraphQL." },
      ],
    },
    strategy: {
      status: "ready",
      topSignals: [{
        requirementIds: ["req-001"],
        claimIds: ["claim-1"],
      }],
      likelyConcerns: [],
      evidenceRequests: [],
      firstPagePlan: { leadClaimIds: ["claim-1"] },
    },
  };
}

test("accepts strategy references to verified claims and known requirements", () => {
  const result = validateApplicationStrategy(fixture());
  assert.equal(result.valid, true);
});

test("rejects unknown requirements and non-verified claims", () => {
  const input = fixture();
  input.strategy.topSignals[0].requirementIds = ["req-999"];
  input.strategy.topSignals[0].claimIds = ["claim-2"];
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_requirement"));
  assert.ok(result.issues.some((issue) => issue.code === "unverified_claim"));
});

test("ready strategy cannot hide pending evidence questions", () => {
  const input = fixture();
  input.strategy.evidenceRequests = [{
    requirementId: "req-002",
    resolution: "pending",
  }];
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "pending_evidence"));
});

test("rejects concern severity that weakens the job specification", () => {
  const input = fixture();
  input.strategy.likelyConcerns = [{
    requirementId: "req-001",
    text: "React experience",
    severity: "soft_signal",
    evidenceStatus: "unsupported",
  }];
  input.strategy.evidenceRequests = [{
    requirementId: "req-001",
    resolution: "candidate_has_no_evidence",
  }];
  input.strategy.topSignals = [];
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "severity_mismatch"));
});

test("requires evidence requests for unsupported core concerns", () => {
  const input = fixture();
  input.strategy.topSignals = [];
  input.strategy.likelyConcerns = [{
    requirementId: "req-001",
    text: "React experience",
    severity: "core",
    evidenceStatus: "unsupported",
  }];
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_evidence_request"));
});

test("rejects unrelated claims mapped to a hard requirement", () => {
  const input = fixture();
  input.jobSpec.requirements[0] = {
    id: "req-001",
    kind: "clearance",
    severity: "hard_eligibility",
    text: "Must hold active security clearance",
  };
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "claim_requirement_mismatch"));
});

test("unsupported hard eligibility cannot be marked ready as not applicable", () => {
  const input = fixture();
  input.jobSpec.requirements[0] = {
    id: "req-001",
    kind: "clearance",
    severity: "hard_eligibility",
    text: "Must hold active security clearance",
  };
  input.strategy.topSignals = [];
  input.strategy.likelyConcerns = [{
    requirementId: "req-001",
    text: "Must hold active security clearance",
    severity: "hard_eligibility",
    evidenceStatus: "unsupported",
  }];
  input.strategy.evidenceRequests = [{
    requirementId: "req-001",
    resolution: "not_applicable",
  }];
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "unresolved_hard_eligibility"));
});

test("an unrelated certification cannot support a different required license", () => {
  const input = fixture();
  input.jobSpec.requirements[0] = {
    id: "req-001",
    kind: "license",
    severity: "hard_eligibility",
    text: "Active CPA license required",
  };
  input.claimLedger.claims[0].fact = "AWS Certified Solutions Architect.";
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "claim_requirement_mismatch"));
});

test("compound license text ignores unrelated authorization acronyms", () => {
  const input = fixture();
  input.jobSpec.requirements[0] = {
    id: "req-001",
    kind: "license",
    severity: "hard_eligibility",
    text: "Current RN license and US work authorization required",
  };
  input.claimLedger.claims[0].fact = "Holds a current RN license.";
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, true);
});

function withShortlist(entries, units) {
  const input = fixture();
  input.strategy.unitShortlist = entries;
  input.bank = units === undefined
    ? { units: [{ id: "unit-react", claimIds: ["claim-1"] }] }
    : units;
  return input;
}

function withSummaryPlan() {
  const input = withShortlist([{
    unitId: "unit-react",
    rank: 1,
    matchedRequirementIds: ["req-001"],
    rationale: "Direct React ownership.",
  }], {
    units: [{
      id: "unit-react",
      claimIds: ["claim-1"],
      contribution: "tech_lead",
    }],
  });
  input.strategy.firstPagePlan.summaryPlan = {
    identity: {
      engineerType: "Frontend engineer",
      anchor: "Verified product experience",
      scope: "React application delivery",
      claimIds: ["claim-1"],
      unitIds: ["unit-react"],
    },
    recentProof: {
      accomplishment: "React application delivery",
      contributionLevel: "tech_lead",
      concreteContext: "Owned delivery of a React application",
      claimIds: ["claim-1"],
      primaryUnitId: "unit-react",
    },
    differentiator: null,
  };
  return input;
}

test("accepts a shortlist whose units carry the requirements they claim", () => {
  const result = validateApplicationStrategy(withShortlist([{
    unitId: "unit-react",
    rank: 1,
    matchedRequirementIds: ["req-001"],
    rationale: "Direct React ownership.",
  }]));
  assert.equal(result.valid, true);
});

test("the shipped strategy fixture uses the narrative summary plan schema", () => {
  const strategy = JSON.parse(fs.readFileSync(
    new URL("../data/personas/example/applications/acme-senior-fe-mar-25/application-strategy.json", import.meta.url),
    "utf8"
  ));
  assert.equal(ZApplicationStrategy.safeParse(strategy).success, true);
  assert.equal(strategy.firstPagePlan.summaryFocus, undefined);
});

test("accepts a summary plan grounded in verified claims and units", () => {
  assert.equal(validateApplicationStrategy(withSummaryPlan()).valid, true);
});

test("rejects a recent proof contribution level that inflates its unit", () => {
  const input = withSummaryPlan();
  input.strategy.firstPagePlan.summaryPlan.recentProof.contributionLevel = "sole_owner";
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "summary_contribution_mismatch"));
});

test("rejects recent proof claims borrowed from a separate unit", () => {
  const input = withSummaryPlan();
  input.claimLedger.claims.push({
    id: "claim-3",
    status: "verified",
    fact: "Delivered a separate release milestone.",
  });
  input.bank.units.push({
    id: "unit-delivery",
    claimIds: ["claim-3"],
    contribution: "major_contributor",
  });
  input.strategy.firstPagePlan.summaryPlan.recentProof.claimIds.push("claim-3");
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "summary_recent_proof_crosses_units"));
});

test("rejects a shortlist entry naming an unknown unit", () => {
  const result = validateApplicationStrategy(withShortlist([{
    unitId: "unit-ghost",
    rank: 1,
    matchedRequirementIds: [],
    rationale: "n/a",
  }]));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_unit"));
});

test("a shortlist cannot be verified without an accomplishment bank", () => {
  const result = validateApplicationStrategy(withShortlist([{
    unitId: "unit-react",
    rank: 1,
    matchedRequirementIds: [],
    rationale: "n/a",
  }], null));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_unit"));
});

test("rejects a unit mapped to a requirement none of its claims support", () => {
  const result = validateApplicationStrategy(withShortlist([{
    unitId: "unit-react",
    rank: 1,
    matchedRequirementIds: ["req-002"],
    rationale: "Overreach.",
  }]));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "unit_requirement_mismatch"));
});

test("rejects duplicated shortlist units and ranks", () => {
  const result = validateApplicationStrategy(withShortlist([
    { unitId: "unit-react", rank: 1, matchedRequirementIds: [], rationale: "a" },
    { unitId: "unit-react", rank: 1, matchedRequirementIds: [], rationale: "b" },
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_shortlist_unit"));
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_shortlist_rank"));
});

test("an absent shortlist stays valid for pre-bank strategies", () => {
  const input = fixture();
  assert.equal(validateApplicationStrategy(input).valid, true);
});

function missedEvidenceFixture() {
  const input = fixture();
  input.jobSpec.requirements.push({
    id: "req-003",
    severity: "core",
    text: "Kubernetes orchestration experience",
  });
  input.claimLedger.claims.push({
    id: "claim-3",
    status: "verified",
    fact: "Ran Kubernetes orchestration for production workloads.",
  });
  input.bank = {
    units: [
      { id: "unit-react", claimIds: ["claim-1"] },
      { id: "unit-k8s", claimIds: ["claim-3"] },
    ],
  };
  input.strategy.unitShortlist = [{
    unitId: "unit-react",
    rank: 1,
    matchedRequirementIds: ["req-001"],
    rationale: "React proof.",
  }];
  return input;
}

test("flags a core requirement the candidate can prove but the shortlist ignored", () => {
  const result = validateApplicationStrategy(missedEvidenceFixture());
  assert.equal(result.valid, false);
  const missed = result.issues.find((issue) => issue.code === "missed_evidence");
  assert.ok(missed, "expected a missed_evidence error");
  assert.match(missed.message, /claim-3/);
  assert.match(missed.message, /unit-k8s/);
});

test("shortlisting the carrying unit resolves the miss", () => {
  const input = missedEvidenceFixture();
  input.strategy.unitShortlist.push({
    unitId: "unit-k8s",
    rank: 2,
    matchedRequirementIds: ["req-003"],
    rationale: "Direct Kubernetes proof.",
  });
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, true);
});

test("consciously naming the requirement as a concern also resolves the miss", () => {
  const input = missedEvidenceFixture();
  input.strategy.likelyConcerns = [{
    requirementId: "req-003",
    text: "Kubernetes orchestration experience",
    severity: "core",
    evidenceStatus: "supported",
  }];
  const result = validateApplicationStrategy(input);
  assert.ok(!result.issues.some((issue) => issue.code === "missed_evidence"));
});

test("a merely preferred miss warns without blocking release", () => {
  const input = missedEvidenceFixture();
  input.jobSpec.requirements[2].severity = "preferred";
  const result = validateApplicationStrategy(input);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((issue) => issue.code === "missed_evidence"));
});

test("no accomplishment bank means no missed-evidence claims are invented", () => {
  const input = missedEvidenceFixture();
  input.bank = null;
  input.strategy.unitShortlist = [];
  const result = validateApplicationStrategy(input);
  assert.ok(!result.issues.some((issue) => issue.code === "missed_evidence"));
});
