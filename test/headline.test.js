// Headline analysis in isolation. Split from the validator integration tests
// in claims.test.js on purpose: this module imports no dependency, so these
// tests still run on a machine where nothing is installed — which is where a
// headline gets written when someone is applying for a job on a locked-down
// laptop.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { analyzeHeadline, classifySegments, headlineSegments } from "../src/lib/headline.js";
import { requiredDependencies } from "../src/lib/tool-dependencies.js";
import { pluginRoot } from "../src/lib/paths.js";

test("headline analysis runs where no dependency is installed", () => {
  const declared = Object.keys(
    JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).dependencies || {}
  );
  assert.deepEqual(
    requiredDependencies(path.join(pluginRoot, "src", "lib", "headline.js"), declared),
    []
  );
});

test("segments are the unit of analysis, and multiword phrases stay whole", () => {
  assert.deepEqual(
    headlineSegments("Senior Software Engineer, Distributed Systems | Go"),
    ["Senior Software Engineer", "Distributed Systems", "Go"]
  );
  assert.deepEqual(headlineSegments(""), []);
});

test("restating the role is positioning, not a capability claim", () => {
  const { positioning, qualifiers } = classifySegments(
    "Software Engineer, Distributed Systems",
    { targetRole: "Software Engineer" }
  );
  assert.deepEqual(positioning, ["Software Engineer"]);
  assert.deepEqual(qualifiers, ["Distributed Systems"]);
});

test("the posting's own title also anchors positioning", () => {
  const { positioning } = classifySegments("Staff Engineer, Platform", {
    targetRole: "",
    jobTitle: "Staff Engineer",
  });
  assert.deepEqual(positioning, ["Staff Engineer"]);
});

// The regression that motivated the role-only anchor: a headline that copies
// the requisition title verbatim is the #59 failure case, so the domain segment
// must stay a qualifier rather than being exempted by the title containing it.
test("copying the requisition title does not exempt its domain qualifier", () => {
  const { positioning, qualifiers } = classifySegments("Software Engineer, Workflows", {
    targetRole: "Software Engineer",
    jobTitle: "Software Engineer, Workflows",
  });
  assert.deepEqual(positioning, ["Software Engineer"]);
  assert.deepEqual(qualifiers, ["Workflows"]);
});

test("an unmapped qualifier warns, and never blocks", () => {
  const findings = analyzeHeadline({
    atsTitle: "Engineer, Distributed Systems",
    targetRole: "Engineer",
    resume: { provenance: { headline: [] } },
    ledger: { claims: [] },
  });
  const finding = findings.find((item) => item.code === "headline_term_unmapped");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.location, "ats_title");
});

test("unverified, rejected and internal-only claims cannot carry a headline", () => {
  for (const claim of [
    { id: "c1", fact: "Built distributed systems.", status: "needs_review" },
    { id: "c1", fact: "Built distributed systems.", status: "rejected" },
    { id: "c1", fact: "Built distributed systems.", status: "verified", disclosure: "internal_only" },
  ]) {
    const findings = analyzeHeadline({
      atsTitle: "Engineer, Distributed Systems",
      targetRole: "Engineer",
      resume: { provenance: { headline: [{ term: "Distributed Systems", claimIds: ["c1"] }] } },
      ledger: { claims: [claim] },
    });
    assert.equal(
      findings.find((item) => item.code === "headline_term_unattested")?.severity,
      "warning",
      "a claim that cannot be rendered cannot ground the most-read line"
    );
  }
});

test("a verified renderable claim attests the qualifier", () => {
  const findings = analyzeHeadline({
    atsTitle: "Engineer, Distributed Systems",
    targetRole: "Engineer",
    resume: { provenance: { headline: [{ term: "Distributed Systems", claimIds: ["c1"] }] } },
    ledger: {
      claims: [{
        id: "c1",
        fact: "Internal detail.",
        externalFact: "Built distributed systems.",
        status: "verified",
        disclosure: "internal_generalizable",
      }],
    },
  });
  assert.ok(!findings.some((item) => item.code.startsWith("headline_term_un")));
});

// score-resume-ats.js puts `ats_title` into resumeSearchableText, so a check
// reading ATS output would be reading its own input.
const workflowsSpec = {
  title: "Software Engineer, Workflows",
  requirements: [{
    id: "req-001",
    severity: "core",
    text: "Experience with durable execution workflows",
    canonicalTerms: ["workflows"],
    surfaceForms: ["workflows"],
  }],
};

const workflowsWithAlternativesSpec = {
  ...workflowsSpec,
  requirements: [
    ...workflowsSpec.requirements,
    {
      id: "req-002",
      severity: "core",
      text: "Production experience with React",
      canonicalTerms: ["react"],
      surfaceForms: ["React"],
    },
  ],
};

test("a collision is read from the job spec and the ledger, never from ATS scoring", () => {
  const findings = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: { provenance: { headline: [] } },
    ledger: {
      claims: [{
        id: "c2",
        fact: "Built production React applications.",
        status: "verified",
        disclosure: "public",
      }],
    },
    jobSpec: workflowsWithAlternativesSpec,
  });
  const collision = findings.find((item) => item.code === "headline_requirement_collision");
  assert.equal(collision.severity, "warning");
  assert.match(collision.message, /req-001/);
  assert.deepEqual(collision.alternatives, [
    {
      headline: "Software Engineer",
      qualifier: null,
      claimIds: [],
      basis: "role_positioning",
    },
    {
      headline: "Software Engineer, React",
      qualifier: "React",
      claimIds: ["c2"],
      basis: "verified_claim",
    },
  ]);
  assert.match(collision.suggestedNote, /req-001/);
  assert.equal(
    findings.find((item) => item.code === "headline_collision_note_missing")?.severity,
    "warning"
  );
  assert.ok(
    findings.every((item) => item.severity !== "error"),
    "lexical coverage may never block a release"
  );
});

test("recording the narrower posting meaning clears the missing-note finding", () => {
  const findings = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: {
      provenance: { headline: [] },
      notes_for_human: [
        "Headline collision: Workflows overlaps req-001; confirm the narrower meaning.",
      ],
    },
    ledger: { claims: [] },
    jobSpec: workflowsSpec,
  });

  assert.ok(findings.some((item) => item.code === "headline_requirement_collision"));
  assert.ok(!findings.some((item) => item.code === "headline_collision_note_missing"));
});

test("copying the unresolved note placeholder does not record a chosen action", () => {
  const initial = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: { provenance: { headline: [] } },
    ledger: { claims: [] },
    jobSpec: workflowsSpec,
  });
  const suggestedNote = initial.find(
    (item) => item.code === "headline_requirement_collision"
  ).suggestedNote;
  const findings = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: {
      provenance: { headline: [] },
      notes_for_human: [suggestedNote],
    },
    ledger: { claims: [] },
    jobSpec: workflowsSpec,
  });

  assert.ok(findings.some((item) => item.code === "headline_collision_note_missing"));
});

test("headline alternatives never rely on unrenderable claims", () => {
  const findings = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: { provenance: { headline: [] } },
    ledger: {
      claims: [{
        id: "c2",
        fact: "Built production React applications.",
        status: "verified",
        disclosure: "internal_only",
      }],
    },
    jobSpec: workflowsWithAlternativesSpec,
  });
  const collision = findings.find((item) => item.code === "headline_requirement_collision");

  assert.deepEqual(collision.alternatives, [{
    headline: "Software Engineer",
    qualifier: null,
    claimIds: [],
    basis: "role_positioning",
  }]);
});

test("ledger support clears the collision", () => {
  const findings = analyzeHeadline({
    atsTitle: "Software Engineer, Workflows",
    targetRole: "Software Engineer",
    resume: { provenance: { headline: [{ term: "Workflows", claimIds: ["c1"] }] } },
    ledger: {
      claims: [{ id: "c1", fact: "Built durable execution workflows.", status: "verified", disclosure: "public" }],
    },
    jobSpec: workflowsSpec,
  });
  assert.ok(!findings.some((item) => item.code === "headline_requirement_collision"));
});

test("a preferred requirement is not a collision", () => {
  const findings = analyzeHeadline({
    atsTitle: "Engineer, Workflows",
    targetRole: "Engineer",
    resume: { provenance: { headline: [] } },
    ledger: { claims: [] },
    jobSpec: {
      title: "Engineer",
      requirements: [{
        id: "req-009",
        severity: "preferred",
        text: "Nice to have: workflows",
        canonicalTerms: ["workflows"],
        surfaceForms: ["workflows"],
      }],
    },
  });
  assert.ok(!findings.some((item) => item.code === "headline_requirement_collision"));
});

test("a term the posting never uses is neutral information, not a defect", () => {
  const findings = analyzeHeadline({
    atsTitle: "Engineer, Observability",
    targetRole: "Engineer",
    resume: { provenance: { headline: [{ term: "Observability", claimIds: ["c1"] }] } },
    ledger: { claims: [{ id: "c1", fact: "Owned observability.", status: "verified", disclosure: "public" }] },
    jobSpec: { title: "Engineer", requirements: [{ id: "r1", severity: "core", text: "Write Go" }] },
  });
  const finding = findings.find((item) => item.code === "headline_term_absent_from_posting");
  assert.equal(finding.severity, "info");
  assert.match(finding.message, /not a defect/);
});

test("absent optional inputs degrade to silence, not to a failure", () => {
  assert.deepEqual(
    analyzeHeadline({
      atsTitle: "Engineer, Distributed Systems",
      targetRole: "Engineer",
      resume: { provenance: { headline: [{ term: "Distributed Systems", claimIds: ["c1"] }] } },
    }),
    [],
    "no ledger and no job spec means nothing is knowable, not that something is wrong"
  );
  assert.deepEqual(analyzeHeadline({}), []);
  assert.deepEqual(analyzeHeadline({ atsTitle: "   " }), []);
});

test("nothing this module emits can ever block a release", () => {
  const everything = analyzeHeadline({
    atsTitle: "Engineer, Workflows, Observability, Rust",
    targetRole: "Engineer",
    resume: { provenance: { headline: [{ term: "Rust", claimIds: ["missing"] }] } },
    ledger: { claims: [] },
    jobSpec: workflowsSpec,
  });
  assert.ok(everything.length > 0, "the fixture should produce findings");
  assert.ok(everything.every((item) => item.severity !== "error"));
});

test("run-state goes stale when disclosure or headline policy changes", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "src", "lib", "run-manifest.js"), "utf8");
  const claimsStage = source.slice(source.indexOf("validate_claims: {"));
  const claimsBlock = claimsStage.slice(0, claimsStage.indexOf("outputs:"));
  assert.match(claimsBlock, /headline\.js/, "changed headline logic must invalidate the stage");
  assert.match(claimsBlock, /job-spec\.json/, "a re-analysed posting must invalidate the stage");
  assert.match(claimsBlock, /disclosure\.js/, "disclosure policy must invalidate claim validation freshness");

  const formatStage = source.slice(source.indexOf("format: {"));
  const formatBlock = formatStage.slice(0, formatStage.indexOf("outputs:"));
  assert.match(formatBlock, /disclosure\.js/, "disclosure policy must invalidate format freshness");
});
