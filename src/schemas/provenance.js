import { z } from "zod";

export const ZSourceReference = z.object({
  path: z.string().min(1),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  page: z.number().int().positive().nullable().default(null),
  extraction: z.enum(["markdown", "pdf-text", "ocr", "manual"]).default("markdown"),
  confidence: z.number().min(0).max(1).default(1),
}).strict();

export const ZClaim = z.object({
  id: z.string().min(1),
  type: z.enum([
    "identity",
    "role",
    "skill",
    "achievement",
    "metric",
    "education",
    "certification",
    "project",
    "award",
  ]),
  fact: z.string().min(1),
  period: z.string().default(""),
  sources: z.array(ZSourceReference).min(1),
  status: z.enum(["verified", "needs_review", "rejected"]).default("verified"),
  // Confidentiality controls. `public` claims render as-is. `internal_generalizable`
  // claims render via `externalFact`, which must itself be grounded in `fact` plus
  // `externalSources`. `internal_only` claims may inform strategy but never render.
  disclosure: z
    .enum(["public", "internal_generalizable", "internal_only"])
    .default("public"),
  externalFact: z.string().default(""),
  externalSources: z.array(ZSourceReference).default([]),
}).strict();

export const ZClaimLedger = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  generatedAt: z.string().default(""),
  claims: z.array(ZClaim),
}).strict();

export const ZBulletProvenance = z.object({
  experienceId: z.string().min(1),
  bulletIndex: z.number().int().nonnegative(),
  claimIds: z.array(z.string()).min(1),
}).strict();

export const ZSkillProvenance = z.object({
  skill: z.string().min(1),
  claimIds: z.array(z.string()).min(1),
}).strict();

// The headline is an assertion like any other, so it needs the same kind of
// mapping the summary and every bullet already carry. `term` is a headline
// segment rather than a word, because "distributed systems" is one assertion
// and splitting it destroys the thing being grounded.
//
// Defaulted to empty rather than required: a resume tailored before this field
// existed is out of date, not invalid, and the validator reports the absence
// as a warning instead of refusing to read the file.
export const ZHeadlineProvenance = z.object({
  term: z.string().min(1),
  claimIds: z.array(z.string()).min(1),
}).strict();

export const ZResumeProvenance = z.object({
  summaryClaimIds: z.array(z.string()).default([]),
  bullets: z.array(ZBulletProvenance).default([]),
  skills: z.array(ZSkillProvenance).default([]),
  headline: z.array(ZHeadlineProvenance).default([]),
}).strict();
