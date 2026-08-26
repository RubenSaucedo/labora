# Labora Architecture

## Objective

Produce truthful, job-relevant resumes with measurable confidence in:

1. source grounding;
2. required/preferred job coverage;
3. rendered-document parseability;
4. recruiter and technical-screen quality.

Interview probability remains outside the system boundary.

## Layers

### Reasoning

Copilot skills perform evidence cleaning, identity synthesis, job classification,
application positioning, tailoring, and role-specific evaluation. External text
is always treated as untrusted data.

### Deterministic assurance

Node tools own:

- raw evidence extraction hashes and numeric-cleaning checks;
- job requirement extraction;
- lexical and structured requirement scoring;
- claim provenance validation;
- contact source validation and injection;
- Markdown review-companion and DOCX/PDF rendering;
- renderer-input field recall and section order;
- content-hash freshness;
- final release-state aggregation.

## Domain artifacts

### Profile layout

The profile is split by **ownership** and **lifetime**, not by topic or file
type. Each file has one owner, one editing cadence, and one role in grounding:

```text
profile/                       human-authored sources
  contact.md                   edited freely      never grounds claims
  background.md                edited rarely      grounds claims
  career.md                    optional           grounds claims
  search-preferences.json      edited             trusted job-search config
  generated/                   machine-owned; written only by resume-persona
    README.md                  the ownership contract
    identity.json              structural spine
    claims.json                verified claim ledger
    accomplishments.json       retrieval index over the ledger
```

| File | Owner | Edited | Grounds claims |
|---|---|---|---|
| `contact.md` | human | freely | **no** |
| `background.md` | human | rarely | yes |
| `career.md` | human | optional; on review cycles | yes |
| `search-preferences.json` | human | freely | n/a (trusted config) |
| `generated/identity.json` | `resume-persona` | never by hand | n/a |
| `generated/claims.json` | `resume-persona` | never by hand | n/a |
| `generated/accomplishments.json` | `resume-persona` | never by hand | n/a |

The folder boundary encodes **ownership**, not file type — `search-preferences.json`
is JSON but human-authored, so it stays with the sources. Everything under
`generated/` is derived from the sources, is read by every downstream stage, and
is written by exactly one skill.

Ownership per directory is declared once, machine-readably, in
`src/lib/workspace-layout.js`; `skills/resume-conventions/SKILL.md` is its prose
form and `labora validate-workspace <persona>` reports divergence. This section
explains *why* the boundary exists — it is not a second declaration of *where*
it sits.

The compiled ledgers now sit at `.labora/state/profile/` for a new persona, and
stay at `profile/generated/` for one that already has them there;
`src/lib/profile-state.js` resolves which. The boundary this section describes is
unchanged by that — what moved is only whether machine state is presented to the
operator as a peer of the career history they wrote.

Hand-editing `generated/` is the failure mode this prevents. Claims are anchored
to their source by content hash and line range, so a hand-written claim either
fails validation or, worse, passes structurally while asserting something no
evidence supports. When a downstream stage finds something missing, that is an
evidence gap to report — the fix is to add evidence to a source and re-run
`resume-persona`, never to patch the artifact.

Two manifest tests enforce this: every `persona` stage output must resolve inside
`profile/generated/`, and no stage may declare a human-authored source as an
output.

These were one file, `context.md`, which fused all three roles. That coupling was
a live defect: claims are anchored to their source by content hash
(`source_hash_mismatch`), so editing a phone number rehashed the file and
invalidated every claim grounded in it — 22 on the reference persona. The most
frequently edited file was welded to the most frozen one. `contact.md` is now
excluded from `sourceMayGroundClaims`, which makes that class of breakage
unrepresentable.

The split also removed content that no consumer read: a written profile summary,
per-position resume bullets, and a hand-maintained technical-skills list. These
are the same anchoring hazard that schema 4.0 removed from `identity.json`, and
the skills list duplicated the allowlist that 4.0 replaced with a derived
vocabulary. They are now prohibited by the file's own header and by
`resume-persona`.

Self-reported bullets are kept only for a period with no richer evidence — on
the example persona, the earliest roles, which have no performance-review
corpus. Where `career.md` and the evidence corpus already cover a period, its
resume bullets are redundant *and* anchoring, so they are dropped.

A written summary is not the same as a tenure fact. `background.md` may carry a
`## Professional Profile` block of atomic fields (current title, years of
experience, focus) because atomic fields cannot be pasted into a resume as prose,
while a summary paragraph can.

### Evidence tiers

The approved grounding corpus is `profile/career.md`, `profile/background.md`,
cleaned `evidence/performance-reviews/**/text/**`, and
`evidence/repositories/<date>/repositories.md`. Everything else — including
`evidence/references/` — is readable context but cannot ground a claim.

`career.md` is optional. It exists for a persona whose period narrative is a
single hand-written timeline. When the same periods already exist as cleaned
per-review evidence, the timeline is a lossy duplicate of a stronger source: the
reviews are attested, `career.md` is self-reported, and maintaining both invites
them to disagree. Archive it in that case rather than keeping two versions of one
career. The reference persona did exactly this — its `career.md` grounded zero
claims while the 13 cleaned connects grounded dozens.

These sources differ in what a *reader* can check, which is what actually decides
how a fact may be presented:

| Tier | Example | Reader can verify |
| --- | --- | --- |
| Self-verifying | credential URL, public repository, reachable product URL | Yes, independently |
| Machine-retrievable | repository snapshot of a private repo | Re-fetchable by the operator, not by a recruiter |
| Attested | performance review, reference | Only via the employer |
| Self-reported | `background.md` bullets | No |

`snapshot-repos.js` writes the repository tier. Only the filename the tool emits
grounds claims, so a hand-written file cannot enter the corpus. Visibility is
recorded per repository: a private repository is real work but not inspectable by
a recruiter, and must never be presented as if it were. Commit counts measure
sustained activity, not impact, and never stand alone as a resume metric.

`--verify-urls` records whether each repository's homepage responds, which is how
a private repository can still carry self-verifying evidence: the source stays
closed while the shipped product remains open to any reader. The status is a
point-in-time observation, not a standing guarantee.

Repository claims must be grounded in *durable* fields. Commit counts and
last-pushed dates change on the next push, and claim facts are re-verified
against their source, so a volatile number in a fact breaks the ledger as soon as
the author commits again.

Re-running the snapshot changes the file's hash and every block's line numbers,
which strands every repository claim. `anchor-repo-claims.js` rebuilds them
deterministically: repository facts are mechanical derivations of a
tool-generated file, so they belong in code rather than in a model's judgement.
It preserves each claim's explicit `disclosure` value when one exists, omits
the key when no prior value exists, and reports claims whose repository has left
the snapshot instead of silently dropping them. Run it after every
snapshot:

```
labora snapshot-repos --persona <name> --verify-urls
labora anchor-repo-claims --persona <name>
```

### `profile/generated/claims.json`

A source-addressed ledger of verified facts. Claims have stable IDs, source file
hashes, line/page spans, extraction method, confidence and verification status.
Cleaned evidence is linked to an immutable mechanical extraction and raw PDF hash;
new numeric tokens introduced during cleaning are rejected.

Each claim also carries a `disclosure` level that governs whether and how it may
reach a rendered document:

| `disclosure` | Rendering behaviour |
| --- | --- |
| `public` | `fact` renders as-is. |
| `internal_generalizable` | Requires `externalFact`; the generalized wording is what bullets, skills and summaries validate against. `externalFact` may drop detail but may not introduce a number absent from `fact`, and every named or canonical term it uses must be supported by `fact` plus `externalSources`. |
| `internal_only` | May inform strategy and ranking, but grounding any rendered content in it raises `confidential_claim_rendered`. |
| _absent (unclassified)_ | May inform strategy and ranking, but grounding rendered bullet/skill/summary/headline/identity prose raises `claim_disclosure_unclassified`. |

This keeps confidentiality-safe phrasing validatable: without it, the only wording
that passes grounding is the wording that leaks the internal codename.

### `profile/generated/identity.json`

The identity spine (schema 4.0): contact placeholders, employers, roles,
employer-tenure periods, claim-backed `experience[].progression[]`, education,
projects, certifications and awards. Nothing in it is tailored. Formatters
render the employer and its tenure together, followed by the current role
without a date; they never borrow the employer start date as the role start
date. Verified progression dates remain a separate signal.

`progression[]` may render beneath its experience entry when at least two
externally legible events remain. By default the formatter suppresses known
generic placeholders, labels duplicating the experience heading, and
low-information lines. A profile may explicitly classify verified career jumps
as `externalLabelKind: "scope_change"` when no meaningful external title is
available; repeated jumps then collapse to "Promoted twice (2021, 2024)".
This is a product presentation policy, not a claim that promotion lines improve
hiring outcomes. Progression is gated exactly
like a bullet: the step must exist in the identity spine, carry verified
disclosable claims, and supply an `externalLabel` when the internal token is not
meaningful outside the company. An `internal_only` step never renders; a step
with no disclosure and an `internal_generalizable` step with no external label
are withheld from rendering and surfaced by validation.

A step is located in the spine by `label`, but `label` is not necessarily what
prints — `formatProgression` substitutes `externalLabel` whenever one is set,
applies optional `externalLabelKind`, and prints `date` beside it. So
`externalLabel`, `externalLabelKind`, and `date` are each required to match the
identity record (`progression_identity_changed`). Checking `label` alone would
leave rendered wording, visibility semantics, and year free to drift while the
step still resolved to a real, claim-backed promotion.

Composed prose in the spine carries explicit provenance in `claimIds`:
`projects[].description`, `projects[].highlights[]` and
`awards_or_contributions[].description`. Atomic fields such as a project `name`
are grounded by matching them against a source excerpt, but a description cannot
be checked that way — it is written *from* evidence rather than quoted from it,
so no substring match confirms it. Before 4.0.0 those fields were compared to
nothing, and because a resume project validates by exact-object match against
the spine, a description effectively validated against itself and could reach a
rendered document unsupported. The claims listed must exist, be `verified`, and
carry explicit disclosure that is not `internal_only`
(`claimProvenanceIssues`). Each prose fragment is then
checked against the mapped renderable claim facts for unsupported named,
canonical and numeric content plus substantive token coverage. Claim IDs prove
where prose came from; they do not make unrelated prose supported. A record
with no description and no highlights needs no `claimIds`, because it renders
no prose.

Upgrading to 4.0.0 makes a persona whose projects or awards carry undocumented
prose fail `validate-profile` with `identity_prose_unmapped`. That failure is the
defect surfacing, not a new restriction: the prose was always ungrounded. Rebuild
the spine through `profile-builder` so each description names the claims it was
composed from. If no claim supports a description, the description was never
supportable and belongs in a gap report rather than in a resume.

It was called `core-resume.json` through schema 3.0. The name was removed with
the fields, because a document named "resume" invites an agent to treat it as a
resume to edit — which is the anchoring behaviour 4.0 exists to prevent.

Schema 3.0 additionally carried `summary`, `key_achievements`, `experience[].highlights`
and `technical_skills`. All four were removed. The first three were a pre-baked
generic resume that anchored the tailor toward editing sample output instead of
composing from evidence. The fourth was worse: `technical_skills` was enforced as
an allowlist, so a hand-written list silently capped the resume below what the
ledger proved — on the reference persona it blocked 19 skills the claims
supported.

The displayable vocabulary is now derived from unit `techStack` terms minus
`identity.skill_vetoes` (`src/lib/skill-vocabulary.js`). An allowlist must enumerate
everything and therefore goes stale; a veto list enumerates only exceptions and
cannot fall behind the ledger. This is a labelling gate — a displayed skill must
still map to verified claims and survive claim grounding.

`src/lib/normalize-identity.js` reads either version and returns 4.0, preserving a
3.0 `technical_skills` list as `legacy_skills` so pre-bank personas stay
renderable.

### `profile/generated/accomplishments.json`

The retrieval index over the ledger. Each unit is one coherent piece of work and
carries only structured fields — `experienceId`, dates, `contribution`, `scope`
(surface, audience, repos, partner teams, production exposure), `techStack`,
`outcomes[]` (each pointing at a metric claim with a measurement `confidence`),
`evidenceStrength` (tier, source kinds, artifact count, stated limitations),
`disclosure` and `claimIds`.

Units deliberately hold no renderable prose: `title` and `externalTitle` are
retrieval labels, and every sentence that reaches a document still comes from a
claim. This makes shortlisting a job-relevant subset a ranking decision over
scalars and enums (`rankAccomplishments`) instead of a re-read of the full ledger,
and it keeps the number of bullets an agent must consider bounded as the ledger
grows.

`validateApplicationStrategy` additionally raises `missed_evidence` when a job
requirement is supported by verified claims that no shortlisted unit surfaces and
that the strategy never assessed. It blocks on `core` and `hard_eligibility`
requirements and warns on the rest. This is the anti-anchoring gate: it makes
"the candidate can prove this and we never looked" a machine-detectable failure
rather than something an agent has to remember to check.

`validateAccomplishments` enforces the invariants: claims must exist and be
verified, an outcome must belong to the unit that reports it, `experienceId` must
resolve in the identity record, date ranges must be coherent, `supersedes` must resolve, and a
unit may never declare itself less confidential than its most restricted claim.

### Identity sections: exact versus catalog

`education` must match the identity record exactly — a degree is not a per-job
selection, and dropping one misrepresents the record (`identity_section_mismatch`).

`projects`, `certifications` and `awards_or_contributions` are catalogs that grow
over a career. The resume may render any subset of the identity record but never
an entry outside it (`identity_section_unsupported`). Containment is what carries
the anti-fabrication guarantee; equality would only have added a completeness
rule that forces every credential onto every resume, which dilutes the relevant
ones. Omission is a tailoring decision, reviewed by strategy and the judges.

The check is multiset containment, so a resume cannot pad a section by repeating
one verified entry.

Containment is keyed on the fields a reader will see; `claimIds` is excluded
(`catalogKey`). Provenance records where a description came from and is stripped
before rendering, so comparing it would make a tailor that copied the visible
record faithfully but omitted the metadata fail as though it had invented the
entry — and would make the verdict depend on the order of the IDs.

### `applications/<slug>/job-spec.json`

Reviewable job constraints classified as required, preferred or responsibility.
Each also carries release severity: `hard_eligibility`, `core`, `preferred`, or
`soft_signal`. Compound requirements retain `all`/`any` semantics and exact
source text.

`nonRequirements` flags posting prose that reads as boilerplate — EEO
paragraphs, pay ranges, benefits blocks — with a reason for each. The flag is
**advisory: it never removes the line from the requirement set.** The line is
still extracted and still scored; the classification exists so a human can see
what the tool believes it is.

That is a deliberate reversal of an earlier design that dropped the flagged
lines, and it is the single most important property of this stage. The two
failure directions are not symmetric. A retained non-requirement is visible and
merely noisy. A dropped requirement is invisible: it leaves the scoring
denominator, so coverage rises and `core_requirements_missing` shrinks, and the
tool reports a better fit than the evidence supports. Adversarial review of the
subtractive design found that failure repeatedly and in ordinary prose — "Create
the pay range for each role based on qualifications and location", "Manage the
benefits package for all employees", "The candidate will manage the benefits
package" — each of which returned zero requirements and 100% coverage. Every fix
admitted the next construction, because deciding whose sentence a line is, from
prose alone, is not something pattern matching can be relied on to do. Removing
the subtraction removes the whole class of failure by construction rather than
by better patterns.

Separately, a line carrying a hard-eligibility gate is never flagged at all,
since scraped postings routinely run the gate and the legal footer together in
one unbroken paragraph.

This matters because a flat scraped posting has no headings, so the last section
seen carries forward to the end of the document and every trailing legal
paragraph lands inside "Requirements". Two failures followed from that, and both
are now regression-tested. An EEO paragraph reads "...without regard to national
origin, citizenship status..." and the bare token `citizenship` classified it as
`authorization`, which carries `hard_eligibility`, which no resume can satisfy,
which hard-blocks a legitimate application. In the other direction, "No visa
sponsorship is available" contains "sponsorship is available", so a
negation-blind guard downgraded a genuine gate to a soft signal and reported a
job as open to a candidate it excluded.

Both are fixed by classifying one **clause** at a time rather than one line at a
time, which is the unit the meaning actually lives in. Lines are split into
sentences and sentences into clauses, because a clause is the smallest span
whose subject and polarity are constant. A scraped paragraph routinely states
the gate and the legal footer together, so a whole-line verdict has to be wrong
about one of them: judged as a line, "U.S. citizens only. Acme is an equal
opportunity employer." either loses the gate or gains a false one. Clause scope
confines each signal to the span that carries it, so an EEO mention of
citizenship suppresses only its own clause, a sponsorship offer for a different
role cannot cancel a gate beside it, and "We do not require a degree, but
require U.S. citizenship" keeps the gate the disclaimer does not cover.

Clause splitting replaced two earlier attempts that both leaked in the dangerous
direction: bounded wildcards, which silently crossed clause boundaries, and then
positional arithmetic comparing where a disclaimer ended against where a demand
began, which could not help when the disclaimer's own span consumed the demand.
Splitting first makes the boundary explicit, and it degrades safely — an
over-split fragment is still classified on its own, and a fragment stating a
gate still produces one. Within a clause the order is precedence-based: an
explicit denial of sponsorship and an explicit demand on the applicant are
decided before any protective or EEO cue is consulted, and only genuinely
ambiguous phrasings fall through to them. Where a phrase is ambiguous the
classifier requires the clause to state an obligation, so "all employees have
the right to work in an environment free from discrimination" is not read as a
work-authorization gate.

The honest limit is that all of this is pattern matching over prose, so it is
accurate on the phrasings it has seen and silent about the rest. Known gaps are
tracked as issues rather than claimed as solved: employer-subject authorization
prose and administrative licence duties can still be misread as candidate gates.
That limit is exactly why the asymmetry is enforced structurally rather than
trusted. Classification can be wrong; it cannot delete a requirement.

### `applications/<slug>/application-strategy.json`

Private positioning brief with the three strongest claim-backed hiring signals,
likely objections, first-page proof hierarchy, and evidence questions. Its
`summaryPlan` selects an identity, one primary recent accomplishment unit, and
an optional differentiator before prose is drafted. A chat answer is not
evidence; new facts must enter the grounded corpus and claim ledger.

### `applications/<slug>/resume.json`

Public resume content plus private non-rendered provenance. Every bullet and
displayed skill maps to verified claims. Summary provenance is sentence- and
clause-level, with direct claim and accomplishment-unit mappings for every
material phrase. Contact fields remain empty.

### `applications/<slug>/final-resume-style-<N>.md`

A deterministic, editable review companion rendered from the same contact-
injected formatter projection as DOCX/PDF. It is tracked as a format output, so
manual edits make the stage stale. The file is never a claim source, judge input,
or selected delivery artifact; supported edits must be reconciled into
`resume.json`, claim-validated, and regenerated.

### `validations/*.json`

Deterministic reports for factual support and rendered artifact fidelity.

### `run.json`

Per-stage dependency and output hashes. A file is reusable only when its stage
fingerprint and output hashes remain unchanged.

### `release.json`

What the gate established, and nothing more:

- `review_ready`: an artifact exists; every concern is a finding carrying its
  status (`verified` / `user_attested` / `uncertain` / `unsupported`), its
  basis, and its suggested actions;
- `generation_failed`: the requested artifact was not produced.

There is no state in which the tool refuses. `gates` is retained alongside the
findings as evidence of which perspectives held up, but nothing may turn a
`false` there into a refusal.

### `release-approval.json`

Written only by `labora approve`, only from an explicit operator act. It names
one artifact hash and one set of acknowledged finding IDs, and it is the only
source of `operator_approved`. Keeping it in a separate file is what makes the
guarantee structural: the gate never opens it, so it cannot author an approval
even by mistake.

### `outcome.json`

Operator-confirmed funnel events such as submitted, recruiter screen, interview,
rejection, and offer. Outcomes are observational and never treated as causal
proof that a prompt or resume earned an interview.

## Pipeline

```text
resume-evidence
  -> resume-persona (identity + claims)
  -> resume-job-analysis
  -> resume-application-strategy
  -> resume-writer-expert (executes resume-tailor)
  -> validate-claims
  -> resume-format
  -> validate-artifact
  -> [ judge-ats | judge-engineer | judge-hr ]  (isolated sub-agents, parallel)
  -> resume-quality-gate
```

The `resume-build` conductor runs evidence, persona, job analysis, application
strategy, tailoring, and formatting in one shared context. It pauses for targeted
evidence questions before tailoring. The three judges are launched as **separate
sub-agents** and each reads one deterministic bundle containing only permitted
job/artifact inputs and hashes. They run in parallel and never read provenance,
generator rationale, or one another's output.

One bounded remediation cycle is allowed when existing verified claims can
address a finding. A real qualification gap is never fabricated away.

## Scoring

The deterministic scorer exposes separate diagnostics:

- `lexical_coverage_percent`;
- `requirement_coverage_percent`;
- `preferred_coverage_percent`;
- `responsibility_coverage_percent`;
- full matched/missing requirement evaluations.
- missing requirements grouped by release severity.

Internal provenance and keyword metadata are excluded. The renderer does not
append keyword lists.

Rendered-artifact validation optionally cross-checks parseability with a second
independent extractor (`validate-artifact --cross-parser`: OCR render for PDF,
mammoth HTML for DOCX). Fields the two parsers disagree on are advisory warnings
that flag documents likely to be mangled by a differing employer ATS; they never
flip the hard recall verdict.

The local versioned alias dictionary is intentionally conservative. O*NET or
ESCO-derived aliases may be added later, but semantic suggestions must never
override factual provenance.

Hard eligibility covers genuinely non-negotiable conditions such as work
authorization, required clearance, or required licensing. Missing core
capabilities produce human review rather than automatic rejection.

## Judge independence

All judges receive the actual selected DOCX/PDF delivery text and job description
through `prepare-judge-input.js`. The ATS judge additionally receives sanitized
deterministic ATS diagnostics—not `resume.json`. Prompt, input, and artifact
hashes identify exactly what was evaluated. The HR judge may view only the
generated page previews listed in its bundle.

The three judges are separate sub-agents (`judge-ats`, `judge-engineer`,
`judge-hr`) launched by the `resume-build` conductor, each in its own context.
Isolation is structural, not merely instructed: a judge sharing the conductor
context could see the tailoring rationale, so its verdict would no longer be
independent evidence.

`calibrate-judges.js` aggregates historical judge outputs into verdict/score
distributions, per-model and per-prompt-hash grading differences,
month-over-month drift, and cross-judge agreement (unanimity rate and score
correlation over complete applications). It is a deterministic observability
tool, not part of the release gate.

Its per-model breakdown groups on `metadata.model`, which is why that field must
not be a guess *and* must be a stable model identity. A judge cannot observe its
own model, so `judge-input.js` supplies the value from the resolved runtime
configuration (`copilot-settings.js`) and the quality gate compares it alongside
`evaluatedArtifactHash`, `promptHash`, and `inputHash`. A judge that authors the
field instead of copying it is reported as stale. The recorded value is the bare
model name (or `runtime-default`, or `unknown`), never a description of how the
model was reached — the same model inherited and explicitly pinned must land in
one calibration bucket, or drift analysis invents a model change that never
happened. Provenance lives in the separate `source` field.

`check-judge-models.js` reports whether any judge is configured off the
tailoring model. Its three exit codes keep apart three different answers:
diverse (`0`), not diverse (`1`), and unreadable configuration (`2`). Read
status is four-valued for the same reason: `missing` means the config directory
exists and configures nothing, while `unsupported` means there is no config
directory at all — under Claude Code, that is "unknown", not "nothing". When the
configuration is unknown, every per-agent field stays `null` rather than
defaulting to `differsFromTailor: false`, and the gate skips the `model`
comparison so an unreadable file cannot invalidate correct verdicts. The report
is recorded in `release.json` as `judgeModels` but does not affect the release
state — model choice is a property of the operator's runtime, and a signal that
fired on every default install would be ignored. The report carries its own
caveat string so no consumer can quietly upgrade "configured" into "observed".

## Job discovery (job-explorer)

A parallel system reuses the same evidence layer for finding openings, not just
tailoring to one:

```text
job-explorer (conductor)
  └─ scout-discovery → verified shared posting set
       ├─ scout-fit      → skills/domain/seniority vs. verified claims.json
       ├─ scout-market   → compensation, location/remote, company health
       └─ scout-growth   → roles that stretch toward stated goals
  → merge-candidates.js (deterministic reconcile) → candidates.json
  → report-candidates.js → report.md
```

- Inputs: `profile/search-preferences.json` (trusted config) + `claims.json`
  (grounding). Web pages the scouts browse are untrusted data, never instructions.
- Discovery verifies current postings and creates a shared deduplicated set.
  Every scoring scout evaluates every posting, so agreement represents
  independent judgment rather than search overlap. The collector retains the
  posting snapshot, verifies its hash and canonical job ID, and requires all
  timestamps to match the dated run in the configured IANA timezone.
- Identity: `canonicalJobId` primarily normalizes company|title|location so
  aggregator and official URLs collapse together.
- Consensus rule (`merge-candidates.js`): a job is promoted to a lead only when
  **≥ `minAgreement` (default 2) distinct angles** scored it, fit is at least 60,
  consensus is at least 70, the posting is not closed, and it is not in `avoid`.
  Fit scores at or above the floor must cite verified claim IDs and exact search
  preferences; unknown or unverified grounding fails reconciliation.
- Output lives at `<workspace>/personas/<name>/job-search/<run-date>/`, in the
  operator's private workspace outside this repo like the rest of persona data.
  A discovered job is a **lead**; promotion into
  `applications/<slug>/` is a separate operator-triggered step.
- Cross-run memory (`merge-candidates.js --seen job-search/seen.json`) keys on
  `canonicalJobId` so an overnight cadence highlights only genuinely new leads
  (`isNew`/`newLeadCount`) and never re-surfaces a posting the operator already
  applied to or ignored (`disposition`). `--suppress-seen` drops every
  previously-seen lead entirely. The ledger lives outside the dated run dirs.

## Privacy and safety

- **Persona data lives outside this repository.** labora is a plugin: it holds
  code and the synthetic `example` fixture, and no user data. Everything
  personal lives in an operator-owned workspace resolved by
  `src/lib/workspace.js` — normally just the directory you run from. This is a
  structural boundary, not a convention: a gitignore negation pattern
  (`data/personas/*` plus `!example/`) guarding performance reviews and
  compensation is one `git add -f` from failing, and there is no undo for
  disclosure. It also makes the plugin correct — the manifest declares labora
  installable, and an installed plugin's `process.cwd()` is the *user's*
  directory, where an in-repo `data/personas/` would not exist at all.
- **Provenance is persona-relative so it travels with the persona.** A claim
  source recorded as `data/personas/<n>/profile/background.md` only resolves from
  this repo's root and is stranded the moment the persona moves. Sources are
  stored relative to the persona root; `migrate-claim-sources.js` repoints legacy
  ledgers and refuses to write unless every source hashes identically to the
  value recorded at verification time, so a relocation can never silently change
  what a verified claim asserts.
- Contact is injected only at rendering.
- Evidence, OCR and job descriptions cannot alter system instructions.
- Job-search browsing is human-login-only, read-only, and never auto-applies.
- Validators and judges have least-privilege tool contracts.
- Human approval is required before sending.

## Evaluation strategy

Synthetic fixtures test:

- structured requirement parsing;
- unsupported additions and metric mutations;
- numeric facts introduced during evidence cleaning;
- duplicate claim reuse;
- hidden metadata contamination;
- validated contact-source injection and JSON-to-DOCX field recall;
- Unicode/contact/section preservation;
- content-hash invalidation;
- cross-parser recall divergence;
- job-search consensus and cross-run dedup;
- fit-required shared-candidate job scoring;
- application-strategy claim/requirement references;
- isolated judge input/prompt hashing;
- application outcome event ordering;
- judge calibration aggregation;
- adversarial inputs (prompt injection as inert data, fabricated tech/skills,
  authoritative-sounding evidence injection, stale-artifact judge/gate binding);
- structural judge isolation (judges never depend on provenance; strict output
  schema rejects smuggled provenance);
- quality-gate decisions.

These run entirely against the deterministic layer, so they are CI-stable and
model-agnostic. Model-in-the-loop calibration of judge verdicts against labeled
resumes (Promptfoo) is the deliberate follow-up: it belongs in an opt-in
`eval` target with credentials, never in the default CI suite.

Optional future integrations: Promptfoo for model-judge calibration, Apache Tika
for a third-party cross-parser comparison, JSON Resume import/export, and
O*NET/ESCO aliases.
