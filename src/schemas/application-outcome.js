import { z } from "zod";

export const OUTCOME_EVENTS = [
  "submitted",
  "acknowledged",
  "recruiter_screen",
  "hiring_manager_screen",
  "technical_interview",
  "onsite_or_final",
  "offer",
  "rejected",
  "withdrawn",
  "no_response",
];

export const ZApplicationOutcomeEvent = z.object({
  type: z.enum(OUTCOME_EVENTS),
  at: z.string().datetime(),
  channel: z.string().default(""),
  note: z.string().default(""),
  source: z.literal("operator").default("operator"),
}).strict();

export const ZApplicationOutcome = z.object({
  schemaVersion: z.literal("1.0"),
  application: z.string().min(1),
  currentStatus: z.enum(["not_submitted", ...OUTCOME_EVENTS]),
  updatedAt: z.string().datetime(),
  events: z.array(ZApplicationOutcomeEvent),
}).strict();
