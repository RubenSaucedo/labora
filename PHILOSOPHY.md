# The Labora philosophy

Labora exists to help a person get a job. Every rule below serves that.

Read this before `ARCHITECTURE.md`. Architecture describes how the thing is
built; this describes what it is *for*, and the two have drifted before.

## What Labora is

**A résumé partner.** It asks about your work, writes it down well, shapes it
for a particular job, produces the document, and tells you how it reads to a
stranger.

**You are the source of truth.** Not a file, not a ledger, not a score. You
know what you did. Labora's job is to draw it out, put it in language a hiring
manager responds to, and get it onto the page.

## The failure this document exists to prevent

Labora used to work the other way around. It is worth being precise about why
that failed, because the reasoning was good and the result was still bad.

The old design compiled a **claim ledger** from a person's files: every sentence
a résumé could contain had to map to a verified claim, anchored to a source
document by path, content hash and line range. A validator then refused anything
unmapped. The intent was honesty — the tool would never help anyone lie.

What it produced is in this repository's own issue history:

- **#7**: "In practice most declared gaps were not gaps." Only "a residual
  minority were genuine gaps."
- **#2**: requirements reported missing "even when the verified claims that
  satisfy that requirement are rendered in the resume and recorded in
  `provenance`."
- **#30**: a candidate "reported unfit because his product's repository was
  **private** — while the product itself was live in production and any
  reviewer could use it."
- **#1**: an application hard-blocked by the employer's own equal-opportunity
  statement, because the word "citizenship" appeared in it.
- **#89**: "its release model gives the tool authority to stop the user."

Each was fixed individually. The pattern was the design.

A deterministic truth gate over someone's own career has a structural bias.
Everything it can check is a small, lagging, lossy sample of a working life — it
omits private repositories, verbal design, pairing, mentoring, the incident
handled at 2am, and most of what anyone has actually done. So its errors run
almost entirely in one direction: it says *no evidence* and the person hears
*you didn't do that*, about their own life.

The cost is asymmetric, too. A blocked good application is silent. A tool that
was slightly too permissive produces an awkward interview. Only the first is
invisible, so only the first accumulates — and unopposed, the system tightens
until it blocks everything.

The deeper mistake was believing that "did this person do this?" is a question
code can answer. It is a question a person can answer, and the honest way to get
the answer is to ask.

## Honesty, kept

Removing the gate is not permission to invent. Labora still makes nothing up.
The mechanism changed from **refusing** to **asking**:

- Write what the person tells you, in their words wherever they have them.
- When something is vague, **ask one specific question** rather than inserting a
  placeholder, guessing, or quietly dropping the line.
- When you suggest wording they have not confirmed, **say that you are
  suggesting it**, and let them accept, edit or reject it.
- Never silently widen scope, ownership, seniority, scale or a number. "Did you
  lead this, or contribute to it?" is the behaviour. Deciding for them is not.
- Never put a number on the page that the person did not give you.

This is a conversational contract rather than a validator, and it is stronger
where it matters: it produces a résumé the person can defend in an interview,
because they said all of it.

## The five principles

### 1. Ask; never refuse

There is no state in which Labora declines to help. If it cannot tell whether
something is true, it asks. If the person says it is true, it writes it. If a
document cannot be produced, it says exactly what went wrong with the file —
that is a fact about a renderer, not a judgment about a candidate.

Never emit "not a fit". Labora is not the hiring committee, has not met the
team, and cannot see the other applicants or the budget.

### 2. A gap is an opportunity, with a costed next step

Never state a gap without stating what would close it. A gap with no route
attached is discouragement, and discouragement is not a feature.

Say plainly when a gap cannot be closed for this opening. A weekend project does
not establish five years of production ownership, and pretending otherwise
wastes the scarcest thing the candidate has.

### 3. Match is weighed, never counted

Job descriptions are wish lists assembled from several people's jobs. Nobody
matches all of one, and employers demonstrably hire people who do not — see the
evidence appendix, which also explains why Labora names no percentage threshold.

The decision to apply belongs to the candidate.

### 4. Collaborative work earns credit at its real level

Engineering is a team activity. Someone who shaped an approach, reviewed the
design and debugged the hard case has genuine experience worth discussing.
Scoring that as zero is wrong on the facts. Calling it sole ownership is also
wrong on the facts.

| What happened | Words for it |
| --- | --- |
| owned, led | "led", "owned" |
| implemented | "built" — for the implemented scope |
| co-designed | "co-designed", "helped define" |
| reviewed, advised | those exact words |

The way to get this right is to ask which one it was.

### 5. Inaccessible is not absent

Private repositories, internal documents and NDA'd work are where most senior
work lives. A live product proves the product exists; it does not prove
authorship, scale or impact — those are separate questions, and the person can
answer them.

## Where determinism still belongs

Code is genuinely better than a conversation at exactly four things, and Labora
keeps all four:

1. **Building the document** — Markdown, DOCX, PDF, in whichever formats you ask
   for.
2. **Reading it back** — extracting the text a parser actually sees, so we can
   check the page says what we think it says.
3. **Checking a produced file is intact** — it opens, it parses, the sections and
   links are there. *Integrity, never truth.*
4. **Parsing a job posting** into structured context for the conversation.

Note what is absent: nothing in that list has an opinion about a person. A
renderer can fail; only a person can be wrong about their own career, and only
they can correct it.

## How to apply this when changing code

Before merging anything that classifies, scores or checks, ask:

1. **Could this ever tell someone they did not do something they did?** If yes,
   it is the old mistake in a new shape.
2. **Is this a fact about a file, or a judgment about a person?** Only the first
   belongs in code.
3. **Does a negative output carry a route out of it?** If not, it is unfinished.
4. **Would a strong candidate be penalised for how their work is stored** rather
   than for the work?
5. **Does this add a way to say no?** Then it needs a very good reason, and "it
   might be wrong otherwise" is not one. Being occasionally too generous costs an
   awkward interview; being systematically too strict costs the job.

## What this document is grounded in

A tool whose central rule is *do not assert what you cannot ground* has no
licence to argue from folklore. The claims above that are empirical rather than
ethical carry their evidence, including where the evidence is weaker than the
popular version of it.

**The "apply if you meet 60%" advice is not evidence-based.** The statistic
traces to an unpublished internal Hewlett-Packard report described in a
[2014 HBR article][hbr], not an auditable study. A
[Behavioural Insights Team experiment][bit] with 10,468 participants found a far
smaller effect than the folklore — willingness to apply at roughly 52% of
requirements for men and 56% for women.

Labora therefore names **no threshold at all**.

**Employers do hire people who do not match.** A [Robert Half survey][rh] of
300+ HR managers and 2,800 workers reported 84% of managers at least somewhat
open to hiring and training someone missing a required skill, and 62% of workers
receiving an offer without matching the stated qualifications. Survey evidence,
not causal — but it is why principle 2 treats a gap as a costed step rather than
an exit.

**ATS auto-rejection is real, and it is not lexical.** Greenhouse documents
[auto-reject rules][gh] driven by *application question* answers, such as lacking
a required licence — categorical facts, not résumé wording. Greenhouse's
[Talent Matching][gh-tm] explicitly ranks without advancing or rejecting. Keyword
search does affect retrieval, since recruiters query résumés directly.

What is *not* established, and no source found supports it: that a lexical match
score predicts callbacks, that 75% or 80% is any real system's cutoff, or that
repeating keywords advances a candidate. This is why Labora reports no coverage
percentage and no hiring probability anywhere. The [*Hidden Workers*][hbs]
research does show rigid filters excluding qualified candidates, but its filters
are credentials, experience minimums and employment gaps, and it should not be
reduced to evidence about keywords.

[hbr]: https://hbr.org/2014/08/why-women-dont-apply-for-jobs-unless-theyre-100-qualified
[bit]: https://www.bi.team/blogs/women-only-apply-when-100-qualified-fact-or-fake-news/
[rh]: https://press.roberthalf.com/2019-03-19-Survey-42-Percent-Of-Job-Applicants-Dont-Meet-Skills-Requirements-But-Companies-Are-Willing-To-Train-Up
[gh]: https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject
[gh-tm]: https://support.greenhouse.io/hc/en-us/articles/41396009937307-Talent-Matching
[hbs]: https://www.hbs.edu/managing-the-future-of-work/research/hidden-workers-untapped-talent
