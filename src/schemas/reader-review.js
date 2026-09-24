import { z } from "zod";

/**
 * The cold-reader contract.
 *
 * A recruiter or hiring manager sees the rendered resume and the posting. They
 * do not see the evidence corpus, the internal glossary, the rollout mechanics,
 * or the argument the author had with themselves about a verb. So a review that
 * *can* see those things cannot answer the only question that matters here:
 * what does this sentence mean to someone who has none of it.
 *
 * The isolation is therefore the feature. This input has three fields and no
 * way to carry a fourth.
 */

export const READER_AUDIENCES = ["recruiter", "engineering_manager", "technical_screener"];

export const ZColdReaderInput = z.object({
  schemaVersion: z.literal("1.0"),
  audience: z.enum(READER_AUDIENCES),
  // The rendered document, as text. Not `resume.json`: the JSON carries
  // provenance, notes and gaps, none of which a reader ever sees.
  resumeText: z.string().min(1),
  postingText: z.string().default(""),
}).strict();

export const ZColdReaderObservation = z.object({
  // The exact phrase as it appears in the rendered text, so the authoring stage
  // can find it without the reader needing to know internal addresses.
  phrase: z.string().min(1),
  section: z.string().default(""),
  // 1. What does this appear to mean?
  likelyInterpretation: z.string().min(1),
  // 3. What materially different interpretation is also plausible?
  competingInterpretation: z.string().default(""),
  // 4. What would the reader have to ask before this is useful?
  readerQuestion: z.string().default(""),
  // 5. If the phrase were removed, would the reader lose meaningful information?
  contributesMeaning: z.boolean(),
  code: z.enum([
    "context_dependent_term",
    "rollout_label_without_scope",
    "internal_role_label",
    "unresolved_scale_or_denominator",
    "opaque_component_name",
    "reader_scope_ambiguity",
    "true_but_noncommunicative",
    "cold_reader_question_required",
    "understood",
  ]),
  severity: z.enum(["error", "warning", "info"]).default("warning"),
}).strict();

export const ZColdReaderReport = z.object({
  schemaVersion: z.literal("1.0"),
  audience: z.enum(READER_AUDIENCES),
  // Bound to the exact text that was read, so a report cannot be carried
  // forward onto a document it never saw.
  inputHash: z.string().regex(/^[a-f0-9]{64}$/i),
  observations: z.array(ZColdReaderObservation).default([]),
  // The cold reader identifies ambiguity. It does not author the repair: it
  // cannot, because it has no evidence to repair against, and a repair invented
  // without evidence is exactly the fabrication the rest of the pipeline exists
  // to prevent.
  notes: z.array(z.string()).default([]),
}).strict();
