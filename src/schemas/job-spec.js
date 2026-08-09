import { z } from "zod";

export const ZJobRequirement = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "skill",
    "years",
    "degree",
    "authorization",
    "clearance",
    "license",
    "responsibility",
    "other",
  ]),
  priority: z.enum(["required", "preferred", "responsibility"]),
  severity: z.enum(["hard_eligibility", "core", "preferred", "soft_signal"]),
  text: z.string().min(1),
  sourceLine: z.number().int().positive(),
  canonicalTerms: z.array(z.string()).default([]),
  surfaceForms: z.array(z.string()).default([]),
  matchMode: z.enum(["all", "any", "threshold"]).default("threshold"),
  minimumYears: z.number().nonnegative().nullable().default(null),
});

export const ZNonRequirement = z.object({
  text: z.string().min(1),
  sourceLine: z.number().int().positive(),
  reason: z.enum(["eeo", "compensation", "benefits"]),
});

export const ZJobSpec = z.object({
  schemaVersion: z.literal("1.0"),
  title: z.string(),
  company: z.string(),
  sourcePath: z.string().default(""),
  aliasVersion: z.string(),
  requirements: z.array(ZJobRequirement),
  // Posting prose that reads as boilerplate. Advisory only: these lines are
  // still extracted and scored, because a wrongly removed requirement is
  // invisible in the score while a retained one is merely noisy.
  // Defaulted so a spec written before this field existed still parses.
  nonRequirements: z.array(ZNonRequirement).default([]),
});
