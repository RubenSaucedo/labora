# Experience composition

All examples are synthetic. Never copy a technology, metric, scope or outcome
from this file.

## The mission

> **Experience proves the professional proposition the resume makes.**

A recruiter should quickly see progression, relevance and recognisable
accomplishments. A hiring manager should be able to reconstruct *level* from
evidence of system scope, ownership and attribution, technical judgment under
ambiguity, architecture and tradeoffs, lifecycle responsibility, reliability and
operations, measurable or concrete consequences, and leverage through reusable
systems, documentation, reviews or mentorship.

Level must emerge from what the candidate was trusted to change. It is never
asserted with an adjective.

## 1. Build the evidence lockset first

For each role, preserve: employer, title, progression, dates, location;
products, systems, users, technical domains; supported ownership and
collaboration verbs; numbers, units, percentiles, baselines, endpoints,
environments; shared-platform, inherited-system, reviewer and team-owned
boundaries; lifecycle state and disclosure restrictions; target-role terms that
must stay retrievable.

A rewrite may simplify wording. It may not silently narrow, broaden, reassign or
strengthen any of these.

## 2. Give every role a job in the career story

State what the role proves before composing anything. Without this, every
employer receives the same generic action-plus-tool bullets. `experience-plan`
requires `mission` for exactly this reason; `experience_role_has_no_mission` is
an error because a role with no mission produces a chronological inventory that
no later check can repair.

## 3. Select a proof portfolio, not the largest pile of facts

| Dimension | What it can prove |
|---|---|
| Product or user ownership | Who operates or benefits from the system |
| Architecture and abstractions | Turning complexity into stable interfaces |
| Reliability and operations | Failure behaviour, rollout, observability, recovery |
| Performance and scale | Measuring and improving consequential behaviour |
| Quality and evaluation | Testing, evaluation methods, regression reasoning |
| Developer or organisational leverage | Reusable tooling, docs, adopted patterns, mentorship |
| Lifecycle responsibility | Design through implementation, release, maintenance, handoff |

Not every role needs every dimension. Every selected bullet needs a **distinct
purpose**. Two bullets proving the same thing are one bullet and one wasted
line, however different their nouns — `bullet_purpose_duplicate`.

## 4. One accomplishment arc per bullet

1. **Object or context** — what system, product, workflow, problem, audience?
2. **Contribution** — what did the candidate personally do or decide?
3. **Necessary mechanism or judgment** — what choice explains the result?
4. **Consequence** — what changed for users, the system, delivery, reliability,
   or other engineers?

Do not force all four into every sentence. Include what the reader needs.

Synthetic mechanism-first:

> Added concurrent provider calls, per-source timers, and settled-result
> handling.

Synthetic accomplishment arc:

> Built a multi-source catalog pipeline that gathered provider data concurrently
> and continued producing usable results when individual sources failed.

The second keeps the mechanism and first tells the reader what was built and why
the failure handling mattered.

## 5. Arcs, not collages

Several facts belong together only when they share one object and one causal
path. Synthetic collage:

> Built an API, improved latency, mentored engineers, launched a dashboard, and
> created documentation.

Five true claims, no central accomplishment. This is what `combine` may not
produce, and the validator refuses a combine whose claims cross an accomplishment
unit, a contribution level, a role, or a disclosure boundary.

## 6. Preserve seniority during compression

Reject a rewrite that turns architecture or end-to-end ownership into generic
participation; reduces a multi-source or cross-layer system to one
implementation detail; removes the engineering choice connecting action to
consequence; drops reliability, operations, evaluation or enablement; hides
cross-team leverage behind `collaborated with`; or inflates reviewed work into
formal ownership.

> Compression succeeds only when it removes words without deleting the evidence
> of level.

`seniority_scope_loss` compares marker classes — architecture, lifecycle,
reliability, evaluation, leverage, ownership, scope — before and after. A
shorter sentence that dropped one is reported with route `keep`.

## 7. Mentorship is technical leverage

`Mentored engineers` alone is weak. Connect it to the artifact, practice or
release responsibility that spread. Do not borrow status by naming the seniority
of the recipients, and do not claim adoption or organisational reach without
evidence. Recognised but informal responsibility may be stated when attribution
is explicit and grounded immediately in concrete actions.

## 8. Compress older roles without erasing them

Older roles receive less space, not less meaning. Prefer one concrete system or
problem over "contributed to multiple projects for international clients". A
useful older-role bullet can preserve a product and its users, the real
ownership boundary, a distinctive technical foundation, customer-facing
diagnosis, or supported progression. Do not force old work to mimic the current
specialisation — its purpose may be breadth or foundations.
`older_role_generic_placeholder` catches the responsibility-description form.

## 9. Audit the section as a whole

Duplicate purposes; repeated architecture, ownership, rollout or optimisation
claims with different nouns; repeated openings and clause shapes; mechanisms
already covered by Skills; Experience claims duplicated in the Summary; projects
adding no independent evidence; whether the strongest role stays scannable.

Additional length is justified only when each unit contributes distinct proof.

## The `experience-plan` artifact

```json
{
  "schemaVersion": "1.0",
  "roles": [{
    "experienceId": "example-current",
    "mission": "Prove architecture, production ownership, reliability and engineering leverage",
    "compression": "full",
    "selected": [{
      "unitId": "example-unit",
      "purpose": "reliability under partial dependency failure",
      "object": "multi-source catalog pipeline",
      "contribution": "designed and implemented",
      "mechanism": "concurrent retrieval with partial-result preservation",
      "consequence": "kept producing usable results when individual sources failed",
      "attribution": "sole_owner",
      "claimIds": ["example-claim"],
      "location": "experience[0].bullets[0]",
      "readerContextRisks": []
    }],
    "omitted": [{ "unitId": "example-other", "reason": "duplicates the reliability purpose already selected" }]
  }]
}
```

`attribution` may **narrow** relative to the bank's `contribution`. It may never
strengthen it — `attribution_verb_mismatch` is an error, because that upgrade is
the quiet path by which a shared result becomes an owned one.

`location` is what lets Technical Skills and Projects depend on this arc, so
that cutting the bullet invalidates the skill it was the only proof of.
