# Section missions

A shared contract, not five prompts that happen to agree. Every section answers
a different question for a different reading behaviour, and the same rule —
*where does this belong* — is answered the same way everywhere.

Encoded in `src/lib/section-missions.js` as `SECTION_MISSIONS`, so this document
and the validator cannot drift apart.

| Section | Mission | Admits | Excludes |
|---|---|---|---|
| Headline | Name the professional scope the candidate wants to be interviewed on | role, domain, capability | internal team names, internal role labels, implementation protocols |
| Summary | **Interpret** the career: identity, level, current scope, differentiation | professional shape, lifecycle ownership, system scope, one memorable artifact | mechanism inventories, technology lists, retrieval keywords carried elsewhere |
| Experience | **Prove** scope, ownership, judgment and consequence | systems, decisions, mechanisms, measured outcomes, lifecycle responsibility | capability adjectives without an object, responsibility descriptions |
| Technical Skills | A compact, supported **retrieval index** | languages, frameworks, platforms, recognised technical capabilities | behavioural traits, narrative, proficiency ratings, unsupported posting terms |
| Projects | Distinct, externally **inspectable** implementation proof | what the artifact enables, differentiating engineering decisions, status labels | stack inventories before the object, adoption or release claims without evidence |
| Education | Carry formal learning | degree, institution, dates | production capability claims |
| Certifications | Carry credentialed capability | credential, issuer, verification link | implied production experience |

## The rule

> **A true statement in the wrong section is still an editorial defect.**

This is the case no per-sentence check can reach. Claim validation reports
"supported". The style checks report "well formed". The document is worse,
because the reader looked for an interpretation and found a parts list.

When a span is misplaced, the repair is `move` or `delete`, not `rewrite`.
Polishing a misplaced sentence makes the misplacement harder to see.

## Repetition has to do different work each time

Intentional repetition is legitimate. The test is whether each occurrence does a
different job for a different reader:

- **Purposeful.** `TypeScript` in Technical Skills serves retrieval; the same
  word inside the bullet that proves it serves credibility. Two readers, two
  jobs, one term. Nothing reports this.
- **Redundant.** A Summary sentence that restates a bullet spends the
  most-read line in the document previewing something the reader is about to
  read anyway. The audit reports it.

## Division of labour under compression

When space runs out, the question is never "which sentence is weakest". It is
"which section is carrying something another section carries better":

1. A mechanism in the Summary that Skills already carries → move or delete.
2. A bullet that proves what another bullet already proved → delete or combine.
3. A project that repeats Experience with different nouns → omit the project.
4. A skill whose only visible proof was just cut → re-select the skill, or
   restore the proof. Do not leave a listed skill with nothing behind it.

The last one is the dependency rule from #109 and #110. It has its own check
(`skill_dependency_stale`, `project_dependency_stale`) precisely because nothing
else notices: the claim ledger still supports the skill, so every claim-level
validator passes, and only the *document's* visible proof disappeared.
