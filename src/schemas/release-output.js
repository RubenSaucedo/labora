import { z } from "zod";

export const ZReleaseOutput = z.object({
  schemaVersion: z.literal("1.0"),
  state: z.enum(["send_ready", "human_review", "blocked"]),
  generatedAt: z.string(),
  artifact: z.object({
    path: z.string().min(1),
    type: z.enum(["docx", "pdf"]),
    hash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  }).strict(),
  hardBlockers: z.array(z.string()),
  reviewReasons: z.array(z.string()),
  gates: z.object({
    strategy: z.boolean(),
    claims: z.boolean(),
    artifact: z.boolean(),
    requirements: z.boolean(),
    coreRequirements: z.boolean(),
    atsJudge: z.boolean(),
    engineerJudge: z.boolean(),
    hrJudge: z.boolean(),
  }).strict(),
}).strict();
