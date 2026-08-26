import { authorizationSentences, extractJobRequirements, significantRequirementTokens } from "./job-requirements.js";
import { SKILL_ALIASES, containsSurfaceForm } from "./skill-aliases.js";
import { clearanceMatched } from "./eligibility.js";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function resumeSearchableText(resume) {
  return normalize([
    resume?.target_role,
    resume?.ats_title,
    resume?.summary,
    ...(resume?.skills_primary || []),
    ...(resume?.skills_secondary || []),
    ...(resume?.experience || []).flatMap((entry) => [
      entry?.company,
      entry?.role,
      entry?.period,
      ...(entry?.bullets || []),
    ]),
    ...(resume?.education || []).flatMap((entry) => [
      entry?.school,
      entry?.degree,
      entry?.field,
    ]),
    ...(resume?.projects || []).flatMap((entry) => [
      entry?.name,
      entry?.description,
      ...(entry?.highlights || []),
    ]),
    ...(resume?.certifications || []).flatMap((entry) =>
      typeof entry === "string" ? [entry] : [entry?.name, entry?.issuer, entry?.year]
    ),
    ...(resume?.awards_or_contributions || []).flatMap((entry) =>
      typeof entry === "string" ? [entry] : [entry?.title, entry?.description]
    ),
  ].filter(Boolean).join("\n"));
}

function canonicalTermMatched(resumeText, canonicalId) {
  const aliases = SKILL_ALIASES[canonicalId] || [canonicalId];
  return aliases.some((surface) => containsSurfaceForm(resumeText, surface));
}

function candidateYears(resume, canonicalTerms = []) {
  const intervals = [];
  for (const entry of resume?.experience || []) {
    const entryText = normalize([
      entry?.role,
      entry?.company,
      ...(entry?.bullets || []),
    ].join(" "));
    if (
      canonicalTerms.length &&
      !canonicalTerms.some((term) => canonicalTermMatched(entryText, term))
    ) {
      continue;
    }
    const years = String(entry?.period || "").match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
    const start = years[0];
    const end = /present|current/i.test(entry?.period || "")
      ? new Date().getFullYear()
      : years[1];
    if (start && end && end >= start) intervals.push([start, end]);
  }

  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }
  return merged.reduce((total, [start, end]) => total + (end - start), 0);
}

// The jurisdiction must come from the sentence that states the gate, not from
// the whole line and not from any sentence that merely mentions the subject. A
// scraped line runs the gate together with a legal footer or an unrelated offer
// naming a different country -- "must be authorized to work in Canada. Visa
// sponsorship is available for positions in the United States." -- and reading
// either of those wider scopes matched a US-authorized resume against a
// Canadian gate, a false pass on the one requirement no resume can talk its way
// past.
function authorizationJurisdiction(text) {
  const stating = authorizationSentences(text);
  const scope = stating.length > 0 ? stating.join(" ") : text;
  if (/\b(?:united states|u\.?s\.?a?)\b/i.test(scope)) return "us";
  if (/\bcanada|canadian\b/i.test(scope)) return "canada";
  if (/\b(?:united kingdom|u\.?k\.?|britain|british)\b/i.test(scope)) return "uk";
  if (/\b(?:european union|e\.?u\.?)\b/i.test(scope)) return "eu";
  return null;
}

function authorizationMatched(requirementText, resumeText) {
  if (/\b(?:not authorized|not eligible|requires? sponsorship|need sponsorship|cannot work)\b/i.test(resumeText)) {
    return false;
  }
  const jurisdiction = authorizationJurisdiction(requirementText);
  const patterns = {
    us: /\b(?:authorized to work in (?:the )?(?:united states|u\.?s\.?a?)|u\.?s\.? citizen|united states citizen|green card holder|permanent resident of (?:the )?(?:united states|u\.?s\.?a?))\b/i,
    canada: /\b(?:authorized to work in canada|canadian citizen|permanent resident of canada)\b/i,
    uk: /\b(?:right to work in (?:the )?(?:united kingdom|u\.?k\.?)|british citizen)\b/i,
    eu: /\b(?:authorized to work in (?:the )?(?:european union|e\.?u\.?)|e\.?u\.? citizen)\b/i,
  };
  if (jurisdiction) return patterns[jurisdiction].test(resumeText);
  return /\b(?:authorized to work|work authorization|right to work|citizen|permanent resident)\b/i.test(resumeText);
}

function degreeMatched(requirementText, resume) {
  const educationText = normalize((resume?.education || []).flatMap((entry) => [
    entry?.degree,
    entry?.field,
  ]).join(" "));

  let levelPattern = /\b(?:bachelor|master|phd|doctorate|b\.?s\.?|m\.?s\.?)\b/i;
  if (/\b(?:master|m\.?s\.?)\b/i.test(requirementText)) {
    levelPattern = /\b(?:master|m\.?s\.?)\b/i;
  } else if (/\b(?:phd|doctorate)\b/i.test(requirementText)) {
    levelPattern = /\b(?:phd|doctorate)\b/i;
  } else if (/\b(?:bachelor|b\.?s\.?)\b/i.test(requirementText)) {
    levelPattern = /\b(?:bachelor|b\.?s\.?)\b/i;
  }
  if (!levelPattern.test(educationText)) return false;

  const disciplines = [
    "computer science",
    "software engineering",
    "computer engineering",
    "electrical engineering",
    "information systems",
    "data science",
    "mathematics",
  ].filter((discipline) => normalize(requirementText).includes(discipline));
  if (!disciplines.length) return true;
  if (disciplines.some((discipline) => educationText.includes(discipline))) return true;

  if (/\brelated (?:technical )?field\b/i.test(requirementText)) {
    return /\b(?:computer|software|electrical|information|data|mathematics|engineering)\b/i.test(educationText);
  }
  return false;
}

function licenseMatched(requirementText, resumeText) {
  const normalizedRequirement = normalize(requirementText);
  const explicitPhrases = [
    "bar admission",
    "medical license",
    "driver's license",
    "drivers license",
    "professional engineer license",
    "registered nurse license",
  ].filter((phrase) => normalizedRequirement.includes(phrase));
  if (explicitPhrases.some((phrase) => containsSurfaceForm(resumeText, phrase))) return true;

  const acronyms = [...new Set(requirementText.match(/\b[A-Z][A-Z0-9.-]{1,9}\b/g) || [])]
    .filter((token) => !["US", "USA"].includes(token));
  if (!acronyms.length) return false;
  return acronyms.every((token) => containsSurfaceForm(resumeText, token)) &&
    /\b(?:licensed|license|certified|certification|credential)\b/i.test(resumeText);
}

function requirementMatch(requirement, resumeText, resume) {
  if (requirement.kind === "years" && requirement.minimumYears != null) {
    const conceptResults = requirement.canonicalTerms.map((term) => {
      const years = candidateYears(resume, [term]);
      return {
        term,
        years,
        matched: years != null && years >= requirement.minimumYears,
      };
    });
    const generalYears = conceptResults.length ? null : candidateYears(resume);
    const matched = conceptResults.length
      ? (
          requirement.matchMode === "any"
            ? conceptResults.some((result) => result.matched)
            : conceptResults.every((result) => result.matched)
        )
      : generalYears != null && generalYears >= requirement.minimumYears;
    return {
      matched,
      matchedSignals: [
        ...(generalYears == null ? [] : [`${generalYears} years evidenced`]),
        ...conceptResults
          .filter((result) => result.years != null)
          .map((result) => `${result.term}: ${result.years} years evidenced`),
      ],
    };
  }

  if (requirement.kind === "authorization") {
    const authorized = authorizationMatched(requirement.text, resumeText);
    return {
      matched: authorized,
      matchedSignals: authorized ? ["explicit work authorization"] : [],
    };
  }

  if (requirement.kind === "degree") {
    const hasDegree = degreeMatched(requirement.text, resume);
    return { matched: hasDegree, matchedSignals: hasDegree ? ["degree"] : [] };
  }

  if (requirement.kind === "clearance") {
    const matched = clearanceMatched(requirement.text, resumeText);
    return { matched, matchedSignals: matched ? ["explicit clearance credential"] : [] };
  }

  if (requirement.kind === "license") {
    const matched = licenseMatched(requirement.text, resumeText);
    return { matched, matchedSignals: matched ? ["explicit license credential"] : [] };
  }

  if (requirement.canonicalTerms.length) {
    const results = requirement.canonicalTerms.map((term) => ({
      term,
      matched: canonicalTermMatched(resumeText, term),
    }));
    const matched = requirement.matchMode === "any"
      ? results.some((result) => result.matched)
      : results.every((result) => result.matched);
    return {
      matched,
      matchedSignals: results.filter((result) => result.matched).map((result) => result.term),
    };
  }

  // No deterministic matcher applies. Everything above resolves a requirement
  // against something checkable -- a categorical kind, or canonical terms the
  // extractor recognised. What is left is prose the scorer cannot adjudicate:
  //
  //   "You think in systems. You naturally build reusable abstractions,
  //    composable components, and clean APIs rather than one-off solutions."
  //
  // This used to fall through to literal token overlap against the whole
  // paragraph, needing 60% of its words to appear in the resume. A real run
  // scored 25% coverage with five core requirements "missing" while the claims
  // satisfying four of them were rendered and present in `provenance`, and the
  // engineer judge -- reading the same document semantically -- returned
  // advance_to_onsite at 82.
  //
  // The measurement was not merely noisy, it was pointed the wrong way. The
  // only way to move it is to parrot the posting's sentences, which is the
  // keyword stuffing the truth rules exist to prevent. So the scorer now
  // declines to answer instead of answering wrongly, and says which requirement
  // it declined on. Deciding these needs a semantic read; that is the judges'
  // job, not a token counter's.
  //
  // Checkability is defined by matcher capability, deliberately not by
  // detecting "prose". A style detector would be another unbounded vocabulary
  // list, and this file has already lost that argument three times: "You must
  // have Kubernetes experience" is second-person and perfectly checkable, while
  // "Exceptional systems thinker" is short and not checkable at all.
  const tokens = significantRequirementTokens(requirement.text);
  const matchedTokens = tokens.filter((token) => containsSurfaceForm(resumeText, token));
  return {
    matched: false,
    checkable: false,
    matchedSignals: matchedTokens,
  };
}

// `null`, never 100. An empty denominator means nothing was measured, and
// reporting that as a perfect score is exactly the invisible-improvement
// failure this scorer is being fixed for.
function percentage(matched, total) {
  return total === 0 ? null : Math.round((matched / total) * 100);
}

function lexicalCoverageItems(evaluations, jobTitle, resumeText) {
  const itemsByTerm = new Map();

  function addItem(term, source, matcher) {
    const existing = itemsByTerm.get(term);
    if (existing) {
      existing.sources.push(source);
      if (matcher === "canonical") existing.matcher = matcher;
      return;
    }
    itemsByTerm.set(term, { term, matcher, sources: [source] });
  }

  for (const evaluation of evaluations.filter((item) => item.checkable)) {
    for (const term of evaluation.requirement.canonicalTerms) {
      addItem(term, {
        type: "canonical_requirement",
        requirement_id: evaluation.requirement.id,
      }, "canonical");
    }
  }

  for (const term of significantRequirementTokens(jobTitle)) {
    addItem(term, { type: "job_title", requirement_id: null }, "surface");
  }

  return [...itemsByTerm.values()].map(({ term, matcher, sources }) => ({
    term,
    matched: matcher === "canonical"
      ? canonicalTermMatched(resumeText, term)
      : containsSurfaceForm(resumeText, term),
    sources,
  }));
}

function formatRisks(resume) {
  const risks = [];
  if (!resume?.summary || resume.summary.trim().length < 80) {
    risks.push("Summary is shorter than the recommended two concise sentences.");
  }
  if ((resume?.skills_primary || []).length < 6) {
    risks.push("Primary skills list has fewer than six truthful job-relevant skills.");
  }
  for (const entry of resume?.experience || []) {
    if ((entry?.bullets || []).length < 2) {
      risks.push(`Role "${entry?.role || "Unknown"}" at "${entry?.company || "Unknown"}" has fewer than two bullets.`);
    }
  }
  return risks;
}

export function scoreAts({ resume, job, jobSpec }) {
  const resumeText = resumeSearchableText(resume);
  const spec = jobSpec || extractJobRequirements({
    ...job,
    description: job?.raw || job?.description || "",
    sourcePath: "",
  });
  const evaluations = spec.requirements.map((requirement) => {
    const result = requirementMatch(requirement, resumeText, resume);
    const checkable = result.checkable !== false;
    return {
      requirement,
      ...result,
      checkable,
      assessment: !checkable
        ? "semantic_review_required"
        : result.matched
          ? "matched"
          : "unmatched",
    };
  });

  const required = evaluations.filter((evaluation) => evaluation.requirement.priority === "required");
  const preferred = evaluations.filter((evaluation) => evaluation.requirement.priority === "preferred");
  const responsibilities = evaluations.filter((evaluation) => evaluation.requirement.priority === "responsibility");
  const checkableOf = (group) => group.filter((evaluation) => evaluation.checkable);
  const semanticReview = evaluations.filter((evaluation) => !evaluation.checkable);

  const lexicalItems = lexicalCoverageItems(evaluations, job?.title || "", resumeText);
  const matchedTerms = lexicalItems.filter((item) => item.matched).map((item) => item.term);
  const missingTerms = lexicalItems.filter((item) => !item.matched).map((item) => item.term);

  const requiredCheckable = checkableOf(required);
  const requiredMatched = requiredCheckable.filter((evaluation) => evaluation.matched).length;
  const preferredMatched = checkableOf(preferred).filter((evaluation) => evaluation.matched).length;
  const responsibilityMatched = checkableOf(responsibilities)
    .filter((evaluation) => evaluation.matched).length;

  // Only a requirement the scorer could actually check may be reported missing.
  // A requirement it declined to adjudicate is `unknown`, and unknown is not a
  // deficit -- reporting it as one is what made a strong application read as a
  // 25% match.
  const mustHaveMissing = requiredCheckable
    .filter((evaluation) => !evaluation.matched)
    .map((evaluation) => evaluation.requirement.text);
  const missingBySeverity = Object.fromEntries(
    ["hard_eligibility", "core", "preferred", "soft_signal"].map((severity) => [
      severity,
      evaluations
        .filter((evaluation) =>
          evaluation.requirement.severity === severity
          && evaluation.checkable
          && !evaluation.matched
        )
        .map((evaluation) => evaluation.requirement.text),
    ])
  );

  const requirementCoverage = percentage(requiredMatched, requiredCheckable.length);
  const lexicalCoverage = percentage(matchedTerms.length, lexicalItems.length);
  const preferredCoverage = percentage(preferredMatched, checkableOf(preferred).length);
  const responsibilityCoverage = percentage(
    responsibilityMatched,
    checkableOf(responsibilities).length
  );

  const actions = [];
  if (missingBySeverity.hard_eligibility.length) {
    actions.push(
      `Confirm hard eligibility before applying: ${missingBySeverity.hard_eligibility.join("; ")}.`
    );
  }
  if (missingBySeverity.core.length) {
    actions.push(
      `Surface truthful evidence for core signals: ${missingBySeverity.core.slice(0, 5).join("; ")}.`
    );
  }
  if (semanticReview.length) {
    actions.push(
      `${semanticReview.length} requirement(s) cannot be settled by keyword matching and need a semantic read of the document: ${semanticReview.slice(0, 3).map((evaluation) => evaluation.requirement.text.slice(0, 60)).join("; ")}.`
    );
  }
  if (lexicalCoverage != null && lexicalCoverage < 65) {
    actions.push("Mirror supported job language naturally in the summary, skills, and experience bullets.");
  }
  if (!actions.length) {
    actions.push("Preserve the current truthful requirement coverage and focus on clarity and impact.");
  }

  return {
    metric_version: "4.0",
    // What was actually measured, always visible alongside the percentage. A
    // coverage figure whose denominator is not reported can be improved by
    // shrinking the denominator, which is the failure mode this fix would
    // otherwise introduce.
    required_assessment: {
      total_count: required.length,
      checkable_count: requiredCheckable.length,
      matched_count: requiredMatched,
      unmatched_count: requiredCheckable.length - requiredMatched,
      semantic_review_count: required.length - requiredCheckable.length,
      checkable_match_percent: requirementCoverage,
    },
    // Requirements the deterministic scorer declined to adjudicate. These are
    // not missing and must not be reported as gaps -- they are handed to the
    // judges, which read the rendered document rather than counting tokens.
    semantic_review_required: semanticReview.map((evaluation) => ({
      id: evaluation.requirement.id,
      priority: evaluation.requirement.priority,
      severity: evaluation.requirement.severity,
      text: evaluation.requirement.text,
      reason: "no_deterministic_matcher",
      partial_signals: evaluation.matchedSignals,
    })),
    lexical_assessment: {
      advisory: true,
      denominator_count: lexicalItems.length,
      matched_count: matchedTerms.length,
      missing_count: missingTerms.length,
      denominator_requirement_ids: [...new Set(lexicalItems.flatMap((item) =>
        item.sources.map((source) => source.requirement_id).filter(Boolean)
      ))],
      excluded_semantic_review_requirement_ids: semanticReview.map(
        (evaluation) => evaluation.requirement.id
      ),
      terms: lexicalItems,
    },
    coverage_percent: lexicalCoverage,
    lexical_coverage_percent: lexicalCoverage,
    requirement_coverage_percent: requirementCoverage,
    preferred_coverage_percent: preferredCoverage,
    responsibility_coverage_percent: responsibilityCoverage,
    matched_keywords: matchedTerms.slice(0, 80),
    missing_keywords: missingTerms.slice(0, 80),
    must_have_missing: mustHaveMissing,
    hard_eligibility_missing: missingBySeverity.hard_eligibility,
    core_requirements_missing: missingBySeverity.core,
    soft_signals_missing: missingBySeverity.soft_signal,
    preferred_requirements_missing: missingBySeverity.preferred,
    requirements: evaluations.map((evaluation) => ({
      id: evaluation.requirement.id,
      priority: evaluation.requirement.priority,
      severity: evaluation.requirement.severity,
      kind: evaluation.requirement.kind,
      text: evaluation.requirement.text,
      matched: evaluation.matched,
      checkable: evaluation.checkable,
      assessment: evaluation.assessment,
      matched_signals: evaluation.matchedSignals,
    })),
    format_risks: formatRisks(resume),
    recommendations: actions,
    ats_feedback: {
      missing_keywords_top: missingTerms.slice(0, 12),
      must_have_missing: mustHaveMissing,
      hard_eligibility_missing: missingBySeverity.hard_eligibility,
      core_requirements_missing: missingBySeverity.core,
      actions,
    },
  };
}
