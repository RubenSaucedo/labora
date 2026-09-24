# Summary altitude and placement

Every example here is synthetic. Never copy a technology, metric, scope or
outcome from this file into a resume.

## The mission

> The Summary gives the reader the high-level interpretation of the resume. It
> establishes identity, level, relevant scope and differentiated value.
> Experience and Projects prove that proposition; Technical Skills makes exact
> technologies retrievable.

A Summary can be fully supported, structurally compliant, free of comma-lists,
and still spend the most-read sentences in the document on implementation
detail. The defect is placement, not truth, and truth checks cannot see it.

## Six editing rules

1. **Do not use the Summary as a compressed Skills section**, even when every
   term is supported.
2. **Before keeping a technology or mechanism, ask whether it changes the
   candidate's professional identity** or is merely evidence for it. Evidence
   belongs where it is evidence.
3. **When a term creates technical ambiguity, first test whether the term
   belongs in the Summary at all.** Do not default to stacking qualifiers.
4. **Prefer supported system scope**, lifecycle ownership, production
   responsibility, organisational leverage, or independently inspectable work.
5. **Keep exact mechanism, modality and protocol names in Experience bullets**
   unless one is central to the target role and genuinely differentiating.
6. **Check the headline, Technical Skills and body before repeating a keyword.**
   Do not spend Summary space to duplicate retrieval coverage the document
   already has.

## Rule 3 is the one that gets missed

Synthetic. An internal component name is ambiguous to an outside reader:

> Built a response-synthesis layer.

The instinct is to narrow it:

> Built a **text-based** response-synthesis layer.

That is more precise and still at the wrong altitude — it has told a recruiter
about a component they cannot place, in the sentence meant to tell them who this
person is. The repair is to raise, not qualify:

> Led agent work from architecture through production.

The exact modality and mechanism then live in an evidence-bearing Experience
bullet, where they are the point rather than an interruption.

`summary_qualifier_stacked_on_ambiguous_term` fires when a revision keeps every
word of an approved sentence and adds modifiers to a mechanism. It is advisory:
sometimes the qualifier really is the repair. It is asking you to have made the
decision, not telling you which one.

## Rule 6 and the coverage trap

Synthetic. A posting mentions adapter contracts, protocol integrations,
concurrency, graceful degradation, latency and observability. Optimising the
Summary in isolation produces:

> Software engineer building registry-backed adapter contracts, protocol
> integrations, request-scoped concurrency, graceful degradation, measured
> latency improvements, and observability.

Every noun may be true and evidence-backed. It is still a regression:

- the Summary became a compressed Technical Skills section;
- career scope was replaced by mechanisms;
- the sentence reads as assembled from retrieval terms rather than written;
- Experience and Skills already had better places to carry the exact terms.

`keyword_placement_regression` fires only when all three hold: the term appears
in the posting, the document already carries it accurately elsewhere, and the
*approved baseline did not put it in the Summary*. That last condition is what
separates a deliberate choice from coverage-chasing — a person put it there, and
this is not the place to argue with them.

## What the Summary must not borrow

Seniority, scale, adoption and timing words read as ordinary resume register, so
they get copied from a posting without ever being treated as claims:
`real-time`, `at scale`, `production-scale`, `widely adopted`, `Senior`. Each of
those is an assertion needing a source. `unsupported_posting_term_added` is an
error rather than advice, because it crosses an evidence boundary.

Its message says the **corpus** is silent, never that the candidate lacks the
thing. That distinction is not decoration; it is the difference between a gap
report and a verdict about a person.

## Do not generalise away the specialisation

Raising altitude is not a licence to vague. If a technology *is* the target
specialisation, naming it in the Summary is the correct altitude — it is the
professional identity, not a mechanism supporting it. Generalising it away
would remove the very thing the resume is meant to lead with.
