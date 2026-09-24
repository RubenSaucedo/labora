import { canonicalSkillsInText } from "./skill-aliases.js";
import { segmentResume, significantTokens } from "./resume-segments.js";

/**
 * Section missions.
 *
 * Every section of a resume answers a different question for a different reader
 * behaviour. A statement can be perfectly true, perfectly supported, and still
 * be an editorial defect because it is sitting in the section whose job it does
 * not do. That case had nowhere to be reported: claim validation says
 * "supported", the style checks say "well formed", and the document is worse.
 *
 * The missions are shared rather than restated inside each section's prompt, so
 * that "where does this belong" is answered the same way by the summary rule in
 * #105, the skills rule in #109 and the projects rule in #110.
 */
export const SECTION_MISSIONS = Object.freeze({
  headline: {
    mission: "Name the professional scope the candidate wants to be interviewed on.",
    proves: ["positioning", "specialization"],
    admits: ["role", "domain", "capability"],
    excludes: ["internal team names", "internal role labels", "implementation protocols"],
  },
  summary: {
    mission:
      "Interpret the career: identity, level, current scope, and what differentiates this " +
      "candidate. It is the reader's high-level reading of everything below it.",
    proves: ["identity", "level", "scope", "differentiation"],
    admits: ["professional shape", "lifecycle ownership", "system scope", "one memorable artifact"],
    excludes: ["mechanism inventories", "technology lists", "retrieval keywords carried elsewhere"],
  },
  experience: {
    mission: "Prove scope, ownership, judgment, and consequence.",
    proves: ["scope", "ownership", "judgment", "consequence"],
    admits: ["systems", "decisions", "mechanisms", "measured outcomes", "lifecycle responsibility"],
    excludes: ["capability adjectives without an object", "responsibility descriptions"],
  },
  skills: {
    mission: "Be a compact, supported retrieval index of relevant technical vocabulary.",
    proves: ["retrievability", "vocabulary accuracy"],
    admits: ["languages", "frameworks", "platforms", "recognised technical capabilities"],
    excludes: ["behavioural traits", "narrative", "proficiency ratings", "unsupported posting terms"],
  },
  projects: {
    mission: "Provide distinct, externally inspectable implementation proof.",
    proves: ["independent ownership", "inspectability", "capability not visible in confidential work"],
    admits: ["what the artifact enables", "differentiating engineering decisions", "status labels"],
    excludes: ["stack inventories before the object", "adoption or release claims without evidence"],
  },
  education: {
    mission: "Carry formal learning.",
    proves: ["formal qualification"],
    admits: ["degree", "institution", "dates"],
    excludes: ["production capability claims"],
  },
  certifications: {
    mission: "Carry formally learned and credentialed capability.",
    proves: ["credentialed learning"],
    admits: ["credential", "issuer", "verification link"],
    excludes: ["implied production experience"],
  },
  awards: {
    mission: "Carry external recognition.",
    proves: ["recognition"],
    admits: ["award", "issuer", "year"],
    excludes: ["self-assessed distinction"],
  },
});

export function sectionMission(section) {
  return SECTION_MISSIONS[section] || null;
}

/**
 * Traits that are not technical vocabulary. #109 rejects these from Technical
 * Skills because they cannot be retrieved against and cannot be proved by being
 * asserted. The evidence for them belongs in Experience, where it has an object.
 */
export const NON_TECHNICAL_TRAITS = [
  "teamwork", "leadership", "communication", "problem solving", "problem-solving",
  "collaboration", "adaptability", "work ethic", "attention to detail", "time management",
  "critical thinking", "creativity", "self-starter", "team player",
];

/**
 * Umbrella words that name a discipline rather than a capability. They survive
 * only when narrowed to something a reader can picture.
 */
export const GENERIC_UMBRELLA_TERMS = [
  "cloud", "scalability", "architecture", "api work", "software development",
  "programming", "engineering", "best practices", "agile", "full stack", "full-stack",
];

export const PROFICIENCY_MARKERS = /\b(?:expert|advanced|intermediate|beginner|proficient|\d{1,3}\s*%|\u2605|\u2606|\*{3,})\b/i;

/**
 * Words that assert something about *scale, seniority, adoption or timing* and
 * therefore need their own evidence. They are grouped because they share one
 * failure mode: a posting uses them, they sound like table stakes, and they
 * arrive in a resume as vocabulary rather than as a claim.
 */
export const UNSUPPORTABLE_BORROW_CLASSES = Object.freeze({
  seniority: [
    "senior", "staff", "principal", "lead engineer", "tech lead", "head of", "director",
    "architect", "manager",
  ],
  scale: [
    "at scale", "production-scale", "production scale", "enterprise-wide", "organization-wide",
    "organisation-wide", "company-wide", "global", "high-traffic", "high traffic", "mission-critical",
    "millions of", "billions of",
  ],
  adoption: [
    "widely adopted", "widely used", "industry standard", "thousands of users", "millions of users",
    "downloads", "installs", "adopted by",
  ],
  realtime: ["real-time", "real time", "realtime", "streaming", "sub-second", "low-latency", "low latency"],
});

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function claimCorpus(claimLedger) {
  return (claimLedger?.claims || [])
    .filter((claim) => claim.status === "verified")
    .map((claim) => `${claim.fact} ${claim.externalFact || ""}`)
    .join(" \n ")
    .toLowerCase();
}

function jobCorpus(jobSpec) {
  return (jobSpec?.requirements || []).map((entry) => entry.text).join(" \n ").toLowerCase();
}

/**
 * Terms that carry a career-level interpretation rather than a mechanism. A
 * summary is allowed -- required, really -- to name these, because they are the
 * interpretation. #105's rule is about *mechanisms* crowding them out.
 */
const IDENTITY_TERMS = [
  "engineer", "developer", "architect", "years", "experience", "led", "owned", "built",
  "designed", "production", "lifecycle", "end-to-end", "platform", "product", "team", "teams",
];

function mechanismMentions(text) {
  return [...new Set(canonicalSkillsInText(text).map((match) => match.canonicalId))];
}

/**
 * The #105 altitude rule, in the one form that can be checked deterministically.
 *
 * A summary sentence that names several concrete mechanisms and almost nothing
 * about professional identity is a Technical Skills section that wandered
 * upstairs. The threshold is deliberately generous: three or more distinct
 * mechanisms *and* no identity vocabulary. Two technologies inside a sentence
 * about what someone led is ordinary good writing, and flagging it would train
 * people to ignore this.
 */
export function summaryAltitudeIssues({ resume, baselineView = null }) {
  const issues = [];
  const segments = segmentResume(resume).filter((entry) => entry.section === "summary");
  const baselineSummary = new Map(
    (baselineView?.segments || [])
      .filter((entry) => entry.section === "summary")
      .map((entry) => [entry.location, entry])
  );

  for (const sentence of segments) {
    const mechanisms = mechanismMentions(sentence.text);
    const tokens = new Set(significantTokens(sentence.text));
    const identitySignals = IDENTITY_TERMS.filter((term) => tokens.has(term));

    if (mechanisms.length >= 3 && identitySignals.length === 0) {
      issues.push({
        severity: "warning",
        code: "summary_mechanism_inventory",
        location: sentence.location,
        message:
          `${sentence.location} names ${mechanisms.length} mechanisms (${mechanisms.join(", ")}) without ` +
          "saying what kind of engineer this is or what they were trusted to own. That is a Technical " +
          "Skills section occupying Summary space.",
        route: "move",
        suggestedDestinations: ["skills", "experience"],
      });
    }

    // Qualifier stacking: the repair that narrows an ambiguous term instead of
    // asking whether the term belongs at this altitude at all.
    const before = baselineSummary.get(sentence.location);
    if (before && before.hash !== sentence.hash) {
      const beforeTokens = significantTokens(before.text);
      const afterTokens = significantTokens(sentence.text);
      const kept = beforeTokens.every((token) => afterTokens.includes(token));
      const added = afterTokens.filter((token) => !beforeTokens.includes(token));
      if (kept && added.length > 0 && added.length <= 3 && mechanisms.length > 0) {
        issues.push({
          severity: "warning",
          code: "summary_qualifier_stacked_on_ambiguous_term",
          location: sentence.location,
          message:
            `${sentence.location} kept every word of the approved sentence and added ` +
            `${added.map((token) => `"${token}"`).join(", ")}. Qualifying an ambiguous term leaves it at the ` +
            "wrong altitude; decide first whether the term belongs in Summary at all.",
          route: "move",
          suggestedDestinations: ["experience", "skills"],
        });
      }
    }
  }
  return issues;
}

/**
 * The #105/#123 placement rule: do not spend Summary space duplicating a term
 * the document already carries accurately somewhere a reader would look for it.
 *
 * The check is narrow on purpose. It fires only when the term is a *mechanism*
 * (a canonical technology), is already present in Skills or Experience, and was
 * not in the approved summary. Repeating a central technology on purpose is
 * legitimate; silently importing posting vocabulary for coverage is not, and
 * the difference is visible in whether the baseline author chose to put it there.
 */
export function keywordPlacementIssues({ resume, jobSpec, baselineView = null }) {
  const issues = [];
  const segments = segmentResume(resume);
  const summary = segments.filter((entry) => entry.section === "summary");
  const elsewhere = segments.filter((entry) => ["skills", "experience", "projects"].includes(entry.section));

  const carriedElsewhere = new Map();
  for (const entry of elsewhere) {
    for (const skill of mechanismMentions(entry.text)) {
      if (!carriedElsewhere.has(skill)) carriedElsewhere.set(skill, entry.location);
    }
  }

  const postingTerms = new Set(
    (jobSpec?.requirements || []).flatMap((requirement) =>
      requirement.canonicalTerms?.length
        ? requirement.canonicalTerms
        : mechanismMentions(requirement.text)
    )
  );

  const baselineSummaryTerms = new Set(
    (baselineView?.segments || [])
      .filter((entry) => entry.section === "summary")
      .flatMap((entry) => mechanismMentions(entry.text))
  );

  for (const sentence of summary) {
    for (const term of mechanismMentions(sentence.text)) {
      if (!postingTerms.has(term)) continue;
      if (!carriedElsewhere.has(term)) continue;
      if (baselineView && baselineSummaryTerms.has(term)) continue;

      issues.push({
        severity: "warning",
        code: "keyword_placement_regression",
        location: sentence.location,
        message:
          `"${term}" appears in the posting and is already carried accurately at ` +
          `${carriedElsewhere.get(term)}. Adding it to ${sentence.location} buys retrieval coverage the ` +
          "document already has, and spends a Summary sentence on it.",
        route: "delete",
        suggestedDestinations: [carriedElsewhere.get(term)],
      });
    }
  }
  return issues;
}

/**
 * Vocabulary borrowed from a posting that the ledger does not support.
 *
 * This is an evidence boundary, not an editorial preference, so it is an error.
 * The specific trap is that seniority, scale, adoption and timing words read as
 * generic resume register rather than as claims -- "real-time", "at scale",
 * "widely adopted" -- and so they get copied across from a posting without ever
 * being treated as something that needs a source.
 *
 * Only prose is inspected. Whether a *listed skill* is supported is already
 * decided by `validate-resume-claims`, which compares the display term against
 * the facts of the claims it maps to, and by the skills plan's own
 * `skill_without_evidence`. Re-deciding it here with a cruder test would double
 * gate the same question and disagree with the better answer.
 */
export function borrowedTermIssues({ resume, jobSpec, claimLedger, baselineView = null }) {
  const issues = [];
  const posting = jobCorpus(jobSpec);
  if (!posting) return issues;

  const evidence = claimCorpus(claimLedger);
  const baselineText = normalize(
    (baselineView?.segments || []).map((entry) => entry.text).join(" \n ")
  );

  // Canonical IDs, compared against canonical IDs. Comparing an ID such as
  // `ci-cd` against raw posting prose would never match the surface form
  // "CI/CD" the posting actually uses, and the check would silently pass
  // everything -- the worst outcome for a gate that guards an evidence boundary.
  const postingSkills = new Set(mechanismMentions(posting));
  const evidenceSkills = new Set(mechanismMentions(evidence));
  const baselineSkills = new Set(mechanismMentions(baselineText));

  const prose = segmentResume(resume).filter((segment) =>
    ["headline", "summary", "experience", "projects"].includes(segment.section)
  );

  for (const segment of prose) {
    const haystack = normalize(segment.text);

    for (const [className, terms] of Object.entries(UNSUPPORTABLE_BORROW_CLASSES)) {
      for (const term of terms) {
        if (!haystack.includes(term)) continue;
        if (!posting.includes(term)) continue;
        if (evidence.includes(term)) continue;
        // Present in the approved baseline is not the same as supported, but it
        // is a different finding: the operator put it there, and claim
        // validation reports it on its own terms.
        if (baselineView && baselineText.includes(term)) continue;

        issues.push({
          severity: "error",
          code: "unsupported_posting_term_added",
          location: segment.location,
          message:
            `${segment.location} asserts "${term}" (${className}). The posting uses the term and the ` +
            "current claim ledger does not support it, so it arrived as vocabulary rather than as evidence.",
          route: "delete",
        });
      }
    }

    // Unsupported mechanisms borrowed wholesale, e.g. a language the posting
    // names and the profile does not carry.
    for (const skill of mechanismMentions(segment.text)) {
      if (!postingSkills.has(skill)) continue;
      if (evidenceSkills.has(skill)) continue;
      if (baselineView && baselineSkills.has(skill)) continue;
      issues.push({
        severity: "error",
        code: "unsupported_posting_term_added",
        location: segment.location,
        message:
          `${segment.location} lists "${skill}", which the posting requires and no verified claim ` +
          "supports. This says nothing about whether the candidate knows it; it says the corpus is silent.",
        route: "delete",
      });
    }
  }
  return issues;
}

/**
 * Section-mission violations that can be decided from the text alone.
 */
export function sectionMissionIssues({ resume }) {
  const issues = [];

  for (const [field, tier] of [["skills_primary", "primary"], ["skills_secondary", "secondary"]]) {
    (resume?.[field] || []).forEach((display, index) => {
      const location = `skills.${tier}[${index}]`;
      const value = normalize(display);
      if (NON_TECHNICAL_TRAITS.includes(value)) {
        issues.push({
          severity: "warning",
          code: "soft_skill_without_proof",
          location,
          message:
            `"${display}" is a behavioural trait, not retrievable technical vocabulary. ` +
            `${SECTION_MISSIONS.skills.mission} Its evidence belongs in Experience, where it has an object.`,
          route: "move",
          suggestedDestinations: ["experience"],
        });
      }
      if (GENERIC_UMBRELLA_TERMS.includes(value)) {
        issues.push({
          severity: "warning",
          code: "skill_term_too_generic",
          location,
          message: `"${display}" names a discipline rather than a capability a reader can picture or search for.`,
          route: "make_specific",
        });
      }
      if (PROFICIENCY_MARKERS.test(display)) {
        issues.push({
          severity: "warning",
          code: "proficiency_scale_undefined",
          location,
          message: `"${display}" asserts a proficiency level with no shared basis for what the level means.`,
          route: "rewrite",
        });
      }
    });
  }

  (resume?.projects || []).forEach((project, index) => {
    const description = String(project.description || "");
    if (!description) return;
    const location = `projects[${index}].description`;
    // "Built with X, Y, Z" leads with the stack. A reader cannot tell what the
    // artifact does, which is the only thing that makes the stack interesting.
    const leadsWithStack = /^\s*(?:built|made|created|developed)\s+(?:with|using|in)\b/i.test(description);
    const openingMechanisms = mechanismMentions(description.split(/[.;]/)[0] || "");
    if (leadsWithStack || openingMechanisms.length >= 3) {
      issues.push({
        severity: "warning",
        code: "project_stack_without_object",
        location,
        message:
          `${location} opens with technologies before saying what the project lets a user or developer do. ` +
          `${SECTION_MISSIONS.projects.mission}`,
        route: "rewrite",
      });
    }
  });

  return issues;
}

export function evaluateSectionMissions({ resume, jobSpec = null, claimLedger = null, baselineView = null }) {
  const issues = [
    ...summaryAltitudeIssues({ resume, baselineView }),
    ...keywordPlacementIssues({ resume, jobSpec, baselineView }),
    ...borrowedTermIssues({ resume, jobSpec, claimLedger, baselineView }),
    ...sectionMissionIssues({ resume }),
  ];
  const errors = issues.filter((entry) => entry.severity === "error");
  return {
    schemaVersion: "1.0",
    valid: errors.length === 0,
    issues: errors,
    warnings: issues.filter((entry) => entry.severity !== "error"),
  };
}
