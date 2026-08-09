import { z } from "zod";

const ZSeverity = z.enum(["hard_eligibility", "core", "preferred", "soft_signal"]);

export const ZApplicationStrategy = z.object({
  schemaVersion: z.literal("1.0"),
  status: z.enum(["ready", "needs_evidence", "blocked"]),
  targetRole: z.string().min(1),
  company: z.string().default(""),
  candidateNarrative: z.string().min(1),
  topSignals: z.array(z.object({
    signal: z.string().min(1),
    requirementIds: z.array(z.string()).default([]),
    claimIds: z.array(z.string()).min(1),
    rationale: z.string().min(1),
  }).strict()).min(1).max(3),
  likelyConcerns: z.array(z.object({
    requirementId: z.string().min(1),
    text: z.string().min(1),
    severity: ZSeverity,
    evidenceStatus: z.enum(["supported", "unsupported", "uncertain"]),
    questionForCandidate: z.string().default(""),
  }).strict()).default([]),
  firstPagePlan: z.object({
    headline: z.string().min(1),
    summaryFocus: z.array(z.string().min(1)).min(1).max(3),
    leadClaimIds: z.array(z.string()).min(1),
    skillsOrder: z.array(z.string()).default([]),
  }).strict(),
  // Ranked accomplishment units the tailor should draft from. Optional so
  // pre-bank strategies stay parseable; verified when present.
  unitShortlist: z.array(z.object({
    unitId: z.string().min(1),
    rank: z.number().int().min(1),
    matchedRequirementIds: z.array(z.string()).default([]),
    rationale: z.string().min(1),
  }).strict()).default([]),
  evidenceRequests: z.array(z.object({
    requirementId: z.string().min(1),
    question: z.string().min(1),
    acceptableSources: z.array(z.string().min(1)).min(1),

    // Four statuses, because they need four different actions and used to share
    // one bucket called "pending". Most declared gaps were never gaps: they were
    // evidence sitting unmined in the corpus, or facts obtainable in minutes
    // from something the candidate already owns.
    //
    // `unmined` is a statement about labora's bookkeeping. `real_gap` is a
    // statement about a corpus. Neither is a statement about a person.
    status: z.enum([
      "unmined",
      "mention_only",
      "collectible",
      "adjacent",
      "real_gap",
    ]).nullable().default(null),

    // Where in the corpus the answer already sits, when it does.
    foundIn: z.array(z.string()).default([]),

    // Verified work that is related without establishing the requirement. This
    // is a question to ask, never a conclusion in either direction.
    adjacentClaimIds: z.array(z.string()).default([]),

    // What the candidate could actually do next. A route that ignores their
    // time is not a route, so effort and horizon are required.
    routes: z.array(z.object({
      kind: z.string().min(1),
      action: z.string().min(1),
      effort: z.enum(["minutes", "hours", "days", "weeks"]),
      horizon: z.enum(["today", "this_week", "this_application", "next_role"]),
      target: z.string().default(""),
    }).strict()).default([]),

    resolution: z.enum([
      "pending",
      "source_added",
      "candidate_has_no_evidence",
      "not_applicable",
    ]).default("pending"),
  }).strict()).default([]),
  notesForHuman: z.array(z.string()).default([]),
}).strict();
