# Technical Skills authoring

All examples are synthetic.

## The mission

> **Technical Skills is a compact retrieval index of relevant, supported
> technical vocabulary.**

It should let recruiters and hiring systems find accurate target terms quickly,
give technical readers a coherent map of current capability, preserve both
implementation fluency and senior-level engineering domains, and point at proof
elsewhere in the document.

It should not prove competence by assertion, narrate accomplishments, restate
the Summary, list every tool ever encountered, add unsupported posting keywords,
or promote a course into production experience.

## 1. Build a supported candidate inventory

Collect from verified claims, selected accomplishments, projects, credentials
and operator-provided sources. Do not infer professional proficiency from a
dependency file, a course title, or a target posting.

| Status | Meaning | Default treatment |
|---|---|---|
| `demonstrated_recent` | Used materially in recent work or a current project | Strong inclusion candidate |
| `demonstrated_older` | Used materially in older work, still defensible | Include when relevant or foundational |
| `demonstrated_project` | Supported by a credible current project | Include and keep the project proof visible |
| `formally_learned` | Supported only by coursework or certification | Prefer Education or Certifications |
| `exposure_only` | Used incidentally without meaningful ownership | Omit |
| `unsupported` | No source supports the item | Exclude |

## 2. Score inclusion; do not copy every supported term

Weigh target relevance, evidence strength, recency, depth of use,
distinctiveness, exact-term retrieval value, redundancy with a more precise
item, and space cost. **Evidence is necessary and not sufficient**: a supported
item can still be too minor, stale, generic or irrelevant to earn space.

## 3. Separate ATS parsing from ranking folklore

Use standard headings, selectable text, canonical terminology and simple
formatting, because these reduce parsing risk. Do not claim that every ATS
weights this section the same way, that repeating a keyword N times improves
ranking, that one skill count or position is optimal, or that exact matching
always beats normalisation. Provide accurate coverage without visible stuffing.

## 4. Choose a category model deliberately

- **Technology taxonomy** — Languages; Frameworks; Platforms and Tools.
- **Capability taxonomy** — Distributed Systems; Reliability; Developer
  Experience.
- **Hybrid** — Languages and Runtime; Backend and Platform Engineering;
  Reliability and Operations.

Hybrid often suits experienced engineers, which makes it the model most likely
to be selected without thinking. `modelReason` is required for that reason.

Check that each label is understandable outside the source organisation, that
every item belongs under it, that adjacent categories operate at parallel levels
(`category_granularity_mismatch`), that no one-item or catch-all bucket exists,
and that order reflects target relevance.

## 5. Technologies and demonstrated capabilities are different things

Senior engineers should not be reduced to framework inventories. Recognised
capabilities — observability, accessibility, concurrency, evaluation, phased
rollouts — belong when they are externally recognisable, target-relevant,
supported by substantive work, specific enough to carry meaning, and useful as
retrieval terms.

Reject generic traits and abstractions: Leadership, Communication, Problem
Solving, Architecture, Cloud, Scalability. Their evidence belongs in Experience,
where it has an object.

## 6. Scope every capability to the evidence

- partial-result continuation is not automatically `Fault Tolerance`;
- log redaction is not automatically `Privacy Engineering`;
- one model benchmark is not automatically `Machine Learning`;
- file-backed resumption is not distributed durable execution;
- a fundamentals credential is not production platform experience.

Prefer the narrowest standard term that remains useful to an external reader. If
the accurate term is too implementation-specific to function as a skill, leave
it in Experience or Projects rather than forcing it into the list.

## 7. Canonical public terminology

Normalise capitalisation and product names. Pair a full term with its acronym
once when the acronym is useful but ambiguous — `Web Accessibility (WCAG)`,
`Model Context Protocol (MCP)`. Do not add aliases mechanically; `JavaScript
(JS)` helps nobody. When a posting uses an accurate recognised term, prefer it
over an internal approximation, and never manufacture equivalence to create a
match.

## 8. No self-rated proficiency

No stars, bars, percentages, numeric ratings, or `expert`/`advanced`/
`intermediate` without an explicit shared basis. Depth should emerge from
selection, ordering, and proof in Experience or Projects.

## 9. Treat skill support as a dependency

> If an Experience or Project unit is removed, re-evaluate every skill that
> depended on it.

This is the rule nothing else catches. The claim ledger still supports the
skill, so every claim-level validator passes — what disappeared is the
*document's visible proof*, and a reader who looks for it finds nothing.
`supportingLocations` records the edge; `skill_dependency_stale` reports the
break.

## The `skills-plan` artifact

```json
{
  "schemaVersion": "1.0",
  "model": "hybrid",
  "modelReason": "preserves concrete technologies while surfacing reliability depth",
  "categories": [
    { "label": "Languages & Runtime", "reason": "immediate retrieval of required languages", "order": 1 }
  ],
  "items": [
    {
      "display": "Example Lang",
      "canonical": "example-lang",
      "category": "Languages & Runtime",
      "evidenceStatus": "demonstrated_recent",
      "claimIds": ["example-claim"],
      "supportingLocations": ["experience[0].bullets[0]"],
      "targetRelevance": "high",
      "depth": "material",
      "decision": "include",
      "reason": ""
    },
    {
      "display": "Example Cloud",
      "canonical": "example-cloud",
      "evidenceStatus": "formally_learned",
      "claimIds": ["example-cert"],
      "supportingLocations": [],
      "depth": "coursework",
      "decision": "certifications_only",
      "reason": "fundamentals coursework, not production platform experience"
    }
  ]
}
```

`decision` is where the honesty lives. `certifications_only` is not a demotion —
it is the rendering that says the true thing about what the evidence is.
