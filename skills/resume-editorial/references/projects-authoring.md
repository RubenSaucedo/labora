# Open Source & Projects authoring

All names, URLs, identifiers and scenarios are synthetic. `example.invalid` is a
reserved non-resolving domain.

## The mission

> **Projects provide external implementation proof that strengthens or broadens
> the professional proposition the resume establishes.**

The section should expose current work a reader can inspect directly, add proof
that confidential employment history cannot show publicly, demonstrate
independent ownership or architecture or reliability or developer-tooling depth,
and keep a small complementary set rather than a repository inventory.

It should not repeat Experience with different nouns, become a second Skills
list, include every supported repository, treat a course exercise as a
maintained system, or imply adoption, release status, production scale or public
source without evidence.

## 1. Decide whether Projects earns space

Include the section when the selected projects supply at least one of:
independently inspectable source or working software; current depth in a target
specialisation; end-to-end product ownership unavailable from confidential work;
architecture, reliability, evaluation or developer-experience evidence;
meaningful open-source maintenance; a distinct capability not established more
strongly elsewhere.

Omit it when every candidate merely repeats professional work, has no
inspectable artifact, is stale without continuing relevance, or consumes space
that stronger Experience evidence needs. Record `omittedSectionReason` — "no
Projects section" should be a decision with a reason, not a gap.

## 2. Build a candidate inventory

Record `artifact_kind`, `proof_mission`, `inspectability`, `ownership`,
`currency`, `canonical_identity`, `status`, and the claims, files, URLs, commits
or observations that support it.

Do not infer meaningful authorship from repository ownership alone. Do not infer
production use from deployment files, package metadata, or a reachable URL.

## 3. Select a proof portfolio

Score relevance, evidence strength, public inspectability, distinct contribution
to the complete resume, engineering depth, ownership clarity, currency and link
health, and space efficiency.

Two or three complementary projects usually carry more value than a longer list.
Each selected project needs **one primary proof mission**, and two projects with
the same mission mean one of them is spending a line for nothing. Technology
overlap is fine when the projects prove different capabilities.

## 4. Name the artifact the link actually opens

Use the public product name for a live product and the repository name for a
repository. Add a short external descriptor when the name is not
self-explanatory. Do not combine an umbrella organisation and a product into a
title the public surface never uses.

Synthetic — prefer:

```text
Example Atlas — Route-Planning Application
```

over:

```text
Example Labs - Example Atlas
Founder & Software Engineer - Example Labs
```

The section already attributes the entry to the candidate. Add a founder or
owner label only when organisational ownership is relevant and supported.

## 5. Validate canonical links

Before selection and again before release: the URL resolves; it opens the named
artifact; anything described as public is publicly accessible; a live product
can be used as described; authentication or signup requirements are stated
accurately; the destination's README, title and package status agree with the
resume; renamed or transferred repositories use their current canonical route.

**A working redirect is not the canonical identity.** A link change makes
dependent resume entries and rendered artifacts stale. `verifiedAt` records when
the identity was last confirmed; an entry printing a URL that was never
confirmed is `project_dependency_stale`, because a printed URL is part of the
claim.

## 6. Product first, engineering proof second

1. What kind of artifact is this?
2. What can a user or developer do with it?
3. Which engineering decisions make it relevant?

Synthetic stack-first:

> Built with TypeScript, React, Node.js, PostgreSQL, Docker, monitoring, and
> testing.

Synthetic product-first:

> Live route-planning application that builds accessible itineraries without
> requiring an account. Built the TypeScript system across web and service
> layers, with shared validation contracts, telemetry, automated tests, and
> evaluation of generated routes.

Keep only the stack anchors that prove implementation breadth; Technical Skills
already provides full keyword retrieval. `project_stack_without_object` fires
when the description opens with technologies.

## 7. Translate mechanisms into what they protect or enable

Do not remove technical depth — connect it. Synthetic mechanism inventory:

> Content hashes, checkpoints, locks, deadlines, cancellation, and atomic
> writes.

Synthetic project proof:

> Resumes interrupted processing from validated, content-addressed checkpoints
> without repeating completed provider work, with bounded calls, end-to-end
> cancellation, and atomic publication.

## 8. Status and capability boundaries are claims

Do not convert prepared metadata into a published release; repository contents
into installed usage; a reachable URL into user adoption; source integration
into host verification; tests into production reliability; local checkpoints
into distributed durable execution; or a personal repository into sole
authorship.

`open_source`, `MIT`, `live`, `prototype` and `private_source` are useful when
they materially clarify the artifact. Do not stack labels the link already makes
obvious. `project_status_overclaim` is an error for `released`, `installable`
and `maintained` without a supporting claim.

## 9. Public source and live private source are different, and both are valid

A project belongs without public source. For public repositories, readers may
inspect source, tests, CI, architecture, documentation and release state. For
live products with private source, readers may inspect working behaviour.
Private evidence can support the internal technical claim, but the rendered
entry must not imply that source is publicly available —
`project_source_visibility_mismatch`, an error, because a reader will go looking
for code they cannot see.

## 10. Order by resume mission, not alphabetically

Strongest independently usable product; most relevant current specialisation;
complementary systems or reliability depth. A targeted resume may lead with the
most relevant project; a broader one may lead with end-to-end product proof.
Reordering must not rewrite any project claim.

## 11. Title the section from the selected set

`Projects`, `Selected Projects`, or `Open Source & Projects`. Use the last only
when the set actually includes public repositories. Do not label the section
`Open Source` when a selected artifact is not open source —
`project_section_title_mismatch`.

## 12. Project evidence is a freshness dependency

Repository transfer or rename, README scope, package and release status,
live-product identity and behaviour, archive status, canonical URL, and
public/private visibility all change underneath a resume. When one changes,
identify every affected resume, profile, portfolio, rendered artifact and
application form. Do not leave an old link or a stronger historical claim
looking current.
