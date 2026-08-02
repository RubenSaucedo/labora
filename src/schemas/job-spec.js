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

export const ZJobSpec = z.object({
  schemaVersion: z.literal("1.0"),
  title: z.string(),
  company: z.string(),
  sourcePath: z.string().default(""),
  aliasVersion: z.string(),
  requirements: z.array(ZJobRequirement),
});
