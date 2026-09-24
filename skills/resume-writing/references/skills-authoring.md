# Technical Skills authoring

All examples are synthetic.

## The mission

Technical Skills is a compact retrieval index of relevant, accurate technical vocabulary.

It should let recruiters and hiring systems find accurate target terms quickly, give technical readers a coherent map of current capability, preserve implementation fluency and senior-level engineering domains, and point at proof elsewhere in the document.

It should not prove competence by assertion, narrate accomplishments, restate the Summary, list every tool ever encountered, add unconfirmed posting keywords, or promote a course into production experience.

## 1. Build a candidate inventory

Collect from profile files, selected accomplishments, projects, credentials, and the person's confirmed sources. Do not infer professional proficiency from a dependency file, a course title, or a target posting.

| Status | Meaning | Default treatment |
|---|---|---|
| `demonstrated_recent` | Used materially in recent work or a current project | Strong inclusion candidate |
| `demonstrated_older` | Used materially in older work, still defensible | Include when relevant or foundational |
| `demonstrated_project` | Supported by a credible current project | Include and keep project proof visible |
| `formally_learned` | Supported only by coursework or certification | Prefer Education or Certifications |
| `exposure_only` | Used incidentally without meaningful ownership | Omit |
| `unconfirmed` | The person has not confirmed it | Ask before using |

## 2. Choose inclusion; do not copy every term

Weigh target relevance, source strength, recency, depth of use, distinctiveness, exact-term retrieval value, redundancy with a more precise item, and space cost. A true item can still be too minor, stale, generic or irrelevant to earn space.

## 3. Separate parsing from ranking folklore

Use standard headings, selectable text, canonical terminology and simple formatting because these reduce parsing risk. Do not state that every ATS weights this section the same way, that repeating a keyword improves ranking, that one skill count or position is optimal, or that exact matching always beats normalisation.

## 4. Choose a category model deliberately

- **Technology taxonomy:** Languages; Frameworks; Platforms and Tools.
- **Capability taxonomy:** Distributed Systems; Reliability; Developer Experience.
- **Hybrid:** Languages and Runtime; Backend and Platform Engineering; Reliability and Operations.

Hybrid often suits experienced engineers, but only when the categories remain understandable outside the source organisation and operate at parallel levels.

## 5. Technologies and demonstrated capabilities are different things

Senior engineers should not be reduced to framework inventories. Recognised capabilities — observability, accessibility, concurrency, evaluation, phased rollouts — belong when they are externally recognisable, target-relevant, confirmed by substantive work, specific enough to carry meaning, and useful as retrieval terms.

Reject generic traits and abstractions: Leadership, Communication, Problem Solving, Architecture, Cloud, Scalability. Their evidence belongs in Experience, where it has an object.

## 6. Scope every capability to the work

- partial-result continuation is not automatically `Fault Tolerance`;
- log redaction is not automatically `Privacy Engineering`;
- one model benchmark is not automatically `Machine Learning`;
- file-backed resumption is not distributed durable execution;
- a fundamentals credential is not production platform experience.

Prefer the narrowest standard term useful to an external reader.

## 7. Canonical public terminology

Normalise capitalisation and product names. Pair a full term with its acronym once when useful but ambiguous: `Web Accessibility (WCAG)`, `Model Context Protocol (MCP)`. Do not add aliases mechanically; `JavaScript (JS)` helps nobody. Never manufacture equivalence to create a match.

## 8. No self-rated proficiency

No stars, bars, percentages, numeric ratings, or `expert`/`advanced`/`intermediate` without an explicit shared basis. Depth should emerge from selection, ordering, and proof in Experience or Projects.

## 9. Treat skill support as a visible dependency

If an Experience or Project unit is removed, re-evaluate every skill that depended on it. The person may know the skill, but if the resume gives the reader nowhere to see it, the listed term is weaker.
