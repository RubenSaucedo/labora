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
3. **Triage before you call anything a gap.** Run:

   ```
   labora triage-gaps <persona> --requirements <job-spec.json> --output validations/gap-triage.json
   ```

   Most declared gaps are not gaps. Each unmatched requirement comes back as
   one of five statuses, which need five different actions and must never share
   one bucket:

   | Status | What it means | What to do |
   | --- | --- | --- |
   | `unmined` | The corpus already answers it in the candidate's own voice; no claim was derived | Re-run `profile-builder`. **Do not ask the operator.** |
   | `mention_only` | The corpus discusses it, but no sentence says *the candidate* did it | Ask one scoped question quoting the passage |
   | `collectible` | Obtainable from something the candidate already owns and can reach | Take the named route — usually minutes |
   | `adjacent` | Verified work overlaps the requirement without establishing it | Ask one scoped question only when the overlap is substantive; otherwise re-read the corpus without interrupting the operator |
   | `real_gap` | Nothing in the corpus, nothing reachable, nothing adjacent | State it as an absence, never a disqualification |

   `unmined` is a statement about labora's bookkeeping. `real_gap` is a
   statement about a corpus. **Neither is a statement about a person.**

   `mention_only` exists because the opposite error is just as bad. A corpus
   note reading "Priya owns the eval harness" contains the word, so counting it
   as coverage closed the requirement — no question asked, no route offered,
   and a resume that quietly implies work someone else did. Coverage and
   absence are both inferences there; the honest output is a question.

   When asking about a `mention_only`, **quote the corpus passage, not the
   requirement.** Reading the requirement back supplies the answer.

4. Take every `collectible` route before writing the requirement out as a gap.
   Asking a human is the slowest path available and yields self-report rather
   than evidence, so it is the last resort and never the first move. Evidence
   collection also validates: an observation run once contradicted a claim
   already marked verified, and skipping it lets that reach a rendered resume.

5. For substantive `adjacent` work, ask **one scoped question that names the
   verified work**, so the candidate confirms a specific boundary instead of
   self-assessing. A recognized skill or multiple reinforcing shared terms,
   including at least one term that distinguishes this claim, can justify that
   question; one rare ordinary word cannot. Incidental overlap remains
   `adjacent`, preserving the generous direction of failure, but routes to
   corpus review instead of interrupting the operator. Someone who shipped
   agent workflows and reviewed a colleague's evaluation harness in detail does
   not "lack evals" — and also cannot claim to have built one. Both are true at
   once, so the honest move is a question, never a verdict in either direction.

6. A conversational answer is a lead, not verified evidence. To use it, the
   operator must add a durable source to `profile/background.md`, `profile/career.md`
   or the evidence corpus, then rerun `resume-persona`. **Flexible in what you
   ask about, rigid in what you print.**

7. A `real_gap` is not a reason to stop. Nobody matches a full job description;
   postings routinely list everything anyone on the team touches. Report it with
   what the candidate could build or learn if it matters for the roles they are
   targeting, and let them decide.
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
6. Build a first-page plan: headline, a narrative `summaryPlan`, lead claim IDs,
   and supported skill order. Prioritize recent, role-relevant proof.

   `summaryPlan` is not a topic bundle. It selects the evidence and sentence
   order before the writer drafts:

   - `identity`: what kind of engineer this is, a supported tenure or
     recognizable-employer anchor, and the core stack plus end-to-end scope.
     Record the supporting `claimIds` and `unitIds`.
   - `recentProof`: one recent, role-relevant accomplishment. Record the exact
     `contributionLevel`, one concrete system/lifecycle/consequence,
     supporting `claimIds`, and exactly one `primaryUnitId`. Every selected
     claim must belong to that unit; a separate delivery milestone cannot be
     borrowed to make the accomplishment look end-to-end.
   - `differentiator`: optionally select one memorable public artifact, project,
     or unusual capability with its `claimIds` and `unitIds`. Select none rather
     than filling the slot with a generic skill.

   The headline is not one string to be judged "truthful". It is a role
   (positioning, anchored by the posting and needing no support) plus
   qualifiers, and every qualifier asserts a capability that must map to
   verified claims. Prefer the posting's own phrasing where both are true;
   never propose a qualifier for a requirement `likelyConcerns` records as
   unresolved. `resume-tailor` composes and maps it; this step decides what it
   should say.
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
