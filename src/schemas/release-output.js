import { z } from "zod";
import { FINDING_STATUSES } from "../lib/findings.js";

const ZAgentModel = z.object({
  agent: z.string().min(1),
  // null means no model name is configured and the runtime applies its own
  // default, or that the configuration could not be read at all. `source`
  // distinguishes the two: it is null only when nothing was resolved.
  model: z.string().nullable(),
  source: z.string().min(1).nullable(),
  label: z.string().min(1),
}).strict();

export const ZFinding = z.object({
  id: z.string().regex(/^f-[a-f0-9]{12}$/),
  source: z.string().min(1),
  code: z.string().min(1),
  status: z.enum(FINDING_STATUSES),
  finding: z.string().min(1),
  location: z.string(),
  basis: z.array(z.string()),
  suggestedActions: z.array(z.string().min(1)).min(1),
}).strict();

/**
 * The gate may write only these two states. `operator_approved` is absent on
 * purpose: it is recorded in a separate file by an explicit operator action, so
 * this schema cannot express a tool-authored approval even by mistake.
 */
export const ZReleaseOutput = z.object({
  schemaVersion: z.literal("2.0"),
  state: z.enum(["review_ready", "generation_failed"]),
  generatedAt: z.string(),
  artifact: z.object({
    path: z.string().min(1),
    type: z.enum(["docx", "pdf"]),
    hash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  }).strict(),
  findings: z.array(ZFinding),
  findingSummary: z.object(
    Object.fromEntries(FINDING_STATUSES.map((status) => [status, z.number().int().min(0)]))
  ).strict(),
  // Evidence, not authority. Retained so a reader can see which perspectives
  // held up; nothing may turn a `false` here into a refusal.
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

/**
 * Written only by `labora approve`, only from an explicit operator action.
 *
 * It binds to one exact artifact hash and one exact set of finding IDs. Both
 * are required: approving an artifact without recording what was known about it
 * would let a later run introduce an unsupported claim under cover of an
 * approval the operator gave to a different document.
 */
export const ZReleaseApproval = z.object({
  schemaVersion: z.literal("1.0"),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/i),
  decision: z.literal("approved_by_operator"),
  acceptedFindingIds: z.array(z.string().regex(/^f-[a-f0-9]{12}$/)),
  decidedAt: z.string(),
  note: z.string().nullable().default(null),
}).strict();
