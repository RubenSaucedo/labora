import { z } from "zod";

/**
 * The editorial contracts.
 *
 * Two artifacts live here, and the boundary between them is the point:
 *
 * - `ZBaselineResumeContract` names a document an operator already reviewed.
 *   It is an *editorial* constraint. It says which wording, order and
 *   structural decisions a human made, so the tailor can stop regenerating
 *   sentences nobody complained about. It is never evidence, and it carries no
 *   claim IDs, so it cannot ground a fact even by accident.
 *
 * - `ZEditorialPlan` records what the tailor proposes to do to that document,
 *   span by span, before any prose is mutated.
 */

export const EDITORIAL_OPERATIONS = [
  "keep",
  "move",
  "combine",
  "split",
  "make_specific",
  "delete",
  "rewrite",
];

/**
 * How meaning moved, recorded separately from how words moved.
 *
 * `rewrite` with `semanticDelta: "none"` is a wording change. `rewrite` with
 * `"narrowed"` is a different claim wearing the previous sentence's clothes,
 * and it is the case an operator has to see. Collapsing the two into "changed"
 * is how an approved sentence quietly becomes a weaker one.
 */
export const SEMANTIC_DELTAS = [
  "none",
  "narrowed",
  "broadened",
  "moved",
  "split",
  "combined",
  "removed",
];

const ZSha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected a sha256 hex digest");

export const ZBaselineResumeContract = z.object({
  // Either a workspace-relative path or any stable identifier the operator
  // uses. The hash is what binds; the path only helps a human find the file.
  path: z.string().min(1),
  sha256: ZSha256,
  // Only `operator` means a person reviewed it. `unreviewed` exists so a draft
  // can be carried as a *structural* baseline without claiming anyone approved
  // its wording -- preserving wording nobody approved is not a guarantee worth
  // making, and pretending otherwise would launder a generated draft into an
  // approved one.
  approval: z.enum(["operator", "unreviewed"]).default("unreviewed"),
  approvedAt: z.string().default(""),
  note: z.string().default(""),
}).strict();

const ZSpanRef = z.object({
  location: z.string().min(1),
  text: z.string().default(""),
}).strict();

export const ZEditorialOperation = z.object({
  // The exact source span in the baseline. `move` and `split` also name
  // destinations; `combine` names additional sources.
  location: z.string().min(1),
  operation: z.enum(EDITORIAL_OPERATIONS),

  // Byte-for-byte as it stands in the baseline. Recording it here is what lets
  // a later reader see what was replaced without holding the old file.
  originalText: z.string().default(""),
  proposedText: z.string().default(""),

  // For `move` and `split`: where the content lands. For `combine`: the single
  // destination the sources merge into.
  destination: z.string().default(""),
  additionalSources: z.array(ZSpanRef).default([]),
  products: z.array(ZSpanRef).default([]),

  reason: z.string().default(""),
  semanticDelta: z.enum(SEMANTIC_DELTAS).default("none"),

  // Current-ledger support. The baseline's own provenance is deliberately not
  // accepted here: a claim that was verified when the baseline was written may
  // have been superseded, and re-resolving is the only way to notice.
  claimIds: z.array(z.string().min(1)).default([]),
  unitIds: z.array(z.string().min(1)).default([]),

  // Other spans that carry the same term, claim or proof and must be re-checked
  // when this one changes. This is the dependency edge #109 and #110 ask for:
  // remove the only bullet proving a skill and the skill has to be revisited.
  affects: z.array(z.string().min(1)).default([]),

  requiresReapproval: z.boolean().default(false),
}).strict();

export const ZEditorialPlan = z.object({
  schemaVersion: z.literal("1.0"),
  // Binds the plan to one exact baseline. A plan whose hash does not match the
  // baseline on disk describes a document that is no longer there.
  baselineHash: ZSha256.nullable().default(null),
  baselinePath: z.string().default(""),
  // What the whole document is for. Section missions are judged against it.
  documentMission: z.string().min(1),
  operations: z.array(ZEditorialOperation).default([]),
  // Spans the tailor added that have no baseline counterpart, declared rather
  // than inferred, so a genuinely new bullet is distinguishable from a rewrite
  // that lost its address.
  additions: z.array(z.object({
    location: z.string().min(1),
    text: z.string().default(""),
    reason: z.string().min(1),
    claimIds: z.array(z.string().min(1)).default([]),
    unitIds: z.array(z.string().min(1)).default([]),
  }).strict()).default([]),
  notesForHuman: z.array(z.string()).default([]),
}).strict();

export const ZEditorialPlanValidation = z.object({
  schemaVersion: z.literal("1.0"),
  valid: z.boolean(),
  baselineHash: z.string().nullable(),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning", "info"]).default("error"),
    code: z.string(),
    location: z.string().default(""),
    message: z.string(),
  })),
  warnings: z.array(z.object({
    severity: z.enum(["error", "warning", "info"]).default("warning"),
    code: z.string(),
    location: z.string().default(""),
    message: z.string(),
  })).default([]),
  coverage: z.object({
    changedLocations: z.array(z.string()).default([]),
    explainedLocations: z.array(z.string()).default([]),
    unexplainedLocations: z.array(z.string()).default([]),
    preservedLocations: z.array(z.string()).default([]),
  }),
  reapproval: z.object({
    required: z.boolean(),
    locations: z.array(z.string()).default([]),
  }),
});
