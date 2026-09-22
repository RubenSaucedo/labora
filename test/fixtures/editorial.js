/**
 * Synthetic editorial fixtures.
 *
 * Everything here is invented for this repository's `example` persona. No real
 * person, employer, posting, product, URL or metric appears in this file, and
 * none may be added to it: these fixtures exist precisely so that reproducing
 * an editorial defect never requires quoting a real career.
 */

import { ZTailoredResume } from "../../src/schemas/tailored-resume.js";

const BLANK_CONTACT = {
  name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "",
};

export const claimLedger = {
  schemaVersion: "1.0",
  persona: "example",
  generatedAt: "2026-01-01T00:00:00Z",
  claims: [
    claim("claim-catalog-pipeline",
      "Designed and built the multi-source catalog pipeline, which gathers provider data concurrently and keeps usable partial results when an individual source fails."),
    claim("claim-catalog-latency",
      "P95 end-to-end completion latency for the catalog request path fell 74% after the pipeline and configuration changes, measured from production telemetry across a shared multi-service path."),
    claim("claim-dashboard-migration",
      "Led migration of a legacy dashboard to a typed TypeScript component architecture, owning the design, rollout and deprecation of the previous implementation."),
    claim("claim-review-practice",
      "Introduced a code review practice and mentored three engineers on it; the practice was adopted by the two teams sharing the codebase."),
    claim("claim-release-checks",
      "Built the automated CI/CD release validation checks that run before every deploy, including regression evaluation of generated output."),
    claim("claim-container-build",
      "Packaged the catalog services for deployment with Docker as part of the release pipeline."),
    claim("claim-tenure", "Seven years of professional software engineering experience."),
    claim("claim-intake-forms",
      "Built the customer intake form flow, including client-side validation and error recovery."),
    claim("claim-cert-fundamentals",
      "Completed the Example Cloud Fundamentals certification course in 2025.", "certification"),
    claim("claim-atlas-project",
      "Built Example Atlas, a live route-planning application whose source is private, covering the web and service layers.",
      "project"),
    claim("claim-coordkit-project",
      "Maintains coord-kit, an open-source command-line tool for workflow records, published under MIT with public source.",
      "project"),
  ],
};

function claim(id, fact, type = "achievement") {
  return {
    id,
    type,
    fact,
    period: "",
    sources: [{
      path: "profile/career.md",
      fileHash: "a".repeat(64),
      lineStart: 1,
      lineEnd: 2,
      page: null,
      extraction: "markdown",
      confidence: 1,
    }],
    status: "verified",
    disclosure: "public",
    externalFact: "",
    externalSources: [],
  };
}

export const accomplishmentBank = {
  schemaVersion: "1.0",
  persona: "example",
  generatedAt: "2026-01-01T00:00:00Z",
  units: [
    unit("unit-catalog", "example-current", "Multi-source catalog pipeline", "platform", "sole_owner",
      ["claim-catalog-pipeline", "claim-catalog-latency"]),
    unit("unit-dashboard", "example-current", "Dashboard migration", "delivery", "tech_lead",
      ["claim-dashboard-migration"]),
    unit("unit-review", "example-current", "Review practice and mentoring", "leadership", "major_contributor",
      ["claim-review-practice"]),
    unit("unit-release", "example-current", "Release validation checks", "quality", "sole_owner",
      ["claim-release-checks"]),
    unit("unit-intake", "example-prior", "Customer intake forms", "delivery", "major_contributor",
      ["claim-intake-forms"]),
  ],
};

function unit(id, experienceId, title, kind, contribution, claimIds) {
  return {
    id,
    experienceId,
    title,
    externalTitle: "",
    kind,
    startDate: "2024-01",
    endDate: null,
    ongoing: true,
    contribution,
    scope: {
      surface: "catalog",
      audience: "internal teams",
      repos: [],
      partnerTeams: [],
      productionExposure: "shipped_ga",
    },
    techStack: [],
    outcomes: [],
    evidenceStrength: {
      tier: "strong",
      sourceKinds: ["pr_body"],
      artifactCount: 3,
      corroboratingSources: 2,
      limitations: [],
    },
    disclosure: "public",
    claimIds,
    supersedes: [],
  };
}

/**
 * The approved baseline. A person read these sentences and kept them.
 *
 * It is deliberately good: the point of the regression suite is that Labora
 * leaves good approved wording alone, and a deliberately weak baseline would
 * let every test pass by rewriting everything.
 */
export function approvedBaseline(overrides = {}) {
  const summarySentences = [
    "Software engineer with seven years of experience across user-facing products and backend services.",
    "Led agent-adjacent platform work from architecture through production, including the release checks that gate every deploy.",
  ];
  return ZTailoredResume.parse({
    schema_version: "3.0",
    target_role: "Senior Platform Engineer",
    ats_title: "Senior Platform Engineer",
    contact: BLANK_CONTACT,
    summary: summarySentences.join(" "),
    skills_primary: ["TypeScript", "Node.js", "CI/CD", "Testing", "Design systems"],
    skills_secondary: ["GraphQL", "Docker"],
    experience: [
      {
        id: "example-current",
        company: "Example Systems",
        role: "Software Engineer",
        period: "2022 - Present",
        location: "Remote",
        bullets: [
          "Designed and built a multi-source catalog pipeline that gathered provider data concurrently and kept producing usable results when individual sources failed.",
          "Led migration of a legacy dashboard to a typed component architecture, owning design, rollout and deprecation of the previous implementation.",
          "Built the automated release validation checks that run before every deploy, including regression evaluation of generated output.",
        ],
        progression: [],
      },
      {
        id: "example-prior",
        company: "Example Retail",
        role: "Software Engineer",
        period: "2019 - 2022",
        location: "Remote",
        bullets: [
          "Built the customer intake form flow, including client-side validation and error recovery.",
        ],
        progression: [],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    awards_or_contributions: [],
    presentation: null,
    keywords_mapped: [],
    gaps_or_risks: [],
    notes_for_human: [],
    provenance: {
      summaryClaimIds: [],
      summary: [
        summarySentence(0, summarySentences[0], ["claim-tenure"], []),
        summarySentence(1, summarySentences[1], ["claim-dashboard-migration", "claim-release-checks"], ["unit-dashboard", "unit-release"]),
      ],
      bullets: [
        { experienceId: "example-current", bulletIndex: 0, claimIds: ["claim-catalog-pipeline"] },
        { experienceId: "example-current", bulletIndex: 1, claimIds: ["claim-dashboard-migration"] },
        { experienceId: "example-current", bulletIndex: 2, claimIds: ["claim-release-checks"] },
        { experienceId: "example-prior", bulletIndex: 0, claimIds: ["claim-intake-forms"] },
      ],
      skills: [
        { skill: "TypeScript", claimIds: ["claim-dashboard-migration"] },
        { skill: "Node.js", claimIds: ["claim-catalog-pipeline"] },
        { skill: "CI/CD", claimIds: ["claim-release-checks"] },
        { skill: "Testing", claimIds: ["claim-release-checks"] },
        { skill: "Design systems", claimIds: ["claim-dashboard-migration"] },
        { skill: "GraphQL", claimIds: ["claim-catalog-pipeline"] },
        { skill: "Docker", claimIds: ["claim-container-build"] },
      ],
      headline: [],
    },
    ...overrides,
  });
}

function summarySentence(sentenceIndex, text, claimIds, unitIds) {
  return { sentenceIndex, text, clauses: [{ text, claimIds, unitIds }] };
}

/**
 * Rebuild a resume from an edited copy, keeping summary provenance consistent
 * with the sentences actually rendered. Tests that change wording without doing
 * this would trip the provenance checks for the wrong reason.
 */
export function withSummarySentences(resume, sentences, mappings) {
  return ZTailoredResume.parse({
    ...resume,
    summary: sentences.join(" "),
    provenance: {
      ...resume.provenance,
      summary: sentences.map((text, index) =>
        summarySentence(index, text, mappings[index]?.claimIds || [], mappings[index]?.unitIds || [])
      ),
    },
  });
}

export function withBullets(resume, experienceId, bullets, claimIdsPerBullet) {
  const experience = resume.experience.map((role) =>
    role.id === experienceId ? { ...role, bullets } : role
  );
  const others = resume.provenance.bullets.filter((entry) => entry.experienceId !== experienceId);
  return ZTailoredResume.parse({
    ...resume,
    experience,
    provenance: {
      ...resume.provenance,
      bullets: [
        ...others,
        ...bullets.map((_, index) => ({
          experienceId,
          bulletIndex: index,
          claimIds: claimIdsPerBullet[index] || [],
        })),
      ],
    },
  });
}

export const jobSpec = {
  schemaVersion: "1.0",
  title: "Senior Platform Engineer",
  company: "Example Industries",
  sourcePath: "job.md",
  aliasVersion: "2026-07-28",
  requirements: [
    requirement("req-typescript", "skill", "Strong TypeScript across service and web layers", ["typescript"]),
    requirement("req-docker", "skill", "Containerized deployment with Docker", ["docker"]),
    requirement("req-python", "skill", "Python for tooling and automation", []),
    requirement("req-realtime", "responsibility", "Build real-time data paths at scale", []),
    requirement("req-testing", "skill", "Automated testing and continuous integration", ["testing", "ci-cd"]),
  ],
  nonRequirements: [],
};

function requirement(id, kind, text, canonicalTerms) {
  return {
    id,
    kind,
    priority: "required",
    severity: "core",
    text,
    sourceLine: 1,
    canonicalTerms,
    surfaceForms: [],
    matchMode: "threshold",
    minimumYears: null,
  };
}

export const emptyPlan = {
  schemaVersion: "1.0",
  baselineHash: null,
  baselinePath: "resume-approved.json",
  documentMission: "Present an experienced platform engineer for a platform role",
  operations: [],
  additions: [],
  notesForHuman: [],
};

export function keepAll(baselineView, { baselineApproved = true } = {}) {
  return baselineView.segments.map((segment) => ({
    location: segment.location,
    operation: "keep",
    originalText: segment.text,
    proposedText: "",
    destination: "",
    additionalSources: [],
    products: [],
    reason: "",
    semanticDelta: "none",
    claimIds: [],
    unitIds: [],
    affects: [],
    requiresReapproval: baselineApproved ? false : false,
  }));
}
