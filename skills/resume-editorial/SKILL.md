---
name: resume-editorial
description: The editing method — how to change a résumé someone already has without quietly rewriting the parts they were happy with, and how to read the finished document as a whole.
tools: [bash, view, glob, grep, edit, create, ask_user]
user-invocable: false
---

# resume-editorial

Load this whenever you are changing a résumé that already exists, rather than
writing one from nothing. `draft-resume` and `tailor-resume` both load it.

## The problem this exists to stop

A model handed a résumé and a posting will produce different prose. Different
prose is indistinguishable from *better* prose unless someone decided what they
meant to change and why.

So regeneration becomes the default, and it quietly costs the person something
they cannot see. Someone who has already read their own résumé has made hundreds
of decisions — this verb, this order, this much detail, this much restraint.
Rewriting the document throws all of them away every time, and their only
recourse is to read the whole thing again and make the same calls.

**What is already in `resume.json` is what the person decided to say.** Treat it
that way. Changing it is fine and often right; changing it *silently* is not.

## The seven operations

Before you touch a sentence, decide which of these you are doing:

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

**Before rewriting, work down this list:**

1. Is this a *placement* problem? → move.
2. Is this a *selection* problem? → delete.
3. Are two unrelated things stuck together? → split.
4. Is one thing broken into fragments? → combine.
5. Is the reader missing a fact the person already gave you? → make specific.
6. Only now: is the wording itself the defect? → rewrite.

Polishing a sentence that is in the wrong section makes the misplacement *harder*
to see, not easier. The sentence reads better and the document got worse.

## Say what you changed, and why

For every change to wording the person had already seen, tell them:

- what it said before;
- what it says now;
- which of the seven operations that was;
- the reason — target relevance, clarity, section fit, confidentiality, metric
  context, page space, or a correction they confirmed;
- whether the meaning changed, or only the words.

That last one matters most. "Same thing, shorter" and "a narrower claim than
before" look identical in a diff and are completely different to the person whose
interview it is. If the meaning narrowed, broadened, or moved to a different
subject, say so in those words.

If you cannot name a reason, that is the answer: keep it.

## Never let an edit widen a claim

Compression is where scope quietly grows or disappears. Watch for:

- a contribution verb getting stronger — "contributed to" becoming "led";
- a number losing the thing it measured, the boundary it covered, or the
  statistic it was — dropping "p95" leaves a figure that reads as an average;
- a shared result becoming a solo one;
- seniority, scale or adoption words arriving from the posting rather than from
  the person.

If a shorter sentence is tempting but you are not sure it is still true, ask. One
question costs a moment. A sentence the person cannot defend in an interview
costs the job.

## Read the whole document before you save

Every check so far reads one sentence. The defects that make a résumé feel
generated are *relationships between* sentences, and no per-sentence pass can see
them. Read the finished document top to bottom and look for:

### Repetition

- Several bullets under one role opening with the same two words.
- Three or more sentences with the same shape — same kind of verb, same trailing
  "…, reducing X by Y" clause, same "by doing Z" tail. Identical rhythm reads as
  templated however different the nouns are.
- A Summary sentence that restates a bullet instead of interpreting it. The
  Summary is the reader's interpretation of everything below it; previewing one
  bullet wastes the most-read line in the document.
- Two bullets proving the same thing with different technologies.

**Retrieval repetition is different, and fine.** A technology named in Skills and
again in the bullet that proves it does two different jobs for two different
readers. Leave it.

### Assembly

- A line that is four or more comma-separated nouns with no verb holding them
  together. That belongs in Skills, or needs an accomplishment built around it.
- A Summary made mostly of mechanisms and technologies. That is a Skills section
  that wandered upstairs, even when every term in it is true.

### Loss of level

Compare against what the document said before your edits. If a revision dropped
evidence of architecture, lifecycle ownership, reliability, evaluation,
mentorship or end-to-end scope, the sentence got shorter and the person got
smaller. That is a regression even though nothing became false.

## What to do with what you notice

**Report it, ask about it, suggest an operation. Never refuse over it.**

None of this is a defect in the person. Repetition is a drafting artefact,
cadence is taste, and they may have repeated something deliberately. Bring it to
them with a specific suggestion:

> Three bullets under that role open with "Designed and built". I'd change the
> second to lead with the outcome and the third to lead with the decision — same
> facts, different entry point. Want me to?

Not:

> This résumé has a repetition problem.

## Worked example

Synthetic, using the `example` persona. A Summary sentence reads:

> Recent work includes TypeScript services, GraphQL contracts, Docker packaging,
> and CI/CD pipelines.

Every term is accurate. The instinct is to rewrite it into better prose. Work the
list instead:

1. **Placement?** Yes. Four mechanisms, and nothing about what kind of engineer
   this is. Skills already carries all four terms and the bullets prove them.
2. So the operation is **delete** from the Summary — the content already exists
   where a reader would look for it.

What to say:

> Your Summary's second sentence lists four technologies that Skills and your
> Experience bullets already carry. It is the most-read line in the document, and
> right now it is a second Skills section. I'd replace it with what that work
> adds up to — you told me you took the catalog work from architecture through
> production. Does that read as true to you?

The repair raises the sentence to what the person actually did, instead of
qualifying a list nobody needed there.

## What this is not

There is no validator behind any of this, and there should not be. An earlier
version of Labora enforced exactly these rules with deterministic checks over a
claim ledger, and it spent most of its time reporting defects that were not
defects — see `PHILOSOPHY.md`. Editing judgment is judgment. Bring it to the
person, in their document, in specific language, and let them decide.
