import { ZObservationRecord } from "../schemas/observation-record.js";

// Phrases that describe how something felt rather than what was measured. A
// verification without a measurement is an opinion, and an opinion cannot
// ground a claim.
const UNMEASURED = /\b(?:felt|seems?|looks?|appears?|pretty|quite|very|really|nice|smooth|snappy|clean|solid|impressive|good|great)\b/i;
const MEASUREMENT = /\d/;

// A boundary that restates the observation instead of bounding it.
const VACUOUS_BOUNDARY = /^(?:n\/?a|none|nothing|unknown|tbd|-{1,3})\.?$/i;

export function validateObservations(record) {
  const parsed = ZObservationRecord.safeParse(record);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        path: issue.path.join("."),
        message: issue.message,
      })),
      warnings: [],
      derivable: 0,
    };
  }

  const errors = [];
  const warnings = [];
  const data = parsed.data;

  for (const observation of data.observations) {
    const where = `observations.${observation.id}`;

    // The measurement rule. `verifiedHow` is what separates a record that can
    // ground a claim from a narrative that cannot.
    if (!MEASUREMENT.test(observation.verifiedHow)) {
      warnings.push({
        code: "verification_without_measurement",
        path: `${where}.verifiedHow`,
        message:
          "States a check but no measurement. A claim derived from this will have no defensible scope.",
      });
    }
    if (UNMEASURED.test(observation.verifiedHow)) {
      errors.push({
        code: "verification_is_impression",
        path: `${where}.verifiedHow`,
        message:
          "Describes how the system felt rather than what was measured. An observation record grounds claims and must carry no evaluation.",
      });
    }

    // The boundary rule. Without it, derived claims silently overreach.
    for (const boundary of observation.doesNotEstablish) {
      if (VACUOUS_BOUNDARY.test(boundary.trim())) {
        errors.push({
          code: "boundary_is_vacuous",
          path: `${where}.doesNotEstablish`,
          message:
            "Every observation has a boundary. A live product establishes existence and reachability, never authorship, scale, quality, or impact.",
        });
      }
    }
  }

  for (const contradiction of data.contradictions) {
    if (!contradiction.claimId) {
      warnings.push({
        code: "contradiction_unlinked",
        path: `contradictions.${contradiction.id}`,
        message:
          "Not linked to a claim ID, so nothing downstream can act on it. If it contradicts a ledger claim, name it.",
      });
    }
  }

  // Defects never gate the positive findings. Enforced rather than documented,
  // because an exploration of the persona's own live work will always find
  // some, and a report that blocks on them is a QA report wearing a costume.
  for (const defect of data.defectAppendix) {
    if (defect.blocking !== false) {
      errors.push({
        code: "defect_marked_blocking",
        path: `defectAppendix.${defect.id}`,
        message: "A defect never blocks consumption of the positive findings.",
      });
    }
  }

  if (!data.observations.length && !data.contradictions.length) {
    warnings.push({
      code: "no_positive_findings",
      path: "observations",
      message:
        "The record establishes nothing. An exploration that only found defects has not produced evidence.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    // How many observations are shaped well enough to derive a claim from.
    derivable: data.observations.filter(
      (observation) =>
        MEASUREMENT.test(observation.verifiedHow)
        && !UNMEASURED.test(observation.verifiedHow)
        && observation.doesNotEstablish.every((b) => !VACUOUS_BOUNDARY.test(b.trim()))
    ).length,
    contradictionCount: data.contradictions.length,
    defectCount: data.defectAppendix.length,
  };
}
