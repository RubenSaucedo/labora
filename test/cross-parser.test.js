import test from "node:test";
import assert from "node:assert/strict";
import { crossParserDivergence } from "../src/lib/validate-artifact.js";
import { agent2ResumeToFormatterJson } from "../src/agents/format-resume.js";
import { injectContact } from "../src/lib/profile-contact.js";

function formatterResume() {
  return agent2ResumeToFormatterJson(injectContact({
    target_role: "Engineer",
    ats_title: "Engineer",
    contact: {
      name: "", email: "", phone: "", location: "",
      linkedin: "", github: "", portfolio: "",
    },
    summary: "Engineer with a record of shipping reliable systems.",
    skills_primary: ["GraphQL"],
    skills_secondary: [],
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Engineer",
      period: "2022 - Present",
      bullets: ["Built a reliable React application"],
    }],
    education: [{
      school: "Example University",
      degree: "BS Computer Science",
      location: "Seattle, WA",
      startDate: "2014",
      endDate: "2018",
    }],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    keywords_mapped: [],
  }, { name: "Jane Example", email: "jane@example.com", phone: "+1 555-123-4567" }));
}

const FULL_TEXT =
  "Jane Example jane@example.com +1 555-123-4567 Engineer Summary Engineer with a record of shipping reliable systems. " +
  "Experience Example Engineer 2022 - Present Built a reliable React application Skills GraphQL " +
  "Education Example University BS Computer Science 2014 2018 Seattle WA";

test("identical extractions report full agreement and no divergence", () => {
  const result = crossParserDivergence({
    resume: formatterResume(),
    primaryText: FULL_TEXT,
    secondaryText: FULL_TEXT,
  });
  assert.equal(result.divergentFields.length, 0);
  assert.equal(result.agreementPercent, 100);
  assert.equal(result.issues.length, 0);
});

test("a field only the primary parser recovers is flagged as a warning", () => {
  const secondaryDroppingSkill = FULL_TEXT.replace(" Skills GraphQL ", " Skills ");
  const result = crossParserDivergence({
    resume: formatterResume(),
    primaryText: FULL_TEXT,
    secondaryText: secondaryDroppingSkill,
    secondaryParser: "ocr-render",
  });
  assert.ok(result.divergentFields.some((f) => f.startsWith("skills")));
  assert.ok(result.onlySecondaryMissing.some((f) => f.startsWith("skills")));
  assert.equal(result.onlyPrimaryMissing.length, 0);
  assert.ok(result.agreementPercent < 100);
  assert.ok(result.issues.every((i) => i.severity === "warning" && i.code === "cross_parser_divergence"));
  assert.ok(result.issues.some((i) => /ocr-render/.test(i.detail)));
});

test("a field neither parser recovers is not a divergence", () => {
  const bothDropSkill = FULL_TEXT.replace(" Skills GraphQL ", " Skills ");
  const result = crossParserDivergence({
    resume: formatterResume(),
    primaryText: bothDropSkill,
    secondaryText: bothDropSkill,
  });
  assert.equal(result.divergentFields.length, 0);
});
