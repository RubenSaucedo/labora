---
name: resume-tailor
description: "Produces one truthful tailored resume from the identity record, claims, and job-spec; maps every bullet and displayed skill to verified claims, then runs structured coverage and deterministic claim validation."
tools: [bash, view, glob, grep, edit, create]
user-invocable: false
---

# resume-tailor

Load `resume-conventions`.

When this skill runs inside `resume-writer-expert`, load
`references/senior-swe-writing.md` before drafting. Its examples teach sentence
shape only and never ground a fact.

**Inputs:** `profile/generated/identity.json`, `profile/generated/claims.json`,
`profile/generated/accomplishments.json`,
`applications/<slug>/{job.md,job-spec.json,application-strategy.json}`.

**Outputs:** `resume.json`, `ats-results.json`,
`validations/claims.json`.

## Content contract

- Contact stays blank.
- Preserve stable experience IDs and exact company/role/period values.
- Copy `progression` verbatim from the identity record for every experience that
  has it. Verified progression can be useful context, but no hiring effect is
  assumed and low-information nodes are withheld. Never invent, re-date, or
  re-label a step: an internal ladder token renders through its
  `externalLabel`, and an `internal_only` step does not render at all. Copy
  `externalLabelKind` unchanged when present: absent uses conservative lexical
  filtering, while `scope_change` is an explicit profile-level decision that a
  verified career jump should remain visible. `label`, `externalLabel`,
  `externalLabelKind` and `date` are each checked against the identity record,
  so tailoring cannot promote or suppress a step by rewriting its semantics.
- Every bullet maps to one or more verified claim IDs. Prefer one claim per
  bullet. Where a bullet needs two, no validator can check that the outcome in
  one record belongs to the subject in the other, so the bullet is reported as
  `uncertain` rather than verified — write two bullets instead of one that only
  stands when both records are read together.
- Every displayed skill maps to verified claim IDs and exists in the identity record.
- Education matches the identity record exactly.
- Projects, certifications, and awards are a catalog: render any subset that
  earns its space for this job, and never an entry the identity record does not
  contain. Prefer recent, role-relevant credentials over completeness; a long
  tail of unrelated certifications dilutes the relevant ones. Rebuild identity
  from source when those facts change instead of enriching them during tailoring.
  A catalog entry is matched on what renders, so a project's `claimIds` may
  travel with it or not — that field is provenance for the identity record, and
  it is never compared and never rendered.
- Internal provenance is never prose for the recruiter.
- `keywords_mapped` is deprecated; leave it empty.
- Never create unsupported metrics, technologies, scope, titles, dates, or
  qualifications.

## Compose the summary

Write from `firstPagePlan.summaryPlan`, not from a list of themes. The summary
is 2-3 natural sentences in this order:

1. **Identity** — what kind of engineer this is, the supported tenure or
   recognizable-employer anchor, and the core stack/end-to-end scope.
2. **Recent proof** — the selected `primaryUnitId`, using the exact supported
   contribution level and one concrete system, lifecycle boundary, or
   consequence.
3. **Differentiator** — only when the plan selected one; name the memorable
   artifact, project, or unusual capability.

Treat 40-70 words as an editorial heuristic, never a hard gate. Weave target
keywords into the narrative; do not append a skills list. Do not repeat the
headline, open with a generic title plus gerund ("Software engineer
building..."), or use "hands-on work in" when the selected unit supports an
ownership verb. Never join unrelated accomplishment units into one lifecycle.
Do not assert Senior, Staff, or Principal unless that level appears in a
verified title.

Record `provenance.summary` sentence by sentence. Each entry carries the exact
rendered sentence and exhaustive clauses in order; each clause maps directly to
its `claimIds` and `unitIds`. Clause text must cover the whole sentence so no
material phrase inherits global provenance. `summaryClaimIds` is legacy-only
and must remain empty for new resumes.

Before accepting the summary, review internal jargon, leadership/ownership
verbs, launch or completion terms, plural artifacts, ongoing-maintenance
claims, and durable-runtime language. If the mapped claim does not directly
support the wording, change the wording rather than widening provenance.

## Compose the headline

`ats_title` is the most-read line in the document and, historically, the least
guided one in this plugin — the whole instruction was "truthful headline", and
the whole enforcement was a substring check. Truthful is necessary and nowhere
near sufficient: a headline can be perfectly truthful and still be generic,
redundant, or misleading about positioning.

Read the headline as two different kinds of statement:

- **Positioning** — the role. "This is the job I am applying for." It is
  anchored by the posting and needs no ledger support.
- **Qualifiers** — every other segment. Each one asserts a capability or a
  domain, and is an assertion exactly like a bullet.

Map every qualifier in `provenance.headline` as `{term, claimIds}`, using the
whole segment as the term. "Distributed systems" is one assertion; splitting it
into two words grounds neither.

Then, per qualifier:

1. **Prefer the posting's own phrasing** when both phrasings are true. The
   posting is already parsed into `job-spec.json`; check it before debating
   wording.
2. **Watch for domain-term collision.** A requisition title often contains a
   word the employer uses for a *narrow* capability while the same word has a
   broad generic meaning the evidence genuinely supports — "workflows",
   "platform", "runtime", "infrastructure". Copying the title silently adopts
   the narrow reading, and that is precisely the reading hardest to defend in an
   interview. `headline_requirement_collision` names these; resolve each one
   rather than shipping past it.
3. **Never headline what the body cannot carry.** If `gaps_or_risks` records a
   requirement as uncovered, the headline may not assert it. A document that
   documents a gap and headlines it is one file arguing with itself.
4. **Drop low-information terms**: a protocol name (an implementation detail,
   not an engineering identity), a table-stakes technology the body already
   carries, and abstract suffixes that add no constraint.

The headline is a promise about what the candidate wants to be interviewed on,
not a summary of everything the evidence permits. A term the evidence supports
but the candidate does not identify with belongs in the body, where it is
*evidence* rather than *identity*. Declining it is a legitimate call — record it
in `notes_for_human` rather than re-litigating it next run.

**Nothing here blocks.** `headline_term_unmapped`, `headline_term_unattested`
and `headline_requirement_collision` are warnings, and
`headline_term_absent_from_posting` is neutral information — a term the posting
never uses may be exactly the differentiator worth leading with. Lexical signals
never gate a release.

*Sourcing note:* resume-headline advice online is dominated by vendors selling
optimization services, publishing no methodology and recycling each other's
statistics. The widely quoted multipliers for headline placement have no sample,
controls, or model behind them. The rules above are grounded in this artifact's
own inputs — the parsed posting and the claim ledger — rather than in that
literature, and no claim about ATS ranking behaviour is made anywhere.

Tailor through ordering, selection, precise phrasing and emphasis. Use natural,
direct American English. Avoid buzzwords and generic AI phrasing. Numeric claims
must appear verbatim in mapped facts.

Follow the private application strategy:

- make the first third communicate its candidate narrative and top signals;
- lead with the mapped claims in `firstPagePlan.leadClaimIds`;
- order supported skills according to `firstPagePlan.skillsOrder`;
- address likely concerns only with verified evidence;
- do not proceed while strategy status is `needs_evidence` or `blocked`.

## Select units before drafting prose

Draft from `unitShortlist`, not from the raw ledger. For each shortlisted unit,
read its claims in `accomplishments.json` and write at most one or two bullets
from it. This keeps one bullet to one piece of work, prevents the same story from
appearing twice under different wording, and stops unrelated claims from being
merged into a single sentence that no source supports as a whole.

Two rules follow from the unit fields:

- Never merge outcomes across units, and never merge two outcomes measured
  differently within a unit. A unit's `outcomes[].confidence` distinguishes
  `production_measured` from `development_measured`; presenting a
  development-measured number as production impact is a fabrication an
  interviewer will find.
- Respect `evidenceStrength`. Lead with `strong` units. A `moderate` or `weak`
  unit may still earn a bullet, but phrase it so the stated `limitations` remain
  true — if the limitation says a figure is self-reported or manually measured,
  do not imply fleet telemetry.

If a shortlisted unit yields no bullet that survives claim validation, drop the
unit and say so; do not reach for a stronger-sounding phrasing.

Optimize multiple objectives together: factual validity, role relevance,
specificity, credibility, readability, and concise proof. Do not increase lexical
coverage by making the resume denser, repetitive, or less natural.

## Coverage loop

1. Ensure `resume-job-analysis` has produced `job-spec.json` and that
   `application-strategy.json` carries a validated `unitShortlist`.
2. Draft `resume.json` from the shortlisted units and `summaryPlan`, with
   complete clause-level summary provenance.
3. Run `score-ats` with `--job-spec <application>/job-spec.json`.
4. Run `validate-claims` and save `validations/claims.json`.
5. Revise at most twice, but only by surfacing already verified claims.
6. Keep the highest truthful requirement coverage with zero claim-validation
   errors.

Targets:

- claim validation: **zero errors**;
- headline warnings: resolved or explained in `notes_for_human`. They never
  block, and shipping past one silently is how a headline reaches four
  revisions with a human doing all the noticing;
- supported required requirements: explicitly surfaced;
- `must_have_missing`: honest unsupported requirements, never fabricated away;
- lexical coverage: diagnostic only, not a release threshold.

Save scoring history with metric version, lexical coverage, structured
requirement coverage, full requirement evaluations, and missing required lines.
Record `tailor` and `validate_claims` with `run-state`.
