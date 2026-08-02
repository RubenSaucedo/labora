import { z } from "zod";

const YEAR_MONTH = /^\d{4}-\d{2}$/;

// A unit is a pointer, not a fact. `title` and `externalTitle` are retrieval labels
// and are never rendered; every renderable sentence still comes from a claim.
export const ZAccomplishmentUnit = z.object({
  id: z.string().min(1),
  experienceId: z.string().min(1),
  title: z.string().min(1),
  externalTitle: z.string().default(""),
  kind: z.enum([
    "delivery",
    "performance",
    "reliability",
    "platform",
    "quality",
    "leadership",
    "design",
    "research",
  ]),
  startDate: z.string().regex(YEAR_MONTH),
  endDate: z.string().regex(YEAR_MONTH).nullable().default(null),
  ongoing: z.boolean().default(false),
  contribution: z.enum([
    "sole_owner",
    "tech_lead",
    "major_contributor",
    "contributor",
    "reviewer",
  ]),
  scope: z.object({
    surface: z.string().default(""),
    audience: z.string().default(""),
    repos: z.array(z.string()).default([]),
    partnerTeams: z.array(z.string()).default([]),
    productionExposure: z.enum([
      "shipped_ga",
      "staged_rollout",
      "private_preview",
      "internal_only",
      "prototype",
    ]),
  }).strict(),
  techStack: z.array(z.string()).default([]),
  outcomes: z.array(z.object({
    claimId: z.string().min(1),
    metric: z.string().min(1),
    direction: z.enum(["reduced", "increased", "achieved"]),
    confidence: z.enum([
      "production_measured",
      "development_measured",
      "projected",
      "unmeasured",
    ]),
  }).strict()).default([]),
  evidenceStrength: z.object({
    tier: z.enum(["strong", "moderate", "weak"]),
    sourceKinds: z.array(z.enum([
      "pr_body",
      "commit_title",
      "performance_review",
      "wiki",
      "calendar",
      "chat_email",
      "self_report",
    ])).min(1),
    artifactCount: z.number().int().nonnegative().default(0),
    corroboratingSources: z.number().int().nonnegative().default(1),
    limitations: z.array(z.string()).default([]),
  }).strict(),
  disclosure: z.enum(["public", "internal_generalizable", "internal_only"]),
  claimIds: z.array(z.string()).min(1),
  supersedes: z.array(z.string()).default([]),
}).strict();

export const ZAccomplishmentBank = z.object({
  schemaVersion: z.literal("1.0"),
  persona: z.string().min(1),
  generatedAt: z.string().default(""),
  units: z.array(ZAccomplishmentUnit),
}).strict();
