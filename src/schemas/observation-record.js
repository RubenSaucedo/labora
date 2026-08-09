import { z } from "zod";

// A neutral record of what a system was observed to do.
//
// Split deliberately from evaluation. An exploration surfaces two kinds of
// result at once -- capabilities that work, and things that are broken -- and
// mixing them produces an artifact that reads as a QA report. Two things go
// wrong when that happens: the verified capability evidence, which is the
// strongest material in the run, becomes the least visible; and nothing can be
// mechanically derived from it, so the collection effort is wasted at exactly
// the point it was supposed to pay off.
//
// The target is usually the persona's own live work. It is not under
// evaluation and perfection is not the bar.

// One axis only: who can re-verify this, and when. Deliberately not a measure
// of authorship or of strength -- see `skills/evidence-exploration/SKILL.md`.
//
// There is no `self_reported` member. A thing the persona merely stated was
// never observed, so it cannot be an observation; it belongs in the profile as
// a self-reported fact. Allowing it here would let the record launder an
// assertion into a verification.
const ZEvidenceTier = z.enum([
  // A reviewer can repeat the steps unaided, from the public internet.
  "publicly_reproducible",
  // Repeatable with access the operator can grant: a demo, a login, a
  // walkthrough. NOT a lower grade -- most production work lives here.
  "operator_reproducible",
  // Observed once, on a date, and not currently re-checkable.
  "point_in_time",
]);

export const ZObservation = z.object({
  id: z.string().min(1),

  // What the system actually did. A behaviour, not an opinion about it.
  observed: z.string().min(1),

  // The specific check performed, including the measurement. "It felt fast" is
  // not a verification; "Time to interactive 1.2s, median of 5 loads, Chrome
  // 141, throttled Fast 3G" is.
  verifiedHow: z.string().min(1),

  // The capability area this is evidence for.
  supports: z.array(z.string().min(1)).min(1),

  // The explicit boundary. This is the field that keeps derived claims honest:
  // without it a client-side behaviour silently becomes "durable execution",
  // and an in-memory one becomes "persisted". A live product URL establishes
  // that the product exists and is reachable -- not authorship, sole
  // authorship, user counts, quality, or impact.
  doesNotEstablish: z.array(z.string().min(1)).min(1),

  tier: ZEvidenceTier.default("operator_reproducible"),
  observedAt: z.string().min(1),
  url: z.string().default(""),
  artifacts: z.array(z.string()).default([]),
}).strict();

// An observation that disproves something already asserted.
//
// First-class rather than an appendix entry, because it is the one finding that
// can stop a resume shipping a false statement. This is not hypothetical: a
// live run contradicted a claim already marked `verified` in the ledger.
export const ZContradiction = z.object({
  id: z.string().min(1),
  claimId: z.string().default(""),
  assertion: z.string().min(1),
  observed: z.string().min(1),
  verifiedHow: z.string().min(1),
  observedAt: z.string().min(1),
  severity: z.enum(["claim_is_false", "claim_is_overstated", "claim_is_stale"]),
}).strict();

// Defects are feedback on real software, not a verdict on the evidence. They
// are recorded so the work is not lost, and are explicitly non-blocking: they
// never gate consumption of the positive findings.
export const ZDefect = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]).default("low"),
  // Boolean rather than a literal `false`, so that setting it true produces the
  // validator's explanation rather than an opaque schema rejection. The rule is
  // enforced in `validate-observations.js`.
  blocking: z.boolean().default(false),
  filedAt: z.string().default(""),
}).strict();

export const ZObservationRecord = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  target: z.string().min(1),
  exploredAt: z.string().min(1),
  method: z.string().min(1),
  observations: z.array(ZObservation).default([]),
  contradictions: z.array(ZContradiction).default([]),
  // Named `defectAppendix`, not `defects`, so its position is legible from the
  // field name alone.
  defectAppendix: z.array(ZDefect).default([]),
  notAttempted: z.array(z.string()).default([]),
}).strict();
