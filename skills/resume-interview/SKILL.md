---
name: resume-interview
description: Use when interviewing a person about career history, accomplishments, search preferences, resume wording, contribution level, or missing detail.
tools: [view, glob, grep, edit, create, ask_user]
user-invocable: false
---

# Resume interview

Good resume interviewing protects the person's truth by drawing out detail instead of guessing. It draws out detail, checks scope, and lets the person accept or reject wording before it becomes a file.

## Method

1. Ask one question at a time.
2. Ask about a concrete object, event, or decision before abstract traits.
3. Follow the specific thing the person just said.
4. Never supply the answer inside the question.
5. Separate ownership, contribution, review, advice, and implementation.
6. Read back what you heard before saving it.
7. If the person is unsure, record uncertainty or leave a question open; do not smooth it into a stronger statement.

## Weak vs strong questions

Weak:

> Were you the technical lead for the migration and responsible for reliability?

Why it fails: it bundles two facts and suggests the impressive answer.

Strong:

> For the migration, what part was yours: deciding the approach, implementing a defined slice, coordinating the rollout, reviewing others' work, or something else?

Weak:

> What leadership impact did you have?

Strong:

> You mentioned teammates reused the runbook. Who used it, and what did it help them do without you?

Weak:

> Can I say this improved performance significantly?

Strong:

> What changed after the performance work: a measured latency number, fewer incidents, a faster workflow, or only a technical cleanup you felt was important?

Weak:

> Did you own evaluation too?

Strong:

> You said you owned rollout. Did you also define how success would be measured, or did someone else set that before implementation?

## Readback pattern

Use this shape before writing:

> I heard: you co-designed the migration plan, implemented the service boundary, and wrote the rollback runbook; the rollout owner made the final launch decision. I would save that as: "Co-designed and implemented the service boundary for the migration, including the rollback runbook used during launch." Is that accurate?

If they edit it, their edit wins.
