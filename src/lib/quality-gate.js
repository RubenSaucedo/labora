import { UNKNOWN_MODEL } from "./copilot-settings.js";

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
  const hardBlockers = [];
  const reviewReasons = [];
  const bestAts = atsResults?.best?.ats || atsResults?.ats || atsResults || {};
  const hardEligibilityMissing = bestAts.hard_eligibility_missing || [];
  const coreRequirementsMissing = bestAts.core_requirements_missing || [];

  if (!strategyValidation?.valid) hardBlockers.push("Application strategy validation failed.");
  if (applicationStrategy?.status === "blocked") {
    hardBlockers.push("Application strategy contains a confirmed eligibility blocker.");
  }
  if (!claimValidation?.valid) hardBlockers.push("Factual claim validation failed.");
  if (!artifactValidation?.valid) hardBlockers.push("Rendered artifact validation failed.");
  if (!artifactHash) hardBlockers.push("Selected delivery artifact is missing.");
  if (artifactValidation?.artifactHash !== artifactHash) {
    hardBlockers.push("Artifact validation was produced for a stale or different delivery artifact.");
  }
  if (hardEligibilityMissing.length) {
    hardBlockers.push(`Hard eligibility remains unsupported: ${hardEligibilityMissing.join("; ")}`);
  }
  if (!atsJudge || !engineerJudge || !hrJudge) hardBlockers.push("One or more required judge outputs are missing.");
  hardBlockers.push(...judgeValidationErrors);
  hardBlockers.push(...pipelineErrors);
  const judges = { ats: atsJudge, engineer: engineerJudge, hr: hrJudge };
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
    if (!valid) hardBlockers.push(`${name.toUpperCase()} judge score and verdict are inconsistent.`);
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
    // unreachable settings file says nothing about the model that judged, so
    // letting it invalidate three correct verdicts would turn a check that
    // could not run into a check that failed.
    const modelComparable = ![judge?.metadata?.model, expected?.model].includes(UNKNOWN_MODEL);
    const fields = modelComparable
      ? ["model", "evaluatedArtifactHash", "promptHash", "inputHash"]
      : ["evaluatedArtifactHash", "promptHash", "inputHash"];
    const mismatches = fields.filter((field) =>
      judge && expected && judge.metadata?.[field] !== expected[field]
    );
    if (judge && !expected) {
      hardBlockers.push(`${name.toUpperCase()} judge expected metadata is missing.`);
      judgeMetadataValid[name] = false;
    } else if (mismatches.length) {
      hardBlockers.push(
        `${name.toUpperCase()} judge metadata is stale or mismatched: ${mismatches.join(", ")}.`
      );
      judgeMetadataValid[name] = false;
    } else {
      judgeMetadataValid[name] = Boolean(judge && expected);
    }
  }
  if (atsJudge?.verdict === "fail") hardBlockers.push("ATS judge returned fail.");
  if (engineerJudge?.verdict === "no") hardBlockers.push("Engineer judge returned no.");
  if (hrJudge?.screenRecommendation === "decline") {
    hardBlockers.push("Recruiter-screen judge returned decline.");
  }

  if (applicationStrategy?.status === "needs_evidence") {
    reviewReasons.push("Application strategy has unresolved evidence questions.");
  }
  if (coreRequirementsMissing.length) {
    reviewReasons.push(`Core job signals need human review: ${coreRequirementsMissing.join("; ")}`);
  }
  if (atsJudge?.verdict === "marginal") reviewReasons.push("ATS judge is marginal.");
  if (engineerJudge?.verdict === "lean_no" || engineerJudge?.verdict === "phone_screen") {
    reviewReasons.push(`Engineer judge returned ${engineerJudge.verdict}.`);
  }
  if (hrJudge?.screenRecommendation === "review") {
    reviewReasons.push("Recruiter-screen judge requires human review.");
  }
  if (hrJudge?.visualReview?.reviewed === false) {
    reviewReasons.push("Visual artifact review was not completed.");
  }
  const gates = {
    strategy: Boolean(
      strategyValidation?.valid && applicationStrategy?.status !== "blocked"
    ),
    claims: Boolean(claimValidation?.valid),
    artifact: Boolean(
      artifactValidation?.valid &&
      artifactHash &&
      artifactValidation.artifactHash === artifactHash
    ),
    requirements: hardEligibilityMissing.length === 0,
    coreRequirements: coreRequirementsMissing.length === 0,
    atsJudge: Boolean(
      atsJudge &&
      judgeMetadataValid.ats &&
      scoreVerdictValid.ats &&
      atsJudge.verdict !== "fail"
    ),
    engineerJudge: Boolean(
      engineerJudge &&
      judgeMetadataValid.engineer &&
      scoreVerdictValid.engineer &&
      !["lean_no", "no"].includes(engineerJudge.verdict)
    ),
    hrJudge: Boolean(
      hrJudge &&
      judgeMetadataValid.hr &&
      scoreVerdictValid.hr &&
      hrJudge.screenRecommendation !== "decline"
    ),
  };

  return {
    schemaVersion: "1.0",
    state: hardBlockers.length ? "blocked" : (reviewReasons.length ? "human_review" : "send_ready"),
    generatedAt: new Date().toISOString(),
    artifact: {
      path: artifactPath,
      type: artifactType,
      hash: artifactHash,
    },
    hardBlockers,
    reviewReasons,
    gates,
    // Recorded, not gated. Model diversity is a property of the operator's
    // runtime rather than of this application, and a signal that fires on every
    // default install is a signal nobody reads. It is written here so a
    // send_ready record can never be mistaken for evidence that the three
    // judges were independent all the way down to the model.
    judgeModels,
  };
}
