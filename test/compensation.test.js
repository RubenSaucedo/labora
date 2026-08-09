import test from "node:test";
import assert from "node:assert/strict";
import { parseCompensation } from "../src/lib/compensation.js";

// A run recorded `compensation: null` for every posting while the bands were
// present in the captured text. The report then told the operator pay was not
// published and to ask the recruiter -- wrong advice, and wrong in a way that
// shaped ranking, since preferences carry a minCompensation floor.
test("parses the standard published band", () => {
  const parsed = parseCompensation(
    "The San Francisco base pay range for this role is $180,000 - $220,000."
  );
  assert.equal(parsed.min, 180000);
  assert.equal(parsed.max, 220000);
  assert.equal(parsed.currency, "USD");
});

test("K notation and word separators are the same number", () => {
  for (const text of [
    "Salary range: $150K to $190K USD annually.",
    "Salary range: $150,000 - $190,000 USD annually.",
    "Salary range: $150K – $190,000 USD annually.",
  ]) {
    const parsed = parseCompensation(text);
    assert.equal(parsed.min, 150000, text);
    assert.equal(parsed.max, 190000, text);
  }
});

// The number means something different depending on which city it was quoted
// for, so the qualifier is captured rather than dropped.
test("captures the city the band was quoted for", () => {
  assert.equal(
    parseCompensation("The New York, NY base pay range for this role is $200K—$240K.").locationQualifier,
    "New York, NY"
  );
  assert.equal(
    parseCompensation("The Seattle pay range for this position is $170K to $210K.").locationQualifier,
    "Seattle"
  );
});

// Pay vocabulary is not a place name.
test("does not mistake pay vocabulary for a city", () => {
  for (const text of [
    "Base salary range is $90,000 - $120,000 depending on experience.",
    "Annual salary range: $120,000-$150,000.",
    "Total compensation range: $200,000 to $260,000.",
  ]) {
    assert.equal(parseCompensation(text).locationQualifier, "", text);
  }
});

test("reads non-USD currencies", () => {
  assert.equal(parseCompensation("Base salary range is £90,000 – £120,000.").currency, "GBP");
  assert.equal(parseCompensation("Compensation range: €80,000 to €110,000.").currency, "EUR");
});

// null must mean "absent from the posting", never "not extracted" -- but a
// number in a pay sentence that is not the annual base band must not be
// promoted into one either.
test("returns null when no band is published", () => {
  assert.equal(parseCompensation("We offer competitive compensation and great benefits."), null);
  assert.equal(parseCompensation("Compensation is commensurate with experience."), null);
  assert.equal(parseCompensation(""), null);
});

test("an hourly rate is not an annual band", () => {
  assert.equal(parseCompensation("The pay rate for this role is $45 - $60 per hour."), null);
  assert.equal(parseCompensation("Compensation: $50/hour to $70/hour."), null);
});

test("a funding or revenue figure is not a salary", () => {
  assert.equal(parseCompensation("Our Series B raised $50,000,000 to $60,000,000."), null);
  assert.equal(parseCompensation("We serve customers with $10M to $50M in revenue."), null);
});

// The operator must be able to check the number rather than trust it.
test("quotes the sentence the band came from", () => {
  const text = "Some intro. The Austin base pay range for this role is $160,000 - $200,000. More text.";
  assert.match(parseCompensation(text).source, /Austin base pay range/);
});

test("an inverted range is not a band", () => {
  assert.equal(parseCompensation("Salary range: $200,000 - $150,000."), null);
});

// The three defects in #6 were reported together because each is small. This
// one had real decision impact: the operator was told to ask a recruiter about
// pay the posting had already published.
test("a recovered band is reported as published, with the city it was quoted for", async () => {
  const { renderJobSearchReport } = await import("../src/lib/job-search.js");
  const report = {
    schemaVersion: "1.0",
    persona: "t",
    runDate: "2026-01-01",
    preferencesHash: "x",
    sources: ["greenhouse"],
    scouts: [],
    minAgreement: 2,
    consensusThreshold: 70,
    fitFloor: 60,
    candidates: [{
      jobId: "j-1",
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://example.com/j1",
      remote: "remote",
      compensation: {
        min: 180000,
        max: 220000,
        currency: "USD",
        source: "The San Francisco base pay range for this role is $180,000 - $220,000.",
        locationQualifier: "San Francisco",
      },
      consensusScore: 80,
      agreement: 2,
      angles: [],
      rationale: [],
    }],
    excluded: [],
    coverage: [],
  };
  const markdown = renderJobSearchReport(report);
  assert.match(markdown, /180K–220K/);
  assert.match(markdown, /San Francisco/);
  assert.doesNotMatch(markdown, /comp not published/);
});

// A malformed flag was accepted as a positional path and created a directory
// literally named `--out/` in the working directory. Because that directory is
// the operator's persona workspace, it dropped untracked output into their
// private data repo, and a silent success is the worst outcome: nothing tells
// them where the files went.
test("a mistyped flag is never accepted as an output path", async () => {
  const { assertNotAFlag } = await import("../src/lib/file-safety.js");
  for (const bad of ["--out", "-o", "--output"]) {
    assert.throws(() => assertNotAFlag(bad, "Output directory"), /looks like a flag/);
  }
  assert.equal(assertNotAFlag("out/preview", "Output directory"), "out/preview");
  assert.equal(assertNotAFlag("/tmp/x", "Output directory"), "/tmp/x");
});
