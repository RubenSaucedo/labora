import test from "node:test";
import assert from "node:assert/strict";
import { extractJobRequirements } from "../src/lib/job-requirements.js";

test("extracts structured requirements without markdown heading tokens", () => {
  const spec = extractJobRequirements({
    title: "Senior Frontend Engineer",
    company: "Example",
    description: `### Requirements
- Expert in React and TypeScript
- Strong understanding of web accessibility (WCAG 2.1)

### Nice to have
- Experience with design systems or component libraries`,
  });

  assert.equal(spec.requirements.length, 3);
  assert.deepEqual(spec.requirements[0].canonicalTerms, ["react", "typescript"]);
  assert.equal(spec.requirements[0].matchMode, "all");
  assert.equal(spec.requirements[0].severity, "core");
  assert.equal(spec.requirements[2].priority, "preferred");
  assert.equal(spec.requirements[2].severity, "preferred");
  assert.equal(spec.requirements[2].matchMode, "any");
  assert.equal(spec.requirements.some((requirement) => requirement.text.includes("###")), false);
});

test("extracts years and authorization constraints", () => {
  const spec = extractJobRequirements({
    description: `## Minimum Qualifications
- 8+ years of software development experience
- Must be authorized to work in the United States`,
  });

  assert.equal(spec.requirements[0].kind, "years");
  assert.equal(spec.requirements[0].minimumYears, 8);
  assert.equal(spec.requirements[1].kind, "authorization");
  assert.equal(spec.requirements[1].severity, "hard_eligibility");
});

test("classifies TS/SCI and Public Trust as hard eligibility", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- Active TS/SCI required\n- Public Trust required",
  });
  assert.deepEqual(
    spec.requirements.map(({ kind, severity }) => ({ kind, severity })),
    [
      { kind: "clearance", severity: "hard_eligibility" },
      { kind: "clearance", severity: "hard_eligibility" },
    ]
  );
});

test("classifies behavioral language as a soft signal", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- Excellent communication and collaboration skills",
  });
  assert.equal(spec.requirements[0].severity, "soft_signal");
});

test("does not treat available visa sponsorship as missing authorization", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- Visa sponsorship is available for this role",
  });
  assert.notEqual(spec.requirements[0].kind, "authorization");
  assert.equal(spec.requirements[0].severity, "soft_signal");
});

test("preferred qualifications are not promoted to required", () => {
  const spec = extractJobRequirements({
    description: "## Preferred Qualifications\n- Experience with GraphQL",
  });

  assert.equal(spec.requirements[0].priority, "preferred");
});

test("software license compliance is not professional licensure", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- Experience with software license compliance",
  });

  assert.notEqual(spec.requirements[0].kind, "license");
  assert.notEqual(spec.requirements[0].severity, "hard_eligibility");
});

test("compound experience and license text emits separate constraints", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- 5+ years of nursing experience and a current RN license required",
  });
  assert.deepEqual(
    spec.requirements.map(({ kind, severity }) => ({ kind, severity })),
    [
      { kind: "years", severity: "core" },
      { kind: "license", severity: "hard_eligibility" },
    ]
  );
});

test("must-have software license experience is not licensure", () => {
  const spec = extractJobRequirements({
    description: "## Requirements\n- Must have experience with software license compliance",
  });
  assert.notEqual(spec.requirements[0].kind, "license");
});

test("substantive lines containing heading cues are retained", () => {
  const spec = extractJobRequirements({
    description: "Requirements\n5+ years of React experience required",
  });
  assert.equal(spec.requirements.length, 1);
  assert.equal(spec.requirements[0].priority, "required");
  assert.match(spec.requirements[0].text, /5\+ years/);
});
