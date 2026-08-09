import { z } from "zod";

const ZAgentModel = z.object({
  agent: z.string().min(1),
  // null means no model name is configured and the runtime applies its own
  // default, or that the configuration could not be read at all. `source`
  // distinguishes the two: it is null only when nothing was resolved.
  model: z.string().nullable(),
  source: z.string().min(1).nullable(),
  label: z.string().min(1),
}).strict();

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
  // Evidence, not a gate. Nullable because a record written before this field
  // existed is still a valid record.
  judgeModels: z.object({
    settingsPath: z.string(),
    status: z.enum(["ok", "missing", "unsupported", "error"]),
    error: z.string().nullable(),
    tailor: ZAgentModel,
    judges: z.array(ZAgentModel.extend({ differsFromTailor: z.boolean().nullable() }).strict()),
    diverse: z.boolean().nullable(),
    caveat: z.string(),
  }).strict().nullable().default(null),
}).strict();
