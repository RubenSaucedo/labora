import { z } from "zod";
import { ZBlankContact, ZEducation, ZProject, ZCertification, ZAward, ZProgressionStep } from "./identity.js";
import { ZResumeProvenance } from "./provenance.js";

export const ZTailoredExperience = z.object({
  id: z.string().default(""),
  company: z.string().default(""),
  role: z.string().default(""),
  period: z.string().default(""),
  bullets: z.array(z.string()).default([]),
  // Copied from the identity spine so a promotion inside a long tenure survives
  // into rendering. Claim-gated like any other rendered content.
  progression: z.array(ZProgressionStep).default([]),
}).strict();

// Renamed from `evidence_from_core`: the term "core" re-seeded the idea of a
// pre-baked core resume in the tailor's context. Evidence now comes from the
// claim ledger. Legacy documents are accepted and migrated on read.
export const ZKeywordMapping = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!("evidence_from_core" in value)) return value;
  const { evidence_from_core: legacy, ...rest } = value;
  return { ...rest, evidence: rest.evidence ?? legacy };
}, z.object({
  keyword: z.string(),
  evidence: z.string(),
}).strict());

export const ZTailoredResume = z.object({
  schema_version: z.literal("3.0").default("3.0"),
  target_role: z.string().default(""),
  ats_title: z.string().default(""),
  contact: ZBlankContact,
  summary: z.string().default(""),
  skills_primary: z.array(z.string()),
  skills_secondary: z.array(z.string()),
  experience: z.array(ZTailoredExperience).default([]),
  education: z.array(ZEducation).default([]),
  projects: z.array(ZProject).default([]),
  certifications: z.array(ZCertification).default([]),
  awards_or_contributions: z.array(ZAward).default([]),
  keywords_mapped: z.array(ZKeywordMapping).default([]),
  gaps_or_risks: z.array(z.string()).default([]),
  notes_for_human: z.array(z.string()).default([]),
  provenance: ZResumeProvenance.default({
    summaryClaimIds: [],
    bullets: [],
    skills: [],
  }),
}).strict();
