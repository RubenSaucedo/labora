import { UNKNOWN_MODEL } from "./copilot-settings.js";
import { dedupeFindings, makeFinding, sortFindings, summarizeFindings } from "./findings.js";

/**
 * The release gate reports; it does not decide.
 *
 * Two states are reachable from here, and only two:
 *
 * - `generation_failed` -- the requested artifact does not exist. That is not a
 *   veto, it is a truthful statement that there is nothing to review yet.
 * - `review_ready` -- an artifact exists, and here is everything Labora
 *   established and failed to establish about it.
 *
 * `operator_approved` is deliberately unreachable from this function. It lives
 * in a separate file that this code never writes, so "Labora must never infer
 * the operator's decision" is a property of the structure rather than a rule
 * someone has to remember.
 *
 * `draft` and `needs_input` belong to the stages before rendering. By the time
 * this gate runs, an artifact was requested.
 */

const ASK = "Ask the operator for corroborating evidence";
const RETRIEVE = "Retrieve an approved source";
const NARROW = "Use narrower wording";
const OMIT = "Remove the statement";
const ACCEPT = "Accept the finding and continue";
const REBUILD = "Rebuild the stale stage, then re-run this gate";
const RERUN = "Re-run the stage so its diagnostics describe this artifact";

function claimFindings(claimValidation) {
  const issues = claimValidation?.issues || [];
  return issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => {
      // A stale derived record is workflow debt: the statement may be perfectly
      // well supported, but the ledger describing it was built from a file that
      // has since changed. That is `uncertain`, not `unsupported` -- calling it
      // unsupported would report a bookkeeping lag as a fact about the person.
      const stale = issue.class === "stale_derived_record";
      const status = stale ? "uncertain" : (issue.severity === "error" ? "unsupported" : "uncertain");
      return makeFinding({
        source: "claims",
        code: issue.code,
        status,
        finding: issue.message,
        location: issue.location || "",
        basis: issue.location ? [issue.location] : [],
        suggestedActions: stale ? [REBUILD, ACCEPT] : [ASK, RETRIEVE, NARROW, OMIT, ACCEPT],
      });
    });
}

function validationFindings(source, validation, label) {
  if (!validation) {
    return [makeFinding({
      source,
      code: "validation_absent",
      status: "uncertain",
      finding: `${label} validation has not run, so nothing is established either way.`,
      suggestedActions: [RERUN, ACCEPT],
    })];
  }
  if (validation.valid) return [];
  const issues = (validation.issues || []).filter((issue) => issue.severity === "error");
  if (!issues.length) {
    return [makeFinding({
      source,
      code: "validation_failed",
      status: "uncertain",
      finding: `${label} validation reported a failure without an itemised issue.`,
      suggestedActions: [RERUN, ACCEPT],
    })];
  }
  return issues.map((issue) => makeFinding({
    source,
    code: issue.code || "validation_failed",
    status: "uncertain",
    finding: issue.message || `${label}: ${issue.code} (${issue.field || issue.location || "document"}).`,
    location: issue.field || issue.location || "",
    suggestedActions: [RERUN, NARROW, OMIT, ACCEPT],
  }));
}

function coverageFindings(hardEligibilityMissing, coreRequirementsMissing) {
  // Coverage is a retrieval question -- "would a recruiter searching this term
  // find this resume" -- and PHILOSOPHY.md is explicit that it may never block.
  // It is also absence of evidence in one document, which is never evidence
  // that the person lacks the thing.
  const findings = [];
  for (const requirement of hardEligibilityMissing) {
    findings.push(makeFinding({
      source: "coverage",
      code: "hard_eligibility_not_covered",
      status: "unsupported",
      finding: `No wording in this resume covers a stated hard requirement: ${requirement}. This says nothing about whether the requirement is met.`,
      location: requirement,
      suggestedActions: [ASK, RETRIEVE, NARROW, ACCEPT],
    }));
  }
  for (const requirement of coreRequirementsMissing) {
    findings.push(makeFinding({
      source: "coverage",
      code: "core_requirement_not_covered",
      status: "uncertain",
      finding: `No wording in this resume covers a core job signal: ${requirement}.`,
      location: requirement,
      suggestedActions: [ASK, RETRIEVE, NARROW, ACCEPT],
    }));
  }
  return findings;
}

function judgeOutlookFindings({ atsJudge, engineerJudge, hrJudge }) {
  // A judge simulates external screening behaviour. It is an estimate, and
  // PHILOSOPHY.md already says an estimate must not occupy the same state as
  // fabrication. Before this change the code put it there anyway.
  const findings = [];
  const outlook = (source, verdict, text) => makeFinding({
    source,
    code: "weak_outlook",
    status: "uncertain",
    finding: text,
    location: verdict,
    suggestedActions: [NARROW, ASK, ACCEPT],
  });
  if (["fail", "marginal"].includes(atsJudge?.verdict)) {
    findings.push(outlook("judge_ats", atsJudge.verdict,
      `The ATS judge estimates this resume would screen as "${atsJudge.verdict}". This is a simulation of screening behaviour, not a fact about the candidate.`));
  }
  if (["no", "lean_no", "phone_screen"].includes(engineerJudge?.verdict)) {
    findings.push(outlook("judge_engineer", engineerJudge.verdict,
      `The engineer judge estimates "${engineerJudge.verdict}". This is a simulation of one reviewer, not a fact about the candidate.`));
  }
  if (["decline", "review"].includes(hrJudge?.screenRecommendation)) {
    findings.push(outlook("judge_hr", hrJudge.screenRecommendation,
      `The recruiter-screen judge estimates "${hrJudge.screenRecommendation}". This is a simulation of one screen, not a fact about the candidate.`));
  }
  if (hrJudge?.visualReview?.reviewed === false) {
    findings.push(makeFinding({
      source: "judge_hr",
      code: "visual_review_incomplete",
      status: "uncertain",
      finding: "Visual review of the rendered artifact was not completed, so how the document looks is unestablished.",
      suggestedActions: [RERUN, ACCEPT],
    }));
  }
  return findings;
}

export function evaluateQualityGate({
  applicationStrategy,
  strategyValidation,
  claimValidation,
  artifactValidation,
  atsResults,
  atsJudge,
  engineerJudge,
  hrJudge,
  expectedJudgeMetadata = {},
  artifactHash,
  artifactPath,
  artifactType,
  judgeValidationErrors = [],
  pipelineErrors = [],
  judgeModels = null,
}) {
  const findings = [];
  const bestAts = atsResults?.best?.ats || atsResults?.ats || atsResults || {};
  const hardEligibilityMissing = bestAts.hard_eligibility_missing || [];
  const coreRequirementsMissing = bestAts.core_requirements_missing || [];

  findings.push(...claimFindings(claimValidation));
  findings.push(...validationFindings("strategy", strategyValidation, "Application strategy"));
  findings.push(...coverageFindings(hardEligibilityMissing, coreRequirementsMissing));
  findings.push(...judgeOutlookFindings({ atsJudge, engineerJudge, hrJudge }));

  // Artifact validation is reported only when an artifact exists. When it does
  // not, `generation_failed` already says the only true thing there is to say,
  // and reporting that a document which was never produced is missing its
  // contact block is noise dressed as detail.
  if (artifactHash) {
    findings.push(...validationFindings("artifact", artifactValidation, "Rendered artifact"));
    if (artifactValidation && artifactValidation.artifactHash !== artifactHash) {
      findings.push(makeFinding({
        source: "artifact",
        code: "diagnostics_describe_other_artifact",
        status: "uncertain",
        finding: "Artifact validation was produced for a different or earlier file, so its results do not describe the document you are about to send.",
        suggestedActions: [RERUN, ACCEPT],
      }));
    }
  }

  if (applicationStrategy?.status === "blocked") {
    findings.push(makeFinding({
      source: "eligibility",
      code: "confirmed_unmet_requirement",
      status: "unsupported",
      finding: "The application strategy records a confirmed unmet categorical requirement. This is the one finding worth reading twice before sending.",
      suggestedActions: [ASK, RETRIEVE, OMIT, ACCEPT],
    }));
  }
  if (applicationStrategy?.status === "needs_evidence") {
    findings.push(makeFinding({
      source: "eligibility",
      code: "unresolved_evidence_question",
      status: "uncertain",
      finding: "The application strategy has unresolved evidence questions.",
      suggestedActions: [ASK, RETRIEVE, ACCEPT],
    }));
  }

  for (const message of judgeValidationErrors) {
    findings.push(makeFinding({
      source: "judge_integrity",
      code: "judge_output_invalid",
      status: "uncertain",
      finding: message,
      location: message,
      suggestedActions: [RERUN, ACCEPT],
    }));
  }
  for (const message of pipelineErrors) {
    findings.push(makeFinding({
      source: "pipeline",
      code: "stale_stage",
      status: "uncertain",
      finding: message,
      location: message,
      suggestedActions: [REBUILD, ACCEPT],
    }));
  }

  const judges = { ats: atsJudge, engineer: engineerJudge, hr: hrJudge };
  for (const [name, judge] of Object.entries(judges)) {
    if (judge) continue;
    findings.push(makeFinding({
      source: `judge_${name}`,
      code: "judge_absent",
      status: "uncertain",
      finding: `The ${name.toUpperCase()} judge did not run, so its perspective is simply missing.`,
      suggestedActions: [RERUN, ACCEPT],
    }));
  }

  const scoreVerdictValid = {
    ats: !atsJudge || (
      atsJudge.verdict === (
        atsJudge.score >= 80 ? "pass" : (atsJudge.score >= 60 ? "marginal" : "fail")
      )
    ),
    engineer: !engineerJudge || (
      engineerJudge.verdict === (
        engineerJudge.score >= 85
          ? "advance_to_onsite"
          : (engineerJudge.score >= 70 ? "phone_screen" : (engineerJudge.score >= 50 ? "lean_no" : "no"))
      )
    ),
    hr: !hrJudge || (
      hrJudge.screenRecommendation === (
        hrJudge.score >= 90
          ? "strong_advance"
          : (hrJudge.score >= 75 ? "advance" : (hrJudge.score >= 60 ? "review" : "decline"))
      )
    ),
  };
  for (const [name, valid] of Object.entries(scoreVerdictValid)) {
    if (valid) continue;
    findings.push(makeFinding({
      source: `judge_${name}`,
      code: "score_verdict_inconsistent",
      status: "uncertain",
      finding: `The ${name.toUpperCase()} judge's score and verdict disagree, so neither can be read at face value.`,
      suggestedActions: [RERUN, ACCEPT],
    }));
  }

  const judgeMetadataValid = {};
  for (const [name, judge] of Object.entries(judges)) {
    const expected = expectedJudgeMetadata[name];
    // `model` is compared like the hashes because it is supplied by tooling,
    // not authored by the judge. A mismatch means either the judge rewrote a
    // field it was told to copy verbatim, or the model configuration changed
    // after the verdict was produced -- in both cases the verdict is stale.
    //
    // It is skipped when either side is the unknown sentinel. An unreadable or
    // unreachable settings file says nothing about the model that judged.
    const modelComparable = ![judge?.metadata?.model, expected?.model].includes(UNKNOWN_MODEL);
    const fields = modelComparable
      ? ["model", "evaluatedArtifactHash", "promptHash", "inputHash"]
      : ["evaluatedArtifactHash", "promptHash", "inputHash"];
    const mismatches = fields.filter((field) =>
      judge && expected && judge.metadata?.[field] !== expected[field]
    );
    if (judge && !expected) {
      findings.push(makeFinding({
        source: `judge_${name}`,
        code: "judge_metadata_absent",
        status: "uncertain",
        finding: `Expected metadata for the ${name.toUpperCase()} judge is missing, so its verdict cannot be tied to this artifact.`,
        suggestedActions: [RERUN, ACCEPT],
      }));
      judgeMetadataValid[name] = false;
    } else if (mismatches.length) {
      findings.push(makeFinding({
        source: `judge_${name}`,
        code: "judge_metadata_stale",
        status: "uncertain",
        finding: `The ${name.toUpperCase()} judge's verdict describes a different artifact or configuration (${mismatches.join(", ")}), so it does not describe this document.`,
        location: mismatches.join(","),
        suggestedActions: [RERUN, ACCEPT],
      }));
      judgeMetadataValid[name] = false;
    } else {
      judgeMetadataValid[name] = Boolean(judge && expected);
    }
  }

  // Retained as evidence, not as authority. These record what was established,
  // so a reader can see at a glance which perspectives actually held up.
  // Nothing downstream may turn a `false` here into a refusal.
  const gates = {
    strategy: Boolean(strategyValidation?.valid && applicationStrategy?.status !== "blocked"),
    claims: Boolean(claimValidation?.valid),
    artifact: Boolean(
      artifactValidation?.valid && artifactHash && artifactValidation.artifactHash === artifactHash
    ),
    requirements: hardEligibilityMissing.length === 0,
    coreRequirements: coreRequirementsMissing.length === 0,
    atsJudge: Boolean(atsJudge && judgeMetadataValid.ats && scoreVerdictValid.ats && atsJudge.verdict !== "fail"),
    engineerJudge: Boolean(
      engineerJudge && judgeMetadataValid.engineer && scoreVerdictValid.engineer &&
      !["lean_no", "no"].includes(engineerJudge.verdict)
    ),
    hrJudge: Boolean(
      hrJudge && judgeMetadataValid.hr && scoreVerdictValid.hr && hrJudge.screenRecommendation !== "decline"
    ),
  };

  const ordered = sortFindings(dedupeFindings(findings));

  return {
    schemaVersion: "2.0",
    state: artifactHash ? "review_ready" : "generation_failed",
    generatedAt: new Date().toISOString(),
    artifact: {
      path: artifactPath,
      type: artifactType,
      hash: artifactHash,
    },
    findings: ordered,
    findingSummary: summarizeFindings(ordered),
    gates,
    // Recorded, not gated. Model diversity is a property of the operator's
    // runtime rather than of this application, and a signal that fires on every
    // default install is a signal nobody reads.
    judgeModels,
  };
}
