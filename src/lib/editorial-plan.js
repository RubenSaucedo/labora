import { EDITORIAL_OPERATIONS } from "../schemas/editorial.js";
import { diffSegments, indexSegments, segmentResume } from "./resume-segments.js";

/**
 * The editorial plan: what the tailor proposes to do to an approved document,
 * recorded before a single sentence is mutated.
 *
 * The defect this exists to remove is that regeneration was the only operation.
 * A model handed a resume and a posting produces different prose, and different
 * prose is indistinguishable from *better* prose unless someone writes down
 * which of seven things they meant to do and why. Seven, not one:
 *
 *   keep, move, combine, split, make_specific, delete, rewrite
 *
 * `rewrite` is last on that list because it is the operation of last resort. A
 * sentence in the wrong section is not fixed by polishing it, and the polish
 * hides the misplacement -- that is `local_polish_architecture_miss` in the
 * whole-document audit.
 *
 * Everything in this file is deterministic. It checks hashes, exact spans,
 * claim resolution, partition arithmetic and dependency closure. It makes no
 * judgment about whether a sentence reads well; that is the audit's job, and
 * the audit is advisory. Keeping the two apart is what lets the invariants be
 * strict without giving a heuristic authority over someone's wording.
 */

const STRUCTURAL_OPERATIONS = new Set(["move", "combine", "split", "delete"]);
const TEXT_PRODUCING_OPERATIONS = new Set(["rewrite", "make_specific", "move", "combine", "split"]);

// Sections whose prose is claim-gated. Skills, education and certifications
// have their own validators and their own grounding rules, so requiring a
// bullet-shaped claim mapping here would double-gate them under a worse test.
const CLAIM_GATED_SECTIONS = new Set(["summary", "experience", "projects"]);

function sectionOf(location) {
  if (location === "headline") return "headline";
  if (location.startsWith("summary.")) return "summary";
  if (location.startsWith("experience[")) return "experience";
  if (location.startsWith("skills.")) return "skills";
  if (location.startsWith("projects[")) return "projects";
  if (location.startsWith("education[")) return "education";
  if (location.startsWith("certifications[")) return "certifications";
  if (location.startsWith("awards[")) return "awards";
  return "unknown";
}

/**
 * Which claims a rendered span is mapped to, read from the resume's own
 * provenance rather than from the plan.
 *
 * The plan states intent; provenance states what the document actually claims.
 * Comparing them is how a `move` that quietly dropped its evidence mapping
 * becomes visible -- the sentence arrived at its new home, the grounding did
 * not, and nothing else in the pipeline would notice because the bullet still
 * parses.
 */
export function claimIdsAtLocation(resume, location) {
  const summary = /^summary\.sentences\[(\d+)\]$/.exec(location);
  if (summary) {
    const entry = (resume?.provenance?.summary || [])
      .find((item) => Number(item.sentenceIndex) === Number(summary[1]));
    if (!entry) return null;
    return [...new Set((entry.clauses || []).flatMap((clause) => clause.claimIds || []))];
  }

  const bullet = /^experience\[(\d+)\]\.bullets\[(\d+)\]$/.exec(location);
  if (bullet) {
    const role = (resume?.experience || [])[Number(bullet[1])];
    if (!role) return null;
    const entry = (resume?.provenance?.bullets || []).find(
      (item) => item.experienceId === role.id && Number(item.bulletIndex) === Number(bullet[2])
    );
    return entry ? [...entry.claimIds] : null;
  }

  const skill = /^skills\.(primary|secondary)\[(\d+)\]$/.exec(location);
  if (skill) {
    const field = skill[1] === "primary" ? "skills_primary" : "skills_secondary";
    const display = (resume?.[field] || [])[Number(skill[2])];
    if (display == null) return null;
    const entry = (resume?.provenance?.skills || []).find((item) => item.skill === display);
    return entry ? [...entry.claimIds] : null;
  }

  const project = /^projects\[(\d+)\]\./.exec(location);
  if (project) {
    const entry = (resume?.projects || [])[Number(project[1])];
    return entry ? [...(entry.claimIds || [])] : null;
  }

  const headline = location === "headline";
  if (headline) {
    return [...new Set((resume?.provenance?.headline || []).flatMap((item) => item.claimIds || []))];
  }

  return null;
}

const NUMERIC = /\d[\d,.]*\s*(?:%|percent|x|ms|s|seconds?|minutes?|hours?|days?|k|m|b)?/gi;

function numericTokens(text) {
  return [...String(text || "").matchAll(NUMERIC)]
    .map((match) => match[0].replace(/[,\s]/g, "").toLowerCase())
    .filter(Boolean);
}

function numberCore(token) {
  const match = /^[\d.]+/.exec(token);
  return match ? match[0].replace(/\.$/, "") : token;
}

export function operationRequiresReapproval(operation, { baselineApproved = true } = {}) {
  if (!baselineApproved) return false;
  if (STRUCTURAL_OPERATIONS.has(operation.operation)) return true;
  return operation.semanticDelta !== "none";
}

/**
 * @param {object} args
 * @param {object} args.plan         a ZEditorialPlan document
 * @param {object} args.baselineView the output of `baselineEditorialView()`
 * @param {object} args.revised      the tailored resume the plan describes
 * @param {object} args.claimLedger  the current ledger; the baseline is never a substitute
 * @param {object} [args.bank]       the accomplishment bank, for boundary arithmetic
 * @param {boolean} [args.baselineApproved]
 * @param {string}  [args.baselineHash]
 */
export function validateEditorialPlan({
  plan,
  baselineView,
  revised,
  claimLedger,
  bank = null,
  baselineApproved = true,
  baselineHash = null,
}) {
  const issues = [];
  const warnings = [];
  const raise = (entry) => (entry.severity === "warning" || entry.severity === "info" ? warnings : issues).push({
    severity: "error",
    location: "",
    ...entry,
  });

  const baselineSegments = baselineView?.segments || [];
  const baselineIndex = indexSegments(baselineSegments);
  const revisedSegments = segmentResume(revised);
  const revisedIndex = indexSegments(revisedSegments);
  const diff = diffSegments(baselineSegments, revisedSegments);

  const verifiedClaims = new Map(
    (claimLedger?.claims || [])
      .filter((claim) => claim.status === "verified")
      .map((claim) => [claim.id, claim])
  );
  const units = new Map((bank?.units || []).map((unit) => [unit.id, unit]));
  const unitByClaim = new Map();
  for (const unit of bank?.units || []) {
    for (const claimId of unit.claimIds || []) unitByClaim.set(claimId, unit);
  }

  if (baselineHash && plan?.baselineHash && plan.baselineHash !== baselineHash) {
    raise({
      code: "baseline_hash_mismatch",
      location: "baselineHash",
      message:
        `This plan was written against baseline ${plan.baselineHash.slice(0, 12)} but the recorded ` +
        `baseline is ${baselineHash.slice(0, 12)}. It describes a document that is no longer there.`,
    });
  }

  const operations = plan?.operations || [];
  const seen = new Map();
  const explained = new Set();

  for (const operation of operations) {
    const { location } = operation;
    const where = `operations[${location}]`;

    if (!EDITORIAL_OPERATIONS.includes(operation.operation)) {
      raise({ code: "unknown_operation", location, message: `"${operation.operation}" is not an editorial operation.` });
      continue;
    }
    if (seen.has(location)) {
      raise({
        code: "duplicate_operation",
        location,
        message: `Two operations both claim ${location}; only one can describe what happened to it.`,
      });
    }
    seen.set(location, operation);

    const before = baselineIndex.get(location);
    if (!before) {
      raise({
        code: "unknown_baseline_location",
        location,
        message: `${location} does not exist in the baseline, so no operation can act on it. Declare it under additions instead.`,
      });
      continue;
    }

    // Byte equality, not normalised equality. A plan whose `originalText` is a
    // tidied version of the approved sentence is already describing a change it
    // did not record.
    if (operation.originalText && operation.originalText !== before.text) {
      raise({
        code: "baseline_text_mismatch",
        location,
        message: `The recorded originalText for ${location} is not what the baseline says at that address.`,
      });
    }

    if (operation.operation !== "keep" && !operation.reason.trim()) {
      raise({
        code: "operation_without_reason",
        location,
        message: `A ${operation.operation} on approved wording needs a recorded reason. ${where} has none.`,
      });
    }

    const after = revisedIndex.get(location);

    if (operation.operation === "keep") {
      if (!after) {
        raise({
          code: "keep_operation_text_removed",
          location,
          message: `${location} is marked keep but is absent from the revision.`,
        });
      } else if (after.hash !== before.hash) {
        raise({
          code: "keep_operation_text_changed",
          location,
          message:
            `${location} is marked keep but its wording changed. Either restore the approved wording ` +
            "or record the operation that changed it.",
        });
      }
      // A kept span is not exempt from grounding. It was approved as *wording*;
      // whether the ledger still supports it is a separate question that the
      // claim validator answers on the revised document. This only checks that
      // the mapping still exists to be validated.
      if (after && CLAIM_GATED_SECTIONS.has(before.section)) {
        const mapped = claimIdsAtLocation(revised, location);
        if (!mapped || !mapped.length) {
          raise({
            code: "kept_span_without_provenance",
            location,
            message:
              `${location} was kept from the baseline but carries no claim mapping in the revision. ` +
              "A baseline preserves wording; it never grounds it.",
          });
        }
      }
      explained.add(location);
      continue;
    }

    explained.add(location);

    if (operation.operation === "delete") {
      if (after) {
        raise({
          code: "delete_operation_text_present",
          location,
          message: `${location} is marked delete but still appears in the revision.`,
        });
      }
      if (operation.semanticDelta !== "removed") {
        raise({
          code: "rewrite_without_semantic_delta",
          location,
          message: `A delete of ${location} must record semanticDelta "removed".`,
        });
      }
      continue;
    }

    if (TEXT_PRODUCING_OPERATIONS.has(operation.operation)) {
      if (!operation.claimIds.length && CLAIM_GATED_SECTIONS.has(before.section)) {
        raise({
          code: "operation_without_claim_support",
          location,
          message:
            `A ${operation.operation} on ${location} names no claim IDs. The baseline records that a ` +
            "person approved this sentence; only the ledger records that it is supported.",
        });
      }
      for (const claimId of operation.claimIds) {
        if (/^baseline[:.-]/i.test(claimId)) {
          raise({
            code: "baseline_cited_as_evidence",
            location,
            message: `${location} cites "${claimId}". The baseline is an editorial constraint, never a source.`,
          });
        } else if (!verifiedClaims.has(claimId)) {
          raise({
            code: "unverified_claim",
            location,
            message: `${location} cites claim "${claimId}", which is not a verified claim in the current ledger.`,
          });
        }
      }
      for (const unitId of operation.unitIds) {
        if (!units.size) break;
        if (!units.has(unitId)) {
          raise({
            code: "unknown_unit",
            location,
            message: `${location} cites accomplishment unit "${unitId}", which is not in the bank.`,
          });
        }
      }
    }

    if (operation.operation === "rewrite" || operation.operation === "make_specific") {
      if (!after) {
        raise({
          code: "rewrite_target_missing",
          location,
          message: `${location} was ${operation.operation}d but is absent from the revision.`,
        });
      } else if (operation.proposedText && operation.proposedText !== after.text) {
        raise({
          code: "proposed_text_mismatch",
          location,
          message: `The proposedText for ${location} is not the text the revision renders there.`,
        });
      } else if (after.hash === before.hash && operation.semanticDelta === "none") {
        raise({
          severity: "warning",
          code: "no_op_rewrite",
          location,
          message: `${location} is recorded as a ${operation.operation} but its text is unchanged.`,
        });
      }
      if (operation.operation === "make_specific" && operation.semanticDelta === "broadened") {
        raise({
          code: "make_specific_broadened",
          location,
          message: `${location} is recorded as make_specific but its meaning broadened. That is a different operation.`,
        });
      }
    }

    if (operation.operation === "move") {
      const destination = operation.destination;
      if (!destination) {
        raise({ code: "unknown_destination", location, message: `A move of ${location} names no destination.` });
      } else {
        explained.add(destination);
        const landed = revisedIndex.get(destination);
        if (!landed) {
          raise({
            code: "unknown_destination",
            location,
            message: `A move of ${location} names destination ${destination}, which the revision does not contain.`,
          });
        } else {
          if (operation.semanticDelta !== "moved" && operation.semanticDelta !== "none") {
            raise({
              severity: "warning",
              code: "move_changed_meaning",
              location,
              message:
                `Moving ${location} to ${destination} also recorded semanticDelta ` +
                `"${operation.semanticDelta}". A move that changes meaning is a move plus a rewrite; record both.`,
            });
          }
          // A move relocates a claim; it does not release it. If the mapping at
          // the destination is not the mapping the plan moved, then either the
          // evidence was dropped in transit or a different claim was substituted
          // under cover of a placement change.
          if (CLAIM_GATED_SECTIONS.has(sectionOf(destination))) {
            const landedClaims = claimIdsAtLocation(revised, destination);
            const declared = new Set(operation.claimIds);
            const arrived = new Set(landedClaims || []);
            const preserved =
              landedClaims != null &&
              declared.size > 0 &&
              [...declared].every((id) => arrived.has(id));
            if (!preserved) {
              raise({
                code: "move_drops_claim_mapping",
                location,
                message:
                  `Moving ${location} to ${destination} did not carry its claim mapping ` +
                  `(${[...declared].join(", ") || "none declared"} -> ${[...arrived].join(", ") || "none"}).`,
              });
            }
          }
        }
      }
    }

    if (operation.operation === "split") {
      const products = operation.products || [];
      if (products.length < 2) {
        raise({
          code: "split_without_products",
          location,
          message: `A split of ${location} must name at least two products.`,
        });
      }
      const sourceClaims = new Set(operation.claimIds);
      const assigned = new Map();
      for (const product of products) {
        explained.add(product.location);
        const productClaims = claimIdsAtLocation(revised, product.location);
        if (!revisedIndex.has(product.location)) {
          raise({
            code: "unknown_destination",
            location,
            message: `The split of ${location} names product ${product.location}, which the revision does not contain.`,
          });
          continue;
        }
        if (!CLAIM_GATED_SECTIONS.has(sectionOf(product.location))) continue;
        if (!productClaims || !productClaims.length) {
          raise({
            code: "split_product_without_provenance",
            location: product.location,
            message: `The split product ${product.location} carries no claim mapping.`,
          });
          continue;
        }
        for (const claimId of productClaims) {
          if (sourceClaims.size && !sourceClaims.has(claimId)) {
            raise({
              code: "split_introduces_claim",
              location: product.location,
              message:
                `The split product ${product.location} maps to claim "${claimId}", which the source ` +
                `${location} did not carry. A split divides evidence; it does not acquire any.`,
            });
          }
          // The partition rule. Duplicating a claim across both halves is how
          // one measured outcome ends up asserted about two different subjects.
          if (assigned.has(claimId)) {
            raise({
              code: "split_outcome_subject_mismatch",
              location: product.location,
              message:
                `Claim "${claimId}" is attached to both ${assigned.get(claimId)} and ${product.location}. ` +
                "One outcome cannot belong to two subjects.",
            });
          } else {
            assigned.set(claimId, product.location);
          }
        }

        // Every number a product prints must come from a fact that product is
        // mapped to. This is the deterministic form of "the outcome stayed with
        // its subject": if the latency figure followed the wrong half of the
        // split, the figure is now printed beside a claim that never measured it.
        const productFacts = productClaims
          .map((id) => verifiedClaims.get(id))
          .filter(Boolean)
          .map((claim) => `${claim.fact} ${claim.externalFact || ""}`)
          .join(" ");
        const supportingNumbers = new Set(numericTokens(productFacts).map(numberCore));
        for (const token of numericTokens(product.text || revisedIndex.get(product.location)?.text)) {
          if (!supportingNumbers.has(numberCore(token))) {
            raise({
              code: "split_outcome_subject_mismatch",
              location: product.location,
              message:
                `${product.location} prints "${token}", which none of its mapped claims contains. ` +
                "The outcome was attached to the wrong half of the split.",
            });
          }
        }
      }
      if (operation.semanticDelta !== "split") {
        raise({
          code: "rewrite_without_semantic_delta",
          location,
          message: `A split of ${location} must record semanticDelta "split".`,
        });
      }
    }

    if (operation.operation === "combine") {
      const sources = [
        { location, text: operation.originalText || before.text },
        ...(operation.additionalSources || []),
      ];
      if (sources.length < 2) {
        raise({
          code: "combine_without_sources",
          location,
          message: `A combine at ${location} names no additional source.`,
        });
      }
      for (const source of operation.additionalSources || []) {
        explained.add(source.location);
        if (!baselineIndex.has(source.location)) {
          raise({
            code: "unknown_baseline_location",
            location: source.location,
            message: `The combine at ${location} names source ${source.location}, which the baseline does not contain.`,
          });
        }
      }
      if (operation.destination) explained.add(operation.destination);

      // Evidence boundaries. Two true sentences may only become one when the
      // facts belong to one accomplishment, one attribution level and one
      // disclosure boundary. Joining across any of those manufactures a causal
      // chain no single source supports -- and the joined sentence reads
      // stronger than either original, which is precisely why it is tempting.
      if (units.size) {
        const touched = operation.claimIds
          .map((id) => unitByClaim.get(id))
          .filter(Boolean);
        const unitIds = new Set(touched.map((unit) => unit.id));
        const contributions = new Set(touched.map((unit) => unit.contribution));
        const experiences = new Set(touched.map((unit) => unit.experienceId));
        const disclosures = new Set(touched.map((unit) => unit.disclosure));

        if (unitIds.size > 1) {
          raise({
            code: "combine_crosses_accomplishment_boundary",
            location,
            message:
              `The combine at ${location} joins claims from ${unitIds.size} accomplishment units ` +
              `(${[...unitIds].join(", ")}). Separate accomplishments stay separate bullets.`,
          });
        }
        if (contributions.size > 1) {
          raise({
            code: "combine_crosses_attribution_boundary",
            location,
            message:
              `The combine at ${location} joins work at different contribution levels ` +
              `(${[...contributions].join(", ")}). The joined sentence would claim the stronger one for both.`,
          });
        }
        if (experiences.size > 1) {
          raise({
            code: "combine_crosses_accomplishment_boundary",
            location,
            message: `The combine at ${location} joins work from different roles (${[...experiences].join(", ")}).`,
          });
        }
        if (disclosures.size > 1) {
          raise({
            code: "combine_crosses_disclosure_boundary",
            location,
            message:
              `The combine at ${location} joins claims with different disclosure boundaries ` +
              `(${[...disclosures].join(", ")}).`,
          });
        }
      }
      if (operation.semanticDelta !== "combined") {
        raise({
          code: "rewrite_without_semantic_delta",
          location,
          message: `A combine at ${location} must record semanticDelta "combined".`,
        });
      }
    }

    for (const dependent of operation.affects) {
      if (!revisedIndex.has(dependent) && !baselineIndex.has(dependent)) {
        raise({
          code: "dependency_unresolved",
          location,
          message: `${location} declares it affects ${dependent}, which exists in neither document.`,
        });
      }
    }

    const expectedReapproval = operationRequiresReapproval(operation, { baselineApproved });
    if (operation.requiresReapproval !== expectedReapproval) {
      raise({
        code: "change_requires_reapproval",
        location,
        message:
          `${location} records requiresReapproval=${operation.requiresReapproval}, but a ` +
          `${operation.operation} with semanticDelta "${operation.semanticDelta}" ` +
          `${expectedReapproval ? "does" : "does not"} require it.`,
      });
    }
  }

  for (const addition of plan?.additions || []) {
    explained.add(addition.location);
    if (baselineIndex.has(addition.location) && revisedIndex.get(addition.location)?.hash === baselineIndex.get(addition.location).hash) {
      raise({
        severity: "warning",
        code: "addition_is_baseline_text",
        location: addition.location,
        message: `${addition.location} is declared new but is unchanged baseline wording.`,
      });
    }
    for (const claimId of addition.claimIds) {
      if (!verifiedClaims.has(claimId)) {
        raise({
          code: "unverified_claim",
          location: addition.location,
          message: `New span ${addition.location} cites claim "${claimId}", which is not verified in the current ledger.`,
        });
      }
    }
  }

  // The central guarantee, stated as arithmetic: nothing an operator approved
  // may differ in the revision without an operation that names it.
  const unexplained = diff.changedLocations.filter((location) => !explained.has(location));
  for (const location of unexplained) {
    raise({
      code: "approved_baseline_changed_without_reason",
      location,
      message:
        `${location} differs from the approved baseline with no editorial operation explaining it. ` +
        "Record keep, move, combine, split, make_specific, delete, or rewrite -- and why.",
    });
  }

  // Advisory: rewriting is available, not default. If most of what happened to
  // an approved document was rewriting, the likely defect is that placement,
  // selection and ordering were never considered.
  const touchingChanges = operations.filter((operation) => operation.operation !== "keep");
  const rewrites = touchingChanges.filter((operation) => operation.operation === "rewrite");
  if (touchingChanges.length >= 4 && rewrites.length / touchingChanges.length > 0.6) {
    raise({
      severity: "warning",
      code: "rewrite_used_as_default",
      location: "operations",
      message:
        `${rewrites.length} of ${touchingChanges.length} operations are rewrites. Check whether move, ` +
        "combine, split or delete solves the real problem before changing approved wording.",
    });
  }

  const errors = issues.filter((entry) => (entry.severity ?? "error") === "error");
  const reapprovalLocations = operations
    .filter((operation) => operationRequiresReapproval(operation, { baselineApproved }))
    .map((operation) => operation.location);

  return {
    schemaVersion: "1.0",
    valid: errors.length === 0,
    baselineHash: plan?.baselineHash ?? null,
    issues: errors,
    warnings,
    coverage: {
      changedLocations: diff.changedLocations,
      explainedLocations: [...explained].sort(),
      unexplainedLocations: unexplained,
      preservedLocations: diff.unchanged.map((entry) => entry.location),
    },
    reapproval: {
      required: reapprovalLocations.length > 0,
      locations: reapprovalLocations,
    },
  };
}
