---
name: resume-application-strategy
description: "Builds a claim-grounded positioning brief before tailoring: the three strongest hiring signals, likely objections, first-page proof hierarchy, and targeted evidence questions. It distinguishes evidence absent from experience absent and never treats a chat answer as verified evidence."
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: false
---

# resume-application-strategy

Load `resume-conventions`.

**Inputs:** `profile/generated/claims.json`, `profile/generated/accomplishments.json`,
`profile/background.md`, optional `profile/career.md`, cleaned
`evidence/performance-reviews/**/text/*.md` and
`applications/<slug>/{job.md,job-spec.json}`.

Read the full corpus, not just the shortlist you expect to use. `background.md`,
`career.md` when present, and the cleaned per-review evidence carry narrative and
durable facts that never reach the tailor, so this is the only stage that sees
them. Treat any strong signal you find there but
cannot ground in a claim as an evidence gap to raise, not as something to drop.

**Outputs:** `applications/<slug>/application-strategy.json` and
`applications/<slug>/validations/strategy.json`.

This is a private planning artifact. It is never rendered into the resume.

## Procedure

1. Identify the three strongest verified reasons the candidate could earn an
   interview. Map each reason to verified claim IDs and relevant requirement IDs.
2. Identify likely screening concerns. Distinguish:
   - `supported`: verified evidence exists;
   - `unsupported`: the current corpus has no support;
   - `uncertain`: the corpus is ambiguous or incomplete.
3. For each unsupported or uncertain hard/core requirement, formulate one
   concrete evidence question. Ask the operator one question at a time.
4. A conversational answer is a lead, not verified evidence. To use it, the
   operator must add a durable source to `profile/background.md`, `profile/career.md`
   or the evidence corpus, then rerun `resume-persona`.
5. Shortlist accomplishment units. Run
   `labora rank-accomplishments <accomplishments.json> <job-spec.json>`
   for a deterministic starting order, then record `unitShortlist` entries with a
   `rank`, the requirement IDs each unit genuinely covers, and a one-line
   rationale. The ranking is an input to your judgment, not a verdict: promote a
   weaker-scoring unit when it is the only proof of a core requirement, and demote
   a strong one that repeats a story already covered. Only map a requirement to a
   unit when one of that unit's verified claims actually supports it —
   `unit_requirement_mismatch` will reject wishful mappings.

   Validation raises `missed_evidence` when a requirement is supported by
   verified claims that no shortlisted unit surfaces and that you never assessed.
   Treat it as the system telling you the candidate can prove something you
   overlooked: shortlist the unit that carries it, lead with it, or record
   explicitly why it is not worth the space.
6. Build a first-page plan: truthful headline, up to three summary themes, lead
   claim IDs, and supported skill order. Prioritize recent, role-relevant proof.
7. Set status:
   - `ready`: no pending evidence questions;
   - `needs_evidence`: at least one question remains pending;
   - `blocked`: a confirmed hard-eligibility condition cannot be met.
8. Validate:
   `labora validate-application-strategy <strategy.json> <job-spec.json> <claims.json> --accomplishments <accomplishments.json> --output <validations/strategy.json>`.
9. Record `application_strategy` with `run-state`.

Never convert an unsupported requirement into a claim, imply that ledger absence
proves the candidate lacks experience, or optimize around a confirmed eligibility
blocker.
