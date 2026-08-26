# The Labora philosophy

Labora exists to help a person get a job. Every rule below serves that.

Read this before `ARCHITECTURE.md`. Architecture describes how the
pipeline is built; this describes what it is *for*, and the two have
drifted before.

## The failure this document exists to prevent

Labora is an assurance pipeline. Assurance pipelines drift toward
saying no, because saying no is always defensible and never visibly
wrong. A gate that blocks a good application produces silence. A gate
that passes a bad one produces a bad interview. Only the second failure
is ever felt, so unopposed, the system tightens until it blocks
everything.

That drift already happened here, repeatedly:

- A candidate was reported unfit because his product's repository was
  **private** — while the product itself was live in production and any
  reviewer could use it. The pipeline confused *we cannot read the
  source* with *there is no evidence*.
- An application was **hard-blocked from release** by the employer's own
  equal-opportunity statement, because "citizenship" appeared in it.
- A requirement was reported missing while the claim satisfying it was
  **already rendered on the resume**.

None of these were exotic. They are what an assurance system does by
default. Resisting that default is the work.

## The distinction everything rests on

> **"We have no evidence of X" is not "the candidate lacks X."**

Labora only ever observes its own corpus. The corpus is a small,
lagging, lossy sample of a career — it omits private work, verbal
design, pairing, mentoring, incidents handled at 2am, and the large
majority of what anyone has actually done.

So the absence of a claim is a fact **about Labora**, never a fact about
the person. Labora may not infer person-level absence from corpus
silence. It may report a **candidate-confirmed** absence, or one
established by explicit current contrary evidence. Nothing else.

## Three questions, never merged into one

Most of the damage in this repository came from a single verdict
answering three unrelated questions. They are separated permanently:

| Dimension | Asks | Values |
| --- | --- | --- |
| `artifact_assurance` | Is this document honest and intact? | `pass` / `findings` |
| `eligibility` | Does a categorical requirement bar this application? | `met` / `unmet` / `unknown` |
| `application_outlook` | How strong does this look? | `strong` / `plausible` / `low` / `unknown` |

Rules:

- **Nothing Labora concludes blocks the operator.** Every evidence,
  claim, eligibility, strategy, coverage and judge concern is a
  **finding**: what was established, what was not, and the smallest
  next action. A finding is reported, never enforced. The person whose
  career this describes decides what to send.
- **The only non-review state is a missing artifact.** If rendering did
  not produce a document, Labora reports `generation_failed` — not a
  veto, simply the truthful statement that there is nothing to review
  yet. Everything else is `review_ready`.
- **Only a *confirmed* unmet categorical requirement is reported as
  unsupported.** `unknown` prompts a question.
- **A weak outlook is an estimate.** Judge verdicts are simulations of
  external screening behaviour, not facts about the candidate. A
  `decline` is reported as an estimate and labelled as one.
- **Labora never authors the decision to send.** There is no
  tool-written `send_ready`. `operator_approved` is recorded only by an
  explicit human act, bound to one exact artifact hash and one exact
  finding set, and it stops applying the moment either changes.

How a statement came to be believed is recorded on it, always:
`verified` (established from mapped evidence), `user_attested` (the
operator confirms it and Labora cannot independently check),
`uncertain` (inconclusive), `unsupported` (this corpus does not support
it). None of these prevents generation. Hiding the difference between
them would be the real dishonesty; refusing to render is merely
paternalism, and it was never Labora's to exercise.

This resolves the tension between autonomy and assurance honestly.
Labora reports everything it found and nothing it did not, and then
gets out of the way. An assistant that stops a person from describing
their own work has confused a heuristic with a fact, and the cost of
that confusion falls entirely on the applicant.

## The five principles

### 1. A gap is an opportunity, with a costed next step

Never state a gap without stating what would close it. A gap with no
route attached is discouragement, and discouragement is not a feature.

A route is only useful if it is honest about price and payoff, so every
route states:

- **Effort** — minutes, hours, weeks, or longer.
- **Horizon** — does this help *this* application, or later ones?
- **Kind** — does it surface evidence you already have, or build
  capability you do not?
- **Leverage** — could it actually change the recommendation?

Say plainly when a gap cannot be closed for this opening. A course does
not close a five-year production-experience requirement, and a weekend
project does not establish enterprise-scale ownership. Pretending
otherwise wastes the scarcest thing the candidate has.

End with a choice, not a verdict: **apply now**, **clarify first**, or
**deprioritise**. Ask at most three evidence questions before handing
control back.

### 2. Match is weighed by severity, not counted

Job descriptions are wish lists assembled from several people's jobs.
Nobody matches all of one, and employers demonstrably hire people who do
not — see the evidence appendix, which also explains why labora names no
percentage threshold.

But coverage is weighed, never tallied: eight peripheral matches do not
outweigh missing the role's central capability. Labora may call an
application **low-priority** when explicit eligibility gaps or several
central-capability gaps make the expected return poor. That is
prioritisation across a finite week, not a judgment about the person.

Never emit a verdict of the form "not a fit". Labora is not the hiring
committee, has not met the team, and cannot see the other applicants or
the budget. **The decision to apply belongs to the candidate.**

### 3. Collaborative experience earns credit at its real level

Engineering is a team activity, and someone who shaped an approach,
reviewed the design and debugged the hard case has genuine experience
worth discussing in an interview. Scoring that as zero is wrong on the
facts.

Crediting it as ownership is also wrong on the facts. Contribution
levels stay distinct, and so do their verbs:

| Evidenced contribution | Permitted language |
| --- | --- |
| owned, led | "led", "owned" |
| implemented | "built" — for the implemented scope only |
| co-designed | "co-designed", "helped define" |
| reviewed, advised, brainstormed | those exact verbs |

Adjacent evidence scores `partial`, never `full`. It triggers a
**neutral factual question**, and the question may not smuggle in its
own answer:

> Your evidence covers agent workflows and skills. Did you define
> evaluation criteria, review eval results, or shape what "good" meant?
> If so, tell me specifically what you did and I can ground a claim on
> it.

Not *"evaluation usually rides along with that, so you probably…"*.
Adjacent evidence prompts investigation; it never establishes
likelihood. This is how truthfulness and flexibility coexist: Labora
widens what it **asks about**, never what it **asserts**.

### 4. Inaccessible evidence is not absent evidence

Private repositories, internal documents, NDA'd work and closed
performance reviews are where most senior work lives. Treating
"unverifiable by us" as "untrue" systematically penalises exactly the
people with the most substantial experience.

So judge the strength of the underlying signal and record honestly how
it was attested — but a source only ever supports the proposition it
actually supports. **A live production URL verifies that a product
exists and is reachable. It does not verify authorship, sole
authorship, user counts, quality, ownership, or impact.** Each of those
needs its own source.

Candidate attestation may ground a self-reported claim after explicit
confirmation. Its evidence tier remains self-reported, and rendering
preserves the attested scope and contribution.

**"Verified" means the claim faithfully matches an approved source. It
does not mean independently corroborated.** Do not let the word drift.

### 5. Say when you cannot tell

Uncertainty needs somewhere to go that is neither a gap nor
encouragement. Every finding carries one of:

- `supported` — an approved source states it.
- `partial` — a source supports a narrower proposition than the
  requirement.
- `unknown` — the corpus is silent. **Not a deficit.**
- `unsupported-by-current-corpus` — searched, found nothing, and the
  search itself is reported.
- `contradicted` — explicit current evidence says otherwise.

Report confidence separately for requirement extraction and for evidence
matching; they fail independently. Do not print a numeric confidence
that has not been calibrated against labelled examples.

## Eligibility gates are conversations, not walls

Some requirements are genuinely categorical — work authorization,
clearance, a licence. Detect them accurately: a candidate deserves to
know before investing hours.

Detecting one is a prompt to act early, not a verdict.

- Say what the posting requires and how confident the reading is.
- Say what the candidate would need to confirm.
- Suggest raising it with the recruiter early, while noting honestly
  that doing so costs time and is visible to screening.
- **Do not assert that a requirement is negotiable** unless the posting,
  the recruiter, or published employer policy says so. Otherwise the
  status is *policy unknown* — genuinely different from *no*.
- Never silently drop an application. If a gate blocks send-readiness,
  say why in one sentence, with the route.

## How to apply this when changing code

Before merging anything that classifies, scores, or gates, ask:

1. **Which direction does this fail?** Prefer the failure the human can
   see and correct. A visible false alarm beats an invisible deletion.
2. **Does it conclude something about the person, or about the corpus?**
   If the person, it is overreaching.
3. **Does the negative output carry a costed route?** If not, unfinished.
4. **Would a strong candidate be penalised for how their work is
   stored** rather than for the work?
5. **Does it print anything not mapped to a verified claim, or claim
   more than its source supports?** Either one, stop.
6. **Which of the three dimensions is this?** If an outlook signal is
   about to block an integrity gate, it is in the wrong column.

## Precedence

This is a division of authority, not a ranking.

- **`PHILOSOPHY.md` governs** product intent, candidate-facing
  interpretation, how findings are framed, and **which judgments are
  permitted to become hard gates**.
- **`ARCHITECTURE.md` and `skills/resume-conventions` govern** privacy,
  confidentiality, provenance, untrusted-input isolation, deterministic
  validity, artifact integrity, freshness, and judge isolation.

No empowerment argument overrides the second set. Truthfulness is not
the only non-negotiable: rendering an `internal_only` claim can be
perfectly truthful and still a serious breach.

Where the two genuinely conflict, **report the conflict** rather than
silently resolving it.

## What this document is grounded in

A tool whose central rule is *do not assert what you cannot ground* has
no licence to argue from folklore. So the claims above that are
empirical rather than ethical carry their evidence, including where the
evidence is weaker than the popular version of it.

**The "apply if you meet 60%" advice is not evidence-based.** The
statistic behind it traces to an unpublished internal Hewlett-Packard
report described in a [2014 HBR article][hbr], not an auditable study. A
[Behavioural Insights Team experiment][bit] with 10,468 participants
found a far smaller effect than the folklore — willingness to apply at
roughly 52% of requirements for men and 56% for women.

Labora therefore names **no threshold at all**. Principle 2 weighs
requirements by consequence precisely because no percentage is
defensible, and a tool that adopted 60% would be repeating a number
nobody has verified.

**Employers do hire people who do not match.** A [Robert Half survey][rh]
of 300+ HR managers and 2,800 workers reported 84% of managers at least
somewhat open to hiring and training someone missing a required skill,
and 62% of workers receiving an offer without matching the stated
qualifications. Survey evidence, not causal — but it is the reason
principle 1 treats a gap as a costed step rather than an exit.

**ATS auto-rejection is real, and it is not lexical.** Greenhouse
documents [auto-reject rules][gh] driven by *application question*
answers, such as lacking a required licence — categorical facts, not
resume wording. Greenhouse's own [Talent Matching][gh-tm] explicitly
ranks without advancing or rejecting. Keyword search does affect
retrieval, since recruiters query resumes directly.

What is *not* established, and no source found supports it: that a
lexical match score predicts callbacks, that 75% or 80% is any real
system's cutoff, or that repeating keywords advances a candidate.

This is why **lexical coverage may never block a release** and is never
reported as a probability of being hired. Coverage answers "would a
recruiter searching this term find this resume" — a retrieval question,
worth optimising, and not a forecast. The [*Hidden Workers*][hbs]
research does show rigid filters excluding qualified candidates, but its
filters are credentials, experience minimums and employment gaps, and it
should not be reduced to evidence about keywords.

[hbr]: https://hbr.org/2014/08/why-women-dont-apply-for-jobs-unless-theyre-100-qualified
[bit]: https://www.bi.team/blogs/women-only-apply-when-100-qualified-fact-or-fake-news/
[rh]: https://press.roberthalf.com/2019-03-19-Survey-42-Percent-Of-Job-Applicants-Dont-Meet-Skills-Requirements-But-Companies-Are-Willing-To-Train-Up
[gh]: https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject
[gh-tm]: https://support.greenhouse.io/hc/en-us/articles/41396009937307-Talent-Matching
[hbs]: https://www.hbs.edu/managing-the-future-of-work/research/hidden-workers-untapped-talent
