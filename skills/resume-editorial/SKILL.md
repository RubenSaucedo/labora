---
name: resume-editorial
description: "Edits a resume against an operator-approved baseline: plans keep/move/combine/split/make-specific/delete/rewrite per span, preserves approved wording byte-for-byte, and audits the whole document before rendering."
tools: [bash, view, glob, grep, edit, create]
user-invocable: false
---

# resume-editorial

Load `resume-conventions` first, then `resume-tailor`. This skill covers what
happens when an operator already has a resume they have reviewed.

**Inputs:** `applications/<slug>/baseline.json` and the approved resume it
names, `application-strategy.json`, `job-spec.json`,
`profile/generated/{claims,accomplishments,identity}.json`.

**Outputs:** `editorial-plan.json`, the revised `resume.json`,
`validations/editorial.json`, `validations/document-audit.json`.

## The rule this skill exists to enforce

> When an operator supplies an approved baseline, act as an editor before
> acting as a generator.

Editing is not a softer word for rewriting. A generated sentence can be
truthful, individually polished, and make the complete resume worse: it throws
away hundreds of decisions a person already made about verb, order, detail and
restraint, and the only way they get those back is to review the whole document
again and make the same calls.

**The baseline is not evidence.** It records what a person approved *saying*;
only the claim ledger records what is supported. If the baseline could ground a
claim, any sentence that survived one run would become self-supporting, and an
unsupported bullet would launder itself into a verified one simply by having
been printed once. Read it through `baselineEditorialView()`, which returns
prose spans and nothing else — no provenance, no claim IDs. Every kept sentence
and every revised sentence still resolves through claim validation unchanged.

## Check the baseline first

```bash
labora baseline <application-dir> --check
```

Exit 2 means the file changed after it was recorded. Its approval no longer
applies and neither does any preservation guarantee built on it. Stop, report
what happened, and ask the operator to re-record:

```bash
labora baseline <application-dir> --record resume-approved.json --approved-by-operator
```

Never record that flag yourself. It asserts that a human reviewed the wording,
and you are not in a position to assert it.

An `unreviewed` baseline is still useful as a structural reference — order and
section shape are informative — but it carries no wording guarantee and nothing
in it requires reapproval.

## The seven operations

For every span in the baseline, choose exactly one:

| Operation | Use when |
|---|---|
| `keep` | The sentence already does its job. **This is the default.** |
| `move` | The content is true and belongs in another section. |
| `combine` | Two units form one causal accomplishment inside one evidence boundary. |
| `split` | One unit holds unrelated accomplishments or incompatible evidence boundaries. |
| `make_specific` | The reader needs a supported object, scope, decision or consequence. |
| `delete` | The unit duplicates stronger proof or contributes no useful meaning. |
| `rewrite` | The wording itself is the defect. |

`rewrite` is last because it is the operation of last resort. A model can always
produce different prose, and different prose is indistinguishable from better
prose unless someone wrote down which of the seven they meant and why.

**Before rewriting, ask in this order:**

1. Is this a *placement* problem? → `move`.
2. Is this a *selection* problem? → `delete`.
3. Is this an *evidence-boundary* problem? → `split`.
4. Is this a *fragmentation* problem? → `combine`.
5. Is the reader missing a supported fact? → `make_specific`.
6. Only then: is the wording itself the defect? → `rewrite`.

Polishing a sentence that is in the wrong section makes the misplacement harder
to see, not easier. The audit reports that as `local_polish_architecture_miss`.

## Write the plan before touching prose

`editorial-plan.json`:

```json
{
  "schemaVersion": "1.0",
  "baselineHash": "<copy from baseline.json>",
  "baselinePath": "resume-approved.json",
  "documentMission": "Present an experienced platform engineer for a platform role",
  "operations": [
    {
      "location": "summary.sentences[0]",
      "operation": "keep",
      "originalText": "<byte-for-byte from the baseline>",
      "semanticDelta": "none",
      "requiresReapproval": false
    },
    {
      "location": "summary.sentences[1]",
      "operation": "move",
      "originalText": "<byte-for-byte from the baseline>",
      "destination": "experience[0].bullets[3]",
      "reason": "Implementation mechanism belongs with its evidence-bearing accomplishment",
      "semanticDelta": "moved",
      "claimIds": ["example-claim"],
      "unitIds": ["example-unit"],
      "affects": ["skills.primary[2]"],
      "requiresReapproval": true
    }
  ],
  "additions": [],
  "notesForHuman": []
}
```

Rules the validator enforces, so save yourself a round trip:

- `originalText` is byte-for-byte. A tidied copy is already an unrecorded change.
- **Every changed location needs an operation.** Unchanged locations need
  nothing; that is the point of a baseline. A changed span with no operation is
  `approved_baseline_changed_without_reason`.
- Every non-`keep` operation needs a `reason`.
- `move` carries its claim mapping: the provenance at the destination must
  include every claim ID the operation moved.
- `split` **partitions** the source's claims. No product may claim evidence the
  source did not carry, no claim may land on two products, and every number a
  product prints must appear in a fact that product maps to.
- `combine` may not cross an accomplishment unit, a contribution level, a role,
  or a disclosure boundary. Two supported sentences joined across any of those
  assert a causal chain neither source states — and read stronger than either,
  which is why it is tempting.
- `requiresReapproval` is true exactly when the operation is structural
  (`move`, `combine`, `split`, `delete`) or `semanticDelta` is not `none`, and
  only when the baseline is operator-approved.
- Locations for a span that shifted index — because an earlier bullet was split
  or deleted — are a `move` with unchanged wording. Declare them.

Then validate:

```bash
labora validate-editorial-plan <application>/editorial-plan.json \
  <application>/resume.json profile/generated/claims.json \
  --application <application> \
  --accomplishments profile/generated/accomplishments.json \
  --output <application>/validations/editorial.json
```

## Section missions

Load `references/section-missions.md`. A true statement in the wrong section is
an editorial defect, and it is invisible to every per-sentence check: claim
validation says supported, style says well formed, and the document is worse.

Then load the method for whichever sections you are editing:

- `references/summary-altitude.md` — Summary interprets; it does not inventory.
- `references/metric-context.md` — a supported number can still mislead.
- `references/experience-composition.md` — prove scope, ownership, judgment,
  consequence.
- `references/skills-authoring.md` — a supported retrieval index, not a tag dump.
- `references/projects-authoring.md` — distinct, inspectable external proof.

## Audit the whole document before rendering

```bash
labora audit-document <application>/resume.json \
  --job-spec <application>/job-spec.json \
  --claims profile/generated/claims.json \
  --application <application> \
  --editorial-plan <application>/editorial-plan.json \
  --experience-plan <application>/experience-plan.json \
  --output <application>/validations/document-audit.json
```

It reports what no single-sentence check can see: repeated openings and clause
shapes, noun stacks, duplicate bullet purposes, a summary that previews a bullet
instead of interpreting it, keyword placement regressions, voice drift, and
compression that removed the evidence of level.

**"Human" here means the document communicates naturally to its intended reader
and preserves the operator-approved voice.** It does not mean optimising an
AI-detector score. Do not add burstiness targets, synonym randomisation, or
detector-evasion of any kind; they make the document worse for the reader, which
is the only reader that matters.

Everything the audit reports is advisory, and it exits 0 with findings. The one
exception is a finding that crosses an evidence boundary — posting vocabulary
the ledger does not support — which is an error, because that is a truth
question rather than a taste question.

## The cold reader

After rendering, run the isolated reader. It is a separate agent
(`resume-cold-reader`) for a structural reason: a reviewer who has seen the
evidence understands sentences a recruiter will not, and will report them clear.

```bash
labora prepare-reader-input <application>/artifact-text.txt \
  --job <application>/job.md --audience recruiter \
  --output <application>/reader-input.json
```

Bring its findings back here and repair them **against the evidence**. The cold
reader names the ambiguity; it never invents the missing fact, because it has no
source to invent from. Choose one of four evidence-governed repairs: translate
the term, add compact context, replace it with the decision it stood in for, or
delete it when the explanation costs more space than the term contributes.

## What never changes

Nothing here blocks the operator. Every editorial concern is a finding with a
named operation attached. The approval that matters is still an explicit human
act bound to one artifact hash, one finding set, and now one baseline, one
proposal and one accepted wording — `labora approve`. Never run it for them.
