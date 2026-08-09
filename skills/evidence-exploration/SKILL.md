---
name: evidence-exploration
user-invocable: false
description: "The output contract for exploring something the persona built — a live product, a deployed service, a public site. Splits the neutral observation record (which grounds claims) from the evaluative report (which does not). Load before any exploration that is meant to produce evidence."
---

# Evidence exploration

Load `resume-conventions` first, and read `PHILOSOPHY.md` §4.

An exploration produces **two artifacts, never one**:

| Artifact | Answers | May ground a claim? |
| --- | --- | --- |
| `observations.json` | What did the system do when acted upon? | **Yes** |
| the written report | Is it any good? What should change? | **No** |

They are separate because they have different truth conditions. An observation
is falsifiable by repeating the steps. An evaluation is a judgment, and a
judgment laundered into evidence is how a resume acquires a sentence nobody can
defend in an interview.

## Why this exists

A general-purpose exploration agent produces a QA report: a list of what is
wrong. Run that against something the persona built and two failures follow.

First, the output is **unusable as evidence** — `profile-builder` cannot derive
a claim from "the onboarding felt confusing", so the exploration establishes
nothing and the work is repeated.

Second, and worse, the persona's own shipped product comes back looking like a
liability. A defect list is the correct output when you are deciding whether to
release software. It is the wrong output when you are establishing that someone
built and shipped a working system. Both readings are true of the same product;
only one of them is what the exploration was for.

## The observation contract

Every observation carries four fields. None is optional.

- **`observed`** — what the system did, in behavioural terms. Not what it is
  built with, not how it felt.
- **`verifiedHow`** — the steps and **the measurement**. "Created 3 plans,
  hard-reloaded, all 3 present after 24h" is a verification. "It persisted" is
  a summary of one. `labora validate-observations` rejects impressions and
  flags any verification with no number in it.
- **`supports`** — the capability this is evidence for, stated no wider than
  the check.
- **`doesNotEstablish`** — the boundary. **Every observation has one.** A live
  URL establishes existence and reachability; it does not establish authorship,
  users, scale, quality, or impact. A single-user session does not establish
  concurrency. Without this field, derived claims silently overreach — and the
  boundary is exactly what an interviewer probes first.

Claims derived from an observation **inherit its `doesNotEstablish`**. That is
the mechanism, not an aspiration: a claim whose scope exceeds its observation's
boundary is unsupported.

### Tiers

Evidence differs in who can re-verify it, and that changes how it may be
presented — never whether it counts.

| Tier | Meaning |
| --- | --- |
| `publicly_reproducible` | A reviewer can repeat the steps unaided. |
| `operator_reproducible` | Repeatable with access the operator can grant (a demo, a login, a walkthrough). |
| `point_in_time` | Observed once, on a date, and not currently re-checkable. |

`operator_reproducible` is **not** a lower grade of evidence. Most production
work is behind a login or an NDA. A private repository backing a live product is
an access constraint, not an absence — see `PHILOSOPHY.md` §4. Record the tier
and let the presentation stage decide the phrasing.

## Contradictions are first-class

When an observation contradicts something the ledger already asserts, it goes in
`contradictions`, not in a footnote — with the `claimId`, both the assertion and
what was observed, and the same `verifiedHow` rigor. A contradiction buried in
prose is a contradiction that ships to an employer.

You **report** it. You never edit the ledger to match.

## Defects are an appendix, and never block

Real defects found in the persona's own product are worth writing down; they are
useful feedback and they are honest. They go in `defectAppendix` with
`blocking: false`, which the validator enforces rather than merely requests.

A defect never lowers, gates, or qualifies a positive finding. A working system
with rough edges is a working system. If the exploration returns only defects, it
has produced no evidence and must be re-run against the behaviour, not the
polish.

## Procedure

1. Decide what the exploration is meant to **establish**, and write those
   questions down before opening the browser. An exploration without a question
   returns a defect list by default.
2. Exercise behaviour: create, save, reload, log out and back in, revisit. State
   surviving a round trip is the observation that matters; visual polish is not.
3. Record each finding with all four fields, its tier, and its date.
4. Write `observations.json` under
   `<workspace>/personas/<name>/evidence/<category>/<date>/`, alongside the
   report. Never overwrite an older dated directory.
5. Run `labora validate-observations <path> --output <path>/validation.json`.
   Fix what it rejects; do not route around it.
6. Hand back to `profile-builder`. It is the only stage that may turn any of
   this into a claim.

## Acceptance

`profile-builder` must be able to derive claims from `observations.json` alone,
without consulting the session transcript. If it needs the transcript, the
record is incomplete — that is the test.
