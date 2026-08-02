import test from "node:test";
import assert from "node:assert/strict";
import { scoreAts } from "../src/lib/score-resume-ats.js";

function resume(overrides = {}) {
  return {
    target_role: "Senior Frontend Engineer",
    ats_title: "Senior Frontend Engineer",
    summary: "Senior Frontend Engineer with 7 years of experience.",
    skills_primary: ["React", "TypeScript"],
    skills_secondary: [],
    experience: [{
      id: "example-role",
      company: "Example",
      role: "Senior Frontend Engineer",
      period: "2020 - Present",
      bullets: ["Built React applications with TypeScript"],
    }],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    keywords_mapped: [],
    ...overrides,
  };
}

const job = {
  title: "Senior Frontend Engineer",
  company: "Example",
  description: `### Requirements
- 5+ years of frontend development experience
- Expert in React and TypeScript
- Strong understanding of web accessibility (WCAG 2.1)`,
};

test("internal keyword metadata cannot increase coverage", () => {
  const baseline = scoreAts({ resume: resume(), job });
  const contaminated = scoreAts({
    resume: resume({
      keywords_mapped: [{
        keyword: "WCAG 2.1 accessibility",
        evidence: "Secret unsupported testing framework and accessibility metadata",
      }],
    }),
    job,
  });

  assert.equal(contaminated.lexical_coverage_percent, baseline.lexical_coverage_percent);
  assert.deepEqual(contaminated.must_have_missing, baseline.must_have_missing);
});

test("compound required concepts require every supported term", () => {
  const result = scoreAts({
    resume: resume({
      skills_primary: ["React"],
      experience: [{
        id: "example-role",
        company: "Example",
        role: "Senior Frontend Engineer",
        period: "2020 - Present",
        bullets: ["Built React applications"],
      }],
    }),
    job: {
      ...job,
      description: "### Requirements\n- Expert in React and TypeScript",
    },
  });

  assert.equal(result.requirement_coverage_percent, 0);
  assert.deepEqual(result.must_have_missing, ["Expert in React and TypeScript"]);
});

test("missing requirements are full source lines rather than token guesses", () => {
  const result = scoreAts({ resume: resume(), job });
  assert.deepEqual(result.must_have_missing, [
    "Strong understanding of web accessibility (WCAG 2.1)",
  ]);
  assert.deepEqual(result.core_requirements_missing, [
    "Strong understanding of web accessibility (WCAG 2.1)",
  ]);
  assert.deepEqual(result.hard_eligibility_missing, []);
  assert.equal(result.missing_keywords.includes("###"), false);
  assert.equal(result.missing_keywords.includes("requirements"), false);
});

test("employment years use relevant interval union rather than calendar span", () => {
  const result = scoreAts({
    resume: resume({
      summary: "Frontend engineer.",
      experience: [
        {
          id: "old",
          company: "Old",
          role: "Frontend Engineer",
          period: "2010 - 2011",
          bullets: ["Built frontend applications"],
        },
        {
          id: "new",
          company: "New",
          role: "Frontend Engineer",
          period: "2025 - Present",
          bullets: ["Built frontend applications"],
        },
      ],
    }),
    job: {
      title: "Frontend Engineer",
      description: "Requirements\n- 5+ years of frontend development experience",
    },
  });
  assert.equal(result.requirement_coverage_percent, 0);
});

test("compound year requirements require the duration for each skill", () => {
  const result = scoreAts({
    resume: resume({
      summary: "Frontend engineer.",
      experience: [
        {
          id: "react-role",
          company: "React Co",
          role: "Frontend Engineer",
          period: "2020 - 2023",
          bullets: ["Built React applications"],
        },
        {
          id: "typescript-role",
          company: "TypeScript Co",
          role: "Frontend Engineer",
          period: "2023 - 2026",
          bullets: ["Built TypeScript applications"],
        },
      ],
    }),
    job: {
      title: "Frontend Engineer",
      description: "Requirements\n- 5+ years of React and TypeScript experience",
    },
  });
  assert.equal(result.requirement_coverage_percent, 0);
});

test("location text does not satisfy work authorization", () => {
  const authorizationJob = {
    title: "Engineer",
    description: "Requirements\n- Must be authorized to work in the United States",
  };
  const missing = scoreAts({
    resume: resume({ summary: "Engineer based in the United States." }),
    job: authorizationJob,
  });
  assert.equal(missing.requirement_coverage_percent, 0);
  assert.deepEqual(missing.hard_eligibility_missing, [
    "Must be authorized to work in the United States",
  ]);

  const matched = scoreAts({
    resume: resume({ summary: "Engineer authorized to work in the United States." }),
    job: authorizationJob,
  });
  assert.equal(matched.requirement_coverage_percent, 100);
});

test("authorization rejects negation and matches the required jurisdiction", () => {
  const canadaJob = {
    title: "Engineer",
    description: "Requirements\n- Must be authorized to work in Canada",
  };
  const negated = scoreAts({
    resume: resume({ summary: "Engineer not authorized to work in Canada." }),
    job: canadaJob,
  });
  assert.equal(negated.requirement_coverage_percent, 0);

  const wrongCountry = scoreAts({
    resume: resume({ summary: "Engineer and U.S. citizen." }),
    job: canadaJob,
  });
  assert.equal(wrongCountry.requirement_coverage_percent, 0);

  const matched = scoreAts({
    resume: resume({ summary: "Engineer authorized to work in Canada." }),
    job: canadaJob,
  });
  assert.equal(matched.requirement_coverage_percent, 100);
});

test("degree requirements match both level and discipline", () => {
  const degreeJob = {
    title: "Engineer",
    description: "Requirements\n- Bachelor's degree in Computer Science",
  };
  const wrongField = scoreAts({
    resume: resume({
      education: [{
        school: "Art School",
        degree: "Bachelor of Fine Arts",
        field: "",
      }],
    }),
    job: degreeJob,
  });
  assert.equal(wrongField.requirement_coverage_percent, 0);

  const matched = scoreAts({
    resume: resume({
      education: [{
        school: "University",
        degree: "BS Computer Science",
        field: "",
      }],
    }),
    job: degreeJob,
  });
  assert.equal(matched.requirement_coverage_percent, 100);
});

test("clearance requirements need an explicit matching credential", () => {
  const clearanceJob = {
    title: "Engineer",
    description: "Requirements\n- Active security clearance required",
  };
  const incidental = scoreAts({
    resume: resume({
      summary: "Built active security monitoring and automated clearance checks.",
    }),
    job: clearanceJob,
  });
  assert.equal(incidental.requirement_coverage_percent, 0);
  assert.deepEqual(incidental.hard_eligibility_missing, [
    "Active security clearance required",
  ]);

  const explicit = scoreAts({
    resume: resume({ summary: "Engineer with an active security clearance." }),
    job: clearanceJob,
  });
  assert.equal(explicit.requirement_coverage_percent, 100);
});

test("TS/SCI is recognized and plain Top Secret cannot satisfy it", () => {
  const jobWithSci = {
    title: "Engineer",
    description: "Requirements\n- Active Top Secret/SCI clearance required",
  };
  const insufficient = scoreAts({
    resume: resume({ summary: "Engineer with an active Top Secret clearance." }),
    job: jobWithSci,
  });
  assert.equal(insufficient.requirement_coverage_percent, 0);

  const exact = scoreAts({
    resume: resume({ summary: "Engineer with active TS/SCI clearance." }),
    job: jobWithSci,
  });
  assert.equal(exact.requirement_coverage_percent, 100);
});

test("Public Trust does not satisfy a security clearance requirement", () => {
  const job = {
    title: "Engineer",
    description: "Requirements\n- Active security clearance required",
  };
  const result = scoreAts({
    resume: resume({ summary: "Engineer with active Public Trust." }),
    job,
  });
  assert.equal(result.requirement_coverage_percent, 0);
});

test("generic clearance does not satisfy Secret security clearance", () => {
  const job = {
    title: "Engineer",
    description: "Requirements\n- Active Secret security clearance required",
  };
  const result = scoreAts({
    resume: resume({ summary: "Engineer with an active security clearance." }),
    job,
  });
  assert.equal(result.requirement_coverage_percent, 0);
});

test("license requirements do not match unrelated certifications", () => {
  const licenseJob = {
    title: "Accountant",
    description: "Requirements\n- Active CPA license required",
  };
  const unrelated = scoreAts({
    resume: resume({
      certifications: [{ name: "AWS Certified Solutions Architect", issuer: "AWS", year: "2025" }],
    }),
    job: licenseJob,
  });

  assert.equal(unrelated.requirement_coverage_percent, 0);
  assert.deepEqual(unrelated.hard_eligibility_missing, ["Active CPA license required"]);

  const matched = scoreAts({
    resume: resume({
      certifications: [{ name: "Active CPA license", issuer: "State Board", year: "2025" }],
    }),
    job: licenseJob,
  });
  assert.equal(matched.requirement_coverage_percent, 100);
});

test("compound years and professional license cannot bypass eligibility", () => {
  const result = scoreAts({
    resume: resume({
      summary: "Nurse with 8 years of nursing experience.",
      skills_primary: [],
      experience: [{
        id: "nurse",
        company: "Hospital",
        role: "Nurse",
        period: "2018 - Present",
        bullets: ["Provided nursing care"],
      }],
    }),
    job: {
      title: "Nurse",
      description: "Requirements\n- 5+ years of nursing experience and a current RN license required",
    },
  });
  assert.deepEqual(result.hard_eligibility_missing, [
    "5+ years of nursing experience and a current RN license required",
  ]);
});
