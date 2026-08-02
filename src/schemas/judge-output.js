import { z } from "zod";

export const ZJudgeMetadata = z.object({
  rubricVersion: z.string().min(1),
  model: z.string().min(1),
  evaluatedArtifactHash: z.string().regex(/^[a-f0-9]{64}$/i),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/i),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/i),
  evaluatedAt: z.string().datetime(),
}).strict();

export const ZAtsJudgeOutput = z.object({
  metadata: ZJudgeMetadata,
  score: z.number().min(0).max(100),
  verdict: z.enum(["pass", "marginal", "fail"]),
  screeningRisk: z.enum(["low", "moderate", "high"]),
  reasoning: z.string(),
  details: z.object({
    matchedSignals: z.array(z.string()).default([]),
    missingSignals: z.array(z.string()).default([]),
    recommendations: z.array(z.string()).default([]),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const expected = value.score >= 80 ? "pass" : (value.score >= 60 ? "marginal" : "fail");
  if (value.verdict !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verdict"],
      message: `ATS verdict must be ${expected} for score ${value.score}.`,
    });
  }
});

export const ZEngineerJudgeOutput = z.object({
  metadata: ZJudgeMetadata,
  score: z.number().min(0).max(100),
  verdict: z.enum(["advance_to_onsite", "phone_screen", "lean_no", "no"]),
  seniorityAssessment: z.object({
    claimedLevel: z.string().default(""),
    evidencedLevel: z.string().default(""),
    notes: z.string().default(""),
  }).strict(),
  technicalDepth: z.object({
    score: z.number().min(0).max(100),
    strengths: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
  }).strict(),
  credibility: z.object({
    score: z.number().min(0).max(100),
    concerns: z.array(z.string()).default([]),
  }).strict(),
  scopeAndImpact: z.object({
    score: z.number().min(0).max(100),
    notes: z.string().default(""),
  }).strict(),
  redFlags: z.array(z.string()).default([]),
  recommendations: z.array(z.object({
    priority: z.enum(["high", "medium", "low"]),
    action: z.string(),
    expectedImpact: z.string().default(""),
  }).strict()).default([]),
  reasoning: z.string(),
}).strict().superRefine((value, ctx) => {
  const expected = value.score >= 85
    ? "advance_to_onsite"
    : (value.score >= 70 ? "phone_screen" : (value.score >= 50 ? "lean_no" : "no"));
  if (value.verdict !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verdict"],
      message: `Engineer verdict must be ${expected} for score ${value.score}.`,
    });
  }
});

export const ZHrRecommendation = z.object({
  priority: z.enum(["high", "medium", "low"]),
  action: z.string(),
  expectedImpact: z.string().default(""),
}).strict();

export const ZHrAgentFeedback = z.object({
  agent: z.string(),
  feedback: z.array(z.string()).default([]),
}).strict();

export const ZHrJudgeOutput = z.object({
  metadata: ZJudgeMetadata,
  score: z.number().min(0).max(100),
  screenRecommendation: z.enum(["strong_advance", "advance", "review", "decline"]),
  reasoning: z.string(),
  sixSecondScan: z.object({
    passed: z.boolean(),
    notes: z.string().default(""),
  }).strict(),
  visualReview: z.object({
    reviewed: z.boolean(),
    pageCount: z.number().int().nonnegative(),
    concerns: z.array(z.string()).default([]),
  }).strict(),
  strengths: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
  roleFit: z.object({
    score: z.number().min(0).max(100),
    matchSummary: z.string().default(""),
    matchedSignals: z.array(z.string()).default([]),
    missingSignals: z.array(z.string()).default([]),
  }).strict(),
  recommendations: z.array(ZHrRecommendation).default([]),
  detailedFeedback: z.record(z.string(), z.array(z.string())).default({}),
  agentFeedback: z.array(ZHrAgentFeedback).default([]),
}).strict().superRefine((value, ctx) => {
  const expected = value.score >= 90
    ? "strong_advance"
    : (value.score >= 75 ? "advance" : (value.score >= 60 ? "review" : "decline"));
  if (value.screenRecommendation !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["screenRecommendation"],
      message: `HR recommendation must be ${expected} for score ${value.score}.`,
    });
  }
});
