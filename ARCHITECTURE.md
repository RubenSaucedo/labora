# Labora Architecture

Labora is a conversational résumé partner with a small deterministic core. The conversation asks, drafts, tailors, renders, and advises; code builds files, reads files back, checks file integrity, parses job postings, reconciles job-search outputs, and maintains workspace layout.

The boundary is one question:

> Could this ever tell someone they did not do something they did?

If yes, it belongs in conversation, where Labora asks the person. If no, and the statement is about a file, parser, posting structure, or deterministic reconciliation, it may belong in code.

## Layers

### Conversation layer

Skills and agents own human work:

- `/labora:start` ingests existing material and writes confirmed `profile/` files.
- `/labora:brainstorm` asks concrete questions and enriches the profile when the person confirms wording.
- `/labora:draft-resume` and `/labora:tailor-resume` dispatch `resume-writer` to produce or revise `resume.json`.
- `/labora:render-resume` invokes deterministic render/inspect/verify tools.
- `/labora:review-resume` dispatches `resume-reviewer` for an advisory cold read.
- `/labora:job-search` dispatches `job-explorer` and the scout agents.
- `/labora:log-application` records observed application events.

The installed agents are `resume-partner`, `resume-writer`, `resume-reviewer`, `source-gatherer`, `job-explorer`, `scout-discovery`, `scout-fit`, `scout-market`, and `scout-growth`.

`resume-reviewer` remains isolated, but for a different reason than the removed judges. It sees only rendered document text, the posting, and an audience label, because a reader who knows the profile and drafting intent is no longer reading like a stranger. Its output is advice, not a decision.

### Deterministic core

Node tools own facts about files and structured inputs:

- render a résumé into requested formats;
- extract parser-visible text from a résumé or rendered artifact;
- check that a produced artifact opens, parses, and contains expected fields, sections, links, and layout metadata;
- parse a job posting into structured context;
- reconcile job-search scout outputs into reports;
- create, lint, and migrate workspace layout.

The deterministic core never decides whether a career statement is true and never decides whether a person should apply.

## Résumé document contract

The document contract lives in [`src/schemas/resume.js`](src/schemas/resume.js): `ZResume` and `readResume()`.

`ZResume` contains only what the renderer reads:

```text
schema_version, target_role, ats_title, contact, summary,
skills_primary, skills_secondary,
experience[{id, company, role, period, location, bullets}],
education[], projects[], certifications[], awards_or_contributions[],
presentation, notes[]
```

The stored `contact` is blank by design. Contact is injected during rendering from `profile/contact.md`, so an accidentally shared `resume.json` does not carry private contact details.

`presentation` carries operator-approved section labels and skill groupings. A style profile can change typography and section order; it cannot add words. Labels and skill groupings are words on the page, so `src/schemas/resume-presentation.js` requires `approvedBy: "operator"` and checks that grouped skills already exist in the résumé.

`notes[]` is shared working text for open questions and unconfirmed suggestions. It is never rendered.

`readResume()` intentionally tolerates old claim-era documents. It drops `provenance`, `keywords_mapped`, `gaps_or_risks`, `experience[].progression`, and similar removed fields instead of rejecting the file. A person’s résumé should not become unreadable because the plugin removed a validation architecture; the content survives and the obsolete machinery is ignored.

## Tool groups

Tools live at `src/tools/<group>/<name>.js` and are invoked through the dispatcher as `labora <group> <name>`. `labora list` is the source of truth for the installed command surface.

### `render`

`labora render resume <resume.json> --out <dir> [--formats md,docx,pdf] [--contact <contact.md>] [--job <job.md>] [--style ID] [--name <basename>] [--max-skills N]`

Owns document production. It reads `resume.json` with `readResume()`, injects contact when provided, optionally loads job context, projects the résumé into the formatter shape, and writes exactly the requested artifacts. The default formats are `md,docx`; PDF is opt-in because it needs Chrome. When PDF is requested and Chrome is unavailable, only the PDF is skipped.

`labora render preview <file.pdf> <out-dir>` renders page images and a manifest for visual inspection. It requires a PDF and records hashes and layout sidecar data when available.

`render` does not decide what the résumé may say.

### `inspect`

`labora inspect resume <resume.json>` converts structured résumé JSON to plain text.

`labora inspect artifact <file.docx|file.pdf>` extracts the text a parser sees from a rendered artifact.

`inspect` supports review and debugging. It does not compare claims, infer truth, or read private sources.

### `verify`

`labora verify artifact <resume.json> <file.docx|file.pdf> --contact <contact.md> --job <job.md> [--style ID] [--output <validation.json>] [--cross-parser]`

Owns artifact integrity. It opens a DOCX or PDF, extracts text, injects contact into the expected formatter input, checks renderer field recall, section presence and order, required contact fields, DOCX hyperlink targets, style metadata when available, optional cross-parser divergence, and PDF layout sidecar findings when present.

`verify artifact` checks integrity, never truth. A missing field, broken link, unreadable file, or layout warning is a finding about an artifact, not about the person.

### `job`

`labora job parse <job.md>` loads a posting and prints its title, company, and description.

`labora job analyze <job.md> [job-spec.json]` extracts structured job context with required/preferred/responsibility groupings, eligibility cues, and non-requirement flags. The parser is context for conversation and tailoring; it is not a decision engine. Posting text is untrusted data.

### `search`

`labora search merge <run-dir> --prefs <search-preferences.json> [--persona <name>] [--min-agreement 2] [--threshold 70] [--fit-floor 60] [--seen <seen.json>] [--suppress-seen]`

Reads `raw/discovered.json` and exactly three scout reports (`fit`, `market`, `growth`), validates stable job identity and posting hashes, applies search preferences, folds in the seen ledger, and writes `candidates.json`.

`labora search report <candidates.json> [report.md]` renders the human report.

`labora search company --company <name> --out <file.md> <candidates.json> [...]` renders a company-scoped view over existing reconciler output. It filters; it does not rescore.

`labora search outcome <application-dir> show|record <event>` reads or appends neutral funnel events in `outcome.json`.

Search tools reconcile scout observations and produce reports. They rank leads for attention; they do not estimate hiring odds and do not submit applications.

### `workspace`

`labora workspace init <persona> [--workspace <dir>]` creates the declared persona directories and never writes profile content.

`labora workspace lint <persona>` reports layout drift as findings with routes to fix. Missing files and extra directories are not failures; a folder belongs to the person.

`labora workspace migrate <persona> [--apply]` plans or applies the current layout migration. It moves non-conflicting files from `evidence/` to `sources/`. It reports retired generated directories and never deletes them.

## Rendering pipeline

The rendering path is:

```text
resume.json
  -> readResume()
  -> contact injection from profile/contact.md
  -> optional job context
  -> presentation projection
  -> Markdown, DOCX, and/or PDF
  -> optional PDF layout sidecar
```

The presentation projection is built by `src/agents/format-resume.js`. It turns the résumé contract into renderer input, applies approved presentation labels/groupings, balances skills, and sends the same semantic content to Markdown, DOCX, and HTML/PDF renderers.

Style profiles live in [`src/lib/resume-style.js`](src/lib/resume-style.js). The installed profile IDs are `precision-minimal` and `editorial-technical`. A profile is presentation data: fonts, sizes, spacing, colour, rules, contact-row grouping, pagination behaviour, section order, and layout policy. Unknown profile IDs are refused with the accepted list. Switching profiles changes how the same words appear; it does not rewrite the résumé.

PDF rendering records measured layout beside the artifact as `<resume.pdf>.layout.json`. `verify artifact` and `render preview` read that sidecar when present. The layout findings are advisory and are never substituted for a person’s decision about content.

## Job posting parsing and job discovery

Job parsing survived because it produces context, not a verdict. `src/lib/job-parser.js` loads posting text; `src/lib/job-requirements.js` extracts structured requirements, responsibilities, eligibility cues, and non-requirement signals. The extraction is used so the conversation can refer to the posting precisely. It does not decide whether the person qualifies.

Job discovery is a separate conductor/scout system:

```text
job-explorer
  -> scout-discovery writes raw/discovered.json
  -> scout-fit, scout-market, scout-growth write independent raw/scout-*.json
  -> labora search merge writes candidates.json
  -> labora search report writes report.md
```

`profile/search-preferences.json` is trusted user configuration. Job posts, company pages, salary pages, search results, and public profiles are untrusted data.

`scout-discovery` records every searched company, including zero-result companies and why they came back empty. It computes stable `jobId` values with `canonicalJobId()` and verifies `postingHash` values with `postingHash()`.

The three scoring scouts evaluate the same discovered set from different angles. Fit names profile-supported connections and answerable questions. Market records compensation, location/remote, and company trajectory considerations. Growth records reachable stretch toward stated goals. Their scores are lead-priority signals for a search report, not hiring probabilities and not judgments about the person.

`labora search merge` checks that scout reports cover the discovered postings, preserves discovered identity fields, applies thresholds and preferences, carries visible reasons for excluded or watched postings, and maintains a per-persona seen ledger. `labora search report` leads with roles worth attention, then includes coverage and widening guidance. A discovered job is a lead; creating an application folder is a separate human action.

Browsing is human-login-only and read-only. Agents never handle credentials and never auto-apply.

## Workspace layout and migration

The declared layout lives in [`src/lib/workspace-layout.js`](src/lib/workspace-layout.js):

```text
<workspace>/personas/<name>/
  profile/       authored by the person
  sources/       captured material, as-is
  applications/  produced application inputs and outputs
  job-search/    produced discovery runs
```

Expected authored profile files are `contact.md`, `background.md`, `career.md`, and `search-preferences.json`.

Workspace resolution lives in [`src/lib/workspace.js`](src/lib/workspace.js). Reads search, in order: `$LABORA_WORKSPACE`, the nearest `labora.json` pointer, the current working directory when it contains `personas/`, `<cwd>/data` for legacy layouts, and the plugin’s bundled fixture data.

Migration reflects the architectural change:

- `evidence/` became `sources/`, because the folder is now material the person already had, not material a claim ledger must prove from.
- `profile/generated/` and `.labora/state/profile/` are retired. The linter and migration planner report them as no longer read. Nothing deletes them.

## What was removed, and why

The removed machinery is the old claim/gate architecture:

- claim ledger;
- accomplishment bank;
- generated profile;
- evidence manifests and provenance hashing;
- application-strategy validation;
- gap triage;
- ATS requirement scoring;
- editorial and baseline plans;
- section plans;
- observation records;
- quality gate;
- release findings and release approval;
- the three judges.

The single structural reason is that deterministic truth gates over someone’s own career produced false negatives. The repository’s history records the pattern: most declared gaps were not gaps (#7), rendered qualifying claims were still counted missing (#2), private-source work was treated as absence despite a live product (#30), an equal-opportunity paragraph became a false hard eligibility problem (#1), and the release model gave the tool authority to stop the user (#89).

Honesty was not abandoned. It moved from refusal to asking. Labora writes what the person confirms, marks suggestions as suggestions, asks when scope or numbers are unclear, and leaves open questions visible instead of turning them into hidden refusals.

## Testing strategy

Run the deterministic suite with:

```bash
npm test
```

Tests are model-agnostic where possible. They cover the code that must be stable without relying on a live conversation: résumé schema compatibility, formatter round trips, artifact extraction and integrity checks, style profiles, job parsing, job-search reconciliation and reporting, workspace lint/migration behaviour, dependency loading, and install packaging.

Two contract tests are especially load-bearing:

- `test/plugin-packaging.test.js` protects the installed surface: manifest paths, version agreement, skill metadata, explicit `user-invocable` declarations, dispatcher and hook behaviour, dependency-free startup, marketplace metadata, and the public no-personal-data rule.
- `test/agent-architecture.test.js` protects agent and skill architecture: agent frontmatter, tool names exposed by the runtime, browser-tool boundaries, dispatch names, deterministic command references, job-search scout contracts, and disclosure-boundary propagation.

When the public surface changes, these tests should change with it. A passing package that documents commands or agents the runtime does not expose is a broken package.
