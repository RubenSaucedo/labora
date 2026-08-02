import { z } from "zod";

const ZScoreStats = z.object({
  count: z.number().int().nonnegative(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  stdev: z.number().nullable(),
}).strict();

const ZModelStats = ZScoreStats.extend({
  verdicts: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

const ZJudgeCalibrationEntry = z.object({
  sampleCount: z.number().int().nonnegative(),
  verdictDistribution: z.record(z.string(), z.number().int().nonnegative()),
  scoreStats: ZScoreStats,
  byModel: z.record(z.string(), ZModelStats),
  byPromptHash: z.record(z.string(), ZModelStats),
  drift: z.record(z.string(), ZScoreStats),
}).strict();

/** Aggregate output of src/lib/judge-calibration.js. */
export const ZJudgeCalibration = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string().min(1),
  sampleCount: z.number().int().nonnegative(),
  applicationCount: z.number().int().nonnegative(),
  judges: z.object({
    ats: ZJudgeCalibrationEntry,
    engineer: ZJudgeCalibrationEntry,
    hr: ZJudgeCalibrationEntry,
  }).strict(),
  agreement: z.object({
    completeApplications: z.number().int().nonnegative(),
    unanimousPositive: z.number().int().nonnegative(),
    unanimousNegative: z.number().int().nonnegative(),
    split: z.number().int().nonnegative(),
    unanimousRate: z.number().nullable(),
    scoreCorrelation: z.object({
      ats_engineer: z.number().nullable(),
      ats_hr: z.number().nullable(),
      engineer_hr: z.number().nullable(),
    }).strict(),
  }).strict(),
}).strict();
