---
name: resume-editorial
description: Use when changing a résumé that already exists — tailoring to a posting, revising after review, cutting for space — rather than writing one from nothing.
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: false
---

# resume-editorial

## Overview

A model handed a résumé and a posting produces different prose. Different prose
is indistinguishable from *better* prose unless someone decided what they meant
to change and why. So regeneration becomes the default, and it silently discards
decisions the person already made — this verb, this order, this much restraint.

**What is already in `resume.json` is what the person decided to say.** Changing
it is often right. Changing it *silently* is not.

## Quick reference: the seven operations

Decide which one you are doing before you touch the sentence.

| Operation | Use when |
|---|---|
| **keep** | It already does its job. **This is the default.** |
| **move** | It is true and belongs in another section. |
| **combine** | Two lines are one accomplishment that got split up. |
| **split** | One line holds two unrelated accomplishments. |
| **make specific** | The reader needs an object, a scope, a decision or a consequence the person has already given you. |
| **delete** | It duplicates stronger proof, or says nothing a reader can use. |
| **rewrite** | The wording itself is the defect. |

`rewrite` is last on purpose. It is the operation of last resort.

**Work down this list before rewriting:**

1. *Placement* problem? → move.
2. *Selection* problem? → delete.
3. Two unrelated things stuck together? → split.
4. One thing broken into fragments? → combine.
5. Reader missing a fact the person already gave you? → make specific.
6. Only now: is the wording itself the defect? → rewrite.

Polishing a sentence that sits in the wrong section makes the misplacement
*harder* to see. The sentence reads better and the document got worse.

## Report every change to wording they had already seen

Give them: what it said before, what it says now, which operation that was, the
reason, and **whether the meaning changed or only the words**.

That last one matters most. "Same thing, shorter" and "a narrower claim than
before" look identical in a diff and are completely different to the person
whose interview it is.

If you cannot name a reason, that is your answer: keep it.

## Compression is where claims quietly move

Watch for:

- a contribution verb getting stronger — "contributed to" becoming "led";
- a number losing the thing it measured, the boundary it covered, or the
  statistic it was — dropping "p95" leaves a figure that reads as an average;
- a shared result becoming a solo one;
- seniority, scale or adoption words arriving from the posting rather than from
  the person.

Not sure a shorter sentence is still true? Ask. One question costs a moment; a
sentence they cannot defend in an interview costs the job.

## Read the whole document before saving

Every other check reads one sentence. What makes a résumé feel generated is the
*relationships between* sentences, which no per-sentence pass can see.

**Repetition**

- Several bullets under one role opening with the same two words.
- Three or more sentences with the same shape — same kind of verb, same trailing
  "…, reducing X by Y" clause, same "by doing Z" tail. Identical rhythm reads as
  templated however different the nouns are.
- A Summary sentence that restates a bullet instead of interpreting it. The
  Summary is the reader's interpretation of everything below it; previewing one
  bullet wastes the most-read line in the document.
- Two bullets proving the same thing with different technologies.

**Retrieval repetition is different, and fine.** A technology in Skills and in
the bullet proving it does two jobs for two readers. Leave it.

**Assembly**

- Four or more comma-separated nouns with no verb holding them together. That
  belongs in Skills, or needs an accomplishment built around it.
- A Summary made mostly of mechanisms. That is a Skills section that wandered
  upstairs, even when every term is true.

**Loss of level**

Compare against what the document said before your edits. If a revision dropped
evidence of architecture, lifecycle ownership, reliability, evaluation or
mentorship, the sentence got shorter and the person got smaller.

## Bring it as a suggestion

**Report it, ask about it, name an operation. Never refuse over it.**

None of this is a defect in the person. Repetition is a drafting artefact,
cadence is taste, and they may have repeated something deliberately.

> Three bullets under that role open with "Designed and built". I'd change the
> second to lead with the outcome and the third to lead with the decision — same
> facts, different entry point. Want me to?

Not:

> This résumé has a repetition problem.

## Common mistakes

| Mistake | Fix |
|---|---|
| Rewriting a sentence that was in the wrong section | Work the list — it was a `move` or a `delete`. |
| Reporting "updated the summary" | Name the operation, the reason, and whether meaning changed. |
| Shortening a bullet and losing its scope | Compression removes words, never evidence of level. |
| Flagging a term repeated in Skills and a bullet | That is retrieval repetition. Leave it. |
| Listing every cadence observation as a defect | Bring one concrete suggested change and ask. |

## Worked example

Synthetic, using the `example` persona. A Summary sentence reads:

> Recent work includes TypeScript services, GraphQL contracts, Docker packaging,
> and CI/CD pipelines.

Every term is accurate, so the instinct is to rewrite it into better prose. Work
the list instead: it is a *placement* problem. Four mechanisms, nothing about
what kind of engineer this is, and Skills already carries all four terms. The
operation is **delete** — the content already exists where a reader looks for it.

> Your Summary's second sentence lists four technologies that Skills and your
> bullets already carry. It is the most-read line in the document and right now
> it is a second Skills section. I'd replace it with what that work adds up to —
> you said you took the catalog work from architecture through production. Does
> that read as true to you?

## What this is not

There is no validator behind any of this, and there should not be. An earlier
version of Labora enforced exactly these rules with deterministic checks over a
claim ledger, and it spent most of its time reporting defects that were not
defects — see `PHILOSOPHY.md`. Editing judgment is judgment. Bring it to the
person, in their document, in specific language, and let them decide.
