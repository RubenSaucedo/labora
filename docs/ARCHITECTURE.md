# Labora architecture

Labora is a conversation with a small deterministic core. The conversation asks,
drafts, tailors, renders, and advises. Code touches files.

## Big picture

```text
+--------------------------------------------------------------------------+
|                                  person                                  |
|                 source of truth; chooses what to say next                |
+------------------------------------+-------------------------------------+
                                     |
                                     v
+--------------------------------------------------------------------------+
|                           conversation layer                            |
|                                                                          |
|  skills: start, brainstorm, draft-resume, tailor-resume, render-resume   |
|          review-resume, job-search, log-application                      |
|                                                                          |
|  agents: resume-partner, resume-writer, resume-reviewer, source-gatherer |
|          job-explorer, scout-discovery, scout-fit, scout-market,         |
|          scout-growth                                                    |
+------------------------------------+-------------------------------------+
                                     |
                      invokes tools; reports results back
                                     v
+--------------------------------------------------------------------------+
|                           deterministic core                            |
|                                                                          |
|  render     inspect     verify     job     search     workspace          |
|  documents  text        files      posts   runs       layout             |
+------------------------------------+-------------------------------------+
                                     |
                              reads and writes
                                     v
+--------------------------------------------------------------------------+
|                              workspace disk                             |
|                                                                          |
|  personas/<name>/profile/       human-authored career account            |
|  personas/<name>/sources/       captured material, as-is                 |
|  personas/<name>/applications/  postings, resume JSON, rendered files    |
|  personas/<name>/job-search/    discovery runs and reports               |
+--------------------------------------------------------------------------+
```

Everything the person is told flows through the conversation layer. The code
only reads and writes files, parses structured inputs, and reports file facts.

## Flow from nothing to a rendered resume

```text
+---------+    +------------+    +--------------+    +---------------+
|  start  | -> | brainstorm | -> | draft-resume | -> | tailor-resume |
+---------+    +------------+    +--------------+    +---------------+
     |               |                  |                    |
     v               v                  v                    v
 profile/       profile/          applications/        applications/
 contact.md     confirmed         <job-slug>/          <job-slug>/
 background.md  additions         resume.json          job-spec.json
 career.md      or questions                            resume.json
 search-
 preferences.json
 sources/ if copied

+---------------+    +---------------+    +-----------------+
| render-resume | -> | review-resume | -> | log-application |
+---------------+    +---------------+    +-----------------+
        |                    |                    |
        v                    v                    v
 applications/         no required file;    applications/
 <job-slug>/           advisory notes       <job-slug>/
 resume.md             in conversation      outcome.json
 resume.docx
 resume.pdf when asked
 resume.pdf.layout.json
```

`review-resume` reads the rendered document text and the posting. It does not
need the profile to do its job, and it does not write an approval file.

## Agent topology

```text
+----------------+
| resume-partner |
+-------+--------+
        |
        +--> source-gatherer
        |    sees: public sources the person named
        |    writes: sources/
        |    denied: credentials, forms, profile/, applications/
        |
        +--> resume-writer
        |    sees: profile/, job files, existing resume.json,
        |          confirmed conversation supplied by resume-partner
        |    writes: resume.json
        |    denied: browsing, private sources not supplied, reviewer intent
        |
        +--> resume-reviewer
             sees: rendered document text + posting + audience label only
             writes: advisory notes
             denied: profile/, sources/, notes, drafts, writer reasoning
```

```text
+--------------+
| job-explorer |
+------+-------+
       |
       +--> scout-discovery
       |    sees: search preferences, configured sources, public postings
       |    writes: raw/discovered.json
       |    denied: applying, login handling, fit/market/growth judgment
       |
       +--> scout-fit
       |    sees: raw/discovered.json, profile context, preferences
       |    writes: raw/scout-fit.json
       |    denied: applying, final reconciliation
       |
       +--> scout-market
       |    sees: raw/discovered.json, profile context, preferences
       |    writes: raw/scout-market.json
       |    denied: applying, final reconciliation
       |
       +--> scout-growth
            sees: raw/discovered.json, profile context, preferences
            writes: raw/scout-growth.json
            denied: applying, final reconciliation

       then: labora search merge -> candidates.json
             labora search report -> report.md
```

`resume-reviewer` is the important isolation boundary. It receives only the text
a reader would see and the posting. A reader who knows the profile and drafting
intent is no longer reading like a stranger.

## Tool namespace

```text
labora
|
+-- list                      show installed grouped tools
+-- doctor                    report install health and mode
+-- setup                     install declared dependencies into the plugin
|
+-- render
|   +-- resume                build md, docx, and/or pdf from resume.json
|   +-- preview               render PDF pages and a preview manifest
|
+-- inspect
|   +-- resume                convert resume.json to plain text
|   +-- artifact              extract parser-visible text from DOCX or PDF
|
+-- verify
|   +-- artifact              check produced DOCX/PDF integrity, never truth
|
+-- job
|   +-- parse                 read posting title, company, description
|   +-- analyze               extract structured posting context
|
+-- search
|   +-- merge                 reconcile discovery and scout reports
|   +-- report                render candidates.json as a human report
|   +-- company               filter existing results by company
|   +-- outcome               show or record application funnel events
|
+-- workspace
    +-- init                  create persona directories
    +-- lint                  report workspace layout findings
    +-- migrate               plan or apply legacy layout migration
```

## Workspace on disk

```text
personas/<name>/
|
+-- profile/
|   +-- contact.md
|   +-- background.md
|   +-- career.md
|   +-- search-preferences.json
|
+-- sources/
|   +-- old resumes, notes, exports, public captures, as-is
|
+-- applications/
|   +-- <job-slug>/                  flat, or ...
|   +-- <YYYY-MM-DD>/<job-slug>/     ... grouped by the date work began
|       +-- job.md
|       +-- job-spec.json
|       +-- resume.json
|       +-- resume.md
|       +-- resume.docx
|       +-- resume.pdf
|       +-- resume.pdf.layout.json
|       +-- outcome.json
|
+-- job-search/
    +-- <run-date>/
        +-- raw/
        |   +-- discovered.json
        |   +-- scout-fit.json
        |   +-- scout-market.json
        |   +-- scout-growth.json
        +-- candidates.json
        +-- report.md
        +-- seen.json
```

Either application layout works, and they can be mixed. Every tool takes an
explicit application path, so grouping is a filing choice with no functional
consequence. A directory is an application when it holds `job.md`,
`job-spec.json` or `resume.json`; anything else that parses as a date is a
container. Recognising a leaf by contents rather than by depth means a slug that
genuinely is a date still reads as an application.

## The boundary

```text
+---------------------------------------------------------------+-------------+
| Question                                                      | Owner       |
+---------------------------------------------------------------+-------------+
| Could this contradict the person about their own career?       | Conversation|
| Is this a fact about a file opening, parsing, or rendering?    | Code        |
| Is this a posting structure that helps the conversation focus? | Code        |
| Is this a judgment about what the person's career proves?      | Conversation|
| Is this a workspace path or migration fact?                    | Code        |
+---------------------------------------------------------------+-------------+
```

If the answer could contradict the person about their own career, Labora asks.
If the answer is a fact about a file or workspace, deterministic code may own
it.

## Resume document contract

The résumé contract lives in `src/schemas/resume.js`. `ZResume` is the shape the
conversation writes and the renderer reads:

```text
schema_version, target_role, ats_title, contact, summary,
skills_primary, skills_secondary,
experience[{ id, company, role, period, location, bullets }],
education[], projects[], certifications[], awards_or_contributions[],
presentation, notes[]
```

Stored `contact` stays blank by design. Rendering injects contact from
`profile/contact.md`, so a shared `resume.json` does not carry contact details.

`presentation` carries operator-approved section labels and skill groupings.
Those are words and arrangements on the page, so `src/schemas/resume-
presentation.js`
requires `approvedBy: "operator"` and checks grouped skills against skills
already
present in the résumé.

`notes[]` is shared working text for open questions and suggestions. It is not
rendered.

`readResume()` accepts old claim-era documents and drops fields such as
`provenance`, `keywords_mapped`, `gaps_or_risks`, `notes_for_human`, and
`experience[].progression`. Old documents stay readable because the person's
content is still useful even though the old machinery is gone.

## What each tool group owns

`render` owns document production. `render resume` reads `resume.json`, injects
contact when provided, optionally loads job context, applies the presentation
projection, and writes only requested formats. `render preview` turns a PDF into
page images and a manifest for visual inspection. It does not rewrite content.

`inspect` owns read-back. `inspect resume` turns résumé JSON into plain text.
`inspect artifact` extracts text from DOCX or PDF. It does not infer truth from
that text.

`verify` owns artifact integrity. `verify artifact` checks that a DOCX or PDF
opens, parses, recalls expected renderer fields, contains expected sections and
contact fields, preserves DOCX links when available, and can use PDF layout
metadata when present. It never checks whether a career statement is true.

`job` owns posting parsing. `job parse` reads title, company, and description.
`job analyze` extracts requirements, preferred items, responsibilities,
eligibility cues, and non-requirement flags. Posting text is untrusted data.

`search` owns deterministic job-search reconciliation. It merges scout reports,
renders reports, filters existing results by company, and records funnel events.
It proposes leads for attention. It does not apply.

`workspace` owns layout. It creates persona directories, reports layout drift,
and migrates `evidence/` to `sources/` when asked. It never writes profile
content on its own.

## Rendering pipeline

```text
resume.json
    |
    v
readResume()
    |
    v
contact injection from profile/contact.md
    |
    v
optional job context from job.md
    |
    v
presentation projection in src/agents/format-resume.js
    |
    +--> Markdown
    +--> DOCX
    +--> PDF via Chromium text layer
             |
             v
        resume.pdf.layout.json
```

Style profiles live in `src/lib/resume-style.js`. The installed profile IDs are
`precision-minimal` and `editorial-technical`. A profile controls typography,
spacing, color, contact-row grouping, section order, pagination policy, and
layout thresholds. It does not add words.

PDF rendering records measured layout beside the PDF as
`<resume.pdf>.layout.json`. `verify artifact` and `render preview` read that
sidecar when present. The measurement is reported, not acted on.

## Job posting parsing and job discovery

Job parsing exists to give the conversation precise context. `src/lib/job-
parser.js`
loads posting text. `src/lib/job-requirements.js` extracts structured
requirements, responsibilities, eligibility cues, and boilerplate signals. The
result informs questions and tailoring; it is not a decision engine.

Job discovery uses isolated agents plus deterministic reconciliation:

```text
search-preferences.json
        |
        v
job-explorer
        |
        +--> scout-discovery ----> raw/discovered.json
        |
        +--> scout-fit ----------> raw/scout-fit.json
        +--> scout-market -------> raw/scout-market.json
        +--> scout-growth -------> raw/scout-growth.json
        |
        v
labora search merge -----------> candidates.json
        |
        v
labora search report ----------> report.md
```

Browsing is read-only and human-login-only. Agents never handle passwords,
submit forms, send messages, or auto-apply.

## What was removed, and why

The removed architecture included:

- claim ledger;
- accomplishment bank;
- generated profile;
- evidence manifests;
- strategy validation;
- gap triage;
- ATS requirement scoring;
- editorial and baseline plans;
- section plans;
- observation records;
- quality gate;
- release approval;
- the three judges.

The structural reason was false negatives from deterministic truth gates over a
person's own career. The repository history records the pattern: most declared
gaps were not gaps (#7), rendered qualifying claims were still counted missing
(#2), private-source work was treated as absence despite a live product (#30),
policy prose was mistaken for a hard eligibility problem (#1), and the release
model gave the tool authority to stop the user (#89).

Honesty was not abandoned. The mechanism moved from refusing to asking. Labora
writes what the person confirms, labels suggestions as suggestions, asks when
scope or numbers are unclear, and keeps open questions visible.

## Testing strategy

Run the deterministic suite with:

```bash
npm test
```

The tests cover schema compatibility, rendering, artifact inspection and
integrity, style profiles, job parsing, job-search reconciliation and reporting,
workspace layout, dependency loading, packaging, and agent/skill contracts.

Two contract tests are load-bearing:

- `test/plugin-packaging.test.js` protects the installed surface: manifest
  paths,
  version agreement, skill metadata, explicit `user-invocable` declarations,
  dispatcher behavior, dependency-free startup, marketplace metadata, and the
  public privacy boundary.
- `test/agent-architecture.test.js` protects agent and skill architecture:
  frontmatter, runtime tool names, browser-tool boundaries, dispatch names,
  deterministic command references, job-search scout contracts, and the
  `resume-reviewer` isolation boundary.

A package that documents commands or agents the runtime does not expose is a
broken package, even if the prose reads well.
