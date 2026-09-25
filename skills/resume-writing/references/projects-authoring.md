# Open Source & Projects authoring

All names, URLs, identifiers and scenarios are synthetic. `example.invalid` is a reserved non-resolving domain.

## The mission

Projects provide external implementation proof that strengthens or broadens the professional proposition the resume establishes.

The section can expose current work a reader can inspect directly, add proof that confidential employment history cannot show publicly, demonstrate independent ownership, architecture, reliability or developer-tooling depth, and keep a small complementary set rather than a repository inventory.

It should not repeat Experience with different nouns, become a second Skills list, include every repository, treat a course exercise as a maintained system, or imply adoption, release status, production scale or public source without confirmation.

## 1. Decide whether Projects earns space

Include it when selected projects supply at least one of: independently inspectable source or working software; current depth in a target specialisation; end-to-end product ownership unavailable from confidential work; architecture, reliability, evaluation or developer-experience evidence; meaningful open-source maintenance; a distinct capability not established more strongly elsewhere.

Omit it when every candidate repeats professional work, has no inspectable artifact, is stale without continuing relevance, or consumes space stronger Experience evidence needs. "No Projects section" should be a decision with a reason, not a gap.

## 2. Build a candidate inventory

Record artifact kind, proof mission, inspectability, ownership, currency, canonical identity, status, and the files, URLs, commits, notes or conversations that support it.

Do not infer meaningful authorship from repository ownership alone. Do not infer production use from deployment files, package metadata, or a reachable URL.

## 3. Select a proof portfolio

Weigh relevance, source strength, public inspectability, distinct contribution to the complete resume, engineering depth, ownership clarity, currency, link health, and space efficiency.

Two or three complementary projects usually carry more value than a longer list. Each selected project needs one primary proof mission.

## 4. Name the artifact the link actually opens

Use the public product name for a live product and the repository name for a repository. Add a short external descriptor when the name is not self-explanatory.

Synthetic — prefer:

```text
Example Atlas — Route-Planning Application
```

over:

```text
Example Labs - Example Atlas
Founder & Software Engineer - Example Labs
```

Add a founder or owner label only when organisational ownership is relevant and confirmed.

## 5. Check canonical links

Before selection and before sending: the URL resolves; it opens the named artifact; anything described as public is publicly accessible; a live product can be used as described; authentication or signup requirements are stated accurately; the destination's README, title and package status agree with the resume; renamed or transferred repositories use their current canonical route.

A working redirect is not the canonical identity.

## 6. Product first, engineering proof second

Synthetic stack-first:

> Built with TypeScript, React, Node.js, PostgreSQL, Docker, monitoring, and testing.

Synthetic product-first:

> Live route-planning application that builds accessible itineraries without requiring an account. Built the TypeScript system across web and service layers, with shared validation contracts, telemetry, automated tests, and evaluation of generated routes.

Keep only stack anchors that prove implementation breadth; Technical Skills already provides keyword retrieval.

## 7. Translate mechanisms into what they protect or enable

Synthetic mechanism inventory:

> Content hashes, checkpoints, locks, deadlines, cancellation, and atomic writes.

Synthetic project proof:

> Resumes interrupted processing from checked, content-addressed checkpoints without repeating completed provider work, with bounded calls, end-to-end cancellation, and atomic publication.

## 8. Status and capability boundaries are facts

Do not convert prepared metadata into a published release; repository contents into installed usage; a reachable URL into user adoption; source integration into host verification; tests into production reliability; local checkpoints into distributed durable execution; or a personal repository into sole authorship.

`open_source`, `MIT`, `live`, `prototype` and `private_source` are useful when they materially clarify the artifact. Do not stack labels the link already makes obvious.

## 9. Public source and live private source are different, and both are valid

A project can belong without public source. Public repositories let readers inspect source, tests, CI, architecture, documentation and release state. Live products with private source let readers inspect working behaviour. The rendered entry must not imply that source is public when it is not.

## 10. Order by resume mission, not alphabetically

Strongest independently usable product; most relevant current specialisation; complementary systems or reliability depth. Reordering must not rewrite any project facts.

## 11. Title the section from the selected set

Use `Projects`, `Selected Projects`, or `Open Source & Projects`. Use the last only when the set actually includes public repositories.
