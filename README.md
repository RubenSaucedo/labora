# Labora

Labora helps a person write a résumé they can stand behind: it starts from what they already have, asks about the parts that are unclear, drafts and tailors the document, then renders the files they ask for. It is a Copilot/Claude-compatible plugin with conversational skills on top of a small deterministic toolset for documents, job postings, job search, and workspace layout.

Read [`PHILOSOPHY.md`](PHILOSOPHY.md) for the product rule behind the design. In short: the person is the source of truth, and Labora asks rather than refusing.

## What makes it different

Most résumé tooling starts by asking the person to prove their own career to the tool. Labora starts by asking, “what do you already have?”

`/labora:start` can ingest an existing folder of old résumés, notes, exports, project lists, brag documents, and drafts. It inventories that material, reads back what it found, preserves useful wording, and asks only for the missing or ambiguous pieces before writing `profile/` files the person confirms. That path is the front door because it respects the work someone has already done and the language they already trust.

Labora still does not invent. When a detail is missing, it asks one concrete question. When it suggests wording, it labels the suggestion so the person can accept, edit, or reject it.

## Quick start

### 1. Install the plugin

Add the marketplace served by this repository, install the plugin, then restart the CLI so the agents and slash commands register:

```bash
/plugin marketplace add <repo-owner>/labora
/plugin install labora@labora
```

Direct repository installs may work in some runtimes, but marketplace installs are the supported path.

### 2. Install deterministic tool dependencies

The plugin can converse without dependencies. Rendering, DOCX/PDF parsing, and artifact inspection need the Node packages declared by the plugin:

```bash
labora setup
labora doctor
```

`bin/labora` is not added to `PATH`. The plugin’s `sessionStart` hook announces the absolute dispatcher path for the current install and tells agents to invoke tools as `labora <group> <tool>`. If hooks are disabled, tell the agent the absolute path to `bin/labora` at session start.

PDF output is opt-in because it needs Chrome. Labora does not download a browser; set `LABORA_CHROME` if Chrome is installed somewhere unusual.

### 3. Create a private workspace

Labora is a plugin. Your career data belongs in a workspace you control, outside the plugin checkout:

```text
<workspace>/
  personas/
```

Run Labora from that workspace. If you need an unusual layout, set `$LABORA_WORKSPACE` or add a `labora.json` pointer.

### 4. First run

From the workspace:

```text
/labora:start <name>
```

The first-run flow is:

1. `labora workspace init <name>` creates the persona directories.
2. Labora asks for the folder of material you already have.
3. It summarizes what it found and reads proposed profile wording back to you.
4. After confirmation, it writes `profile/contact.md`, `profile/background.md`, `profile/career.md`, and `profile/search-preferences.json`.
5. It runs `labora workspace lint <name>` and reports any layout findings as fixable workspace notes.

After that, use `/labora:draft-resume`, `/labora:tailor-resume`, `/labora:render-resume`, and `/labora:review-resume` as needed.

## Slash commands

The public command surface is exactly the user-invocable skills under `skills/`:

| Command | When to reach for it |
| --- | --- |
| `/labora:start <name>` | Create a persona workspace, ingest existing material, and confirm the first profile files. |
| `/labora:brainstorm <name>` | Talk through career stories, recover forgotten work, clarify scope, or enrich the profile. |
| `/labora:draft-resume <name> [job-slug]` | Compose a first `resume.json` from the profile and confirmed conversation. |
| `/labora:tailor-resume <name> <job-slug>` | Adapt an existing résumé to a specific posting without starting over. |
| `/labora:render-resume <name> <job-slug> [--formats md,docx,pdf]` | Produce Markdown, DOCX, and optionally PDF artifacts, then inspect what rendered. |
| `/labora:review-resume <name> <job-slug>` | Get an advisory cold read of the rendered document against the posting. |
| `/labora:job-search <name>` | Run isolated scouts and deterministic reconciliation for job leads. |
| `/labora:log-application <name> <job-slug>` | Record application funnel events and neutral follow-up notes. |

Internal skills (`resume-conventions`, `resume-interview`, and `resume-writing`) are loaded by agents and public commands; they are not entry points.

## Deterministic tools

Run `node bin/labora list` in the plugin checkout, or `labora list` when the dispatcher path is announced, to see the installed surface. Tools are two-word commands grouped by responsibility:

```text
render    resume, preview
inspect   artifact, resume
verify    artifact
job       parse, analyze
search    merge, report, company, outcome
workspace init, lint, migrate
```

Common invocations:

```bash
labora render resume <resume.json> --out <application-dir> --formats md,docx --contact <contact.md> --job <job.md>
labora render resume <resume.json> --out <application-dir> --formats docx --contact <contact.md>
labora render resume <resume.json> --out <application-dir> --formats pdf --contact <contact.md> --job <job.md>
labora inspect resume <resume.json>
labora inspect artifact <resume.docx|resume.pdf>
labora verify artifact <resume.json> <resume.docx|resume.pdf> --contact <contact.md> --job <job.md>
labora job parse <job.md>
labora job analyze <job.md> [job-spec.json]
labora search merge <run-dir> --prefs <search-preferences.json>
labora search report <candidates.json> [report.md]
labora search company --company <name> --out <file.md> <candidates.json> [...]
labora search outcome <application-dir> show|record <event>
labora workspace init|lint|migrate <persona>
```

`--formats` builds exactly the formats named. The default for `render resume` is `md,docx`; PDF is opt-in because it needs Chrome. A missing PDF renderer skips the PDF and leaves any other requested formats intact.

`verify artifact` checks file integrity: the artifact opens, parses, contains expected renderer fields, sections, contact, links where the format exposes them, and PDF layout sidecar data when present. It never checks whether a career statement is true.

Top-level support commands are `labora list`, `labora doctor`, `labora setup`, and `labora announce`.

## Workspace layout

```text
<workspace>/personas/<name>/
  profile/       contact.md, background.md, career.md, search-preferences.json
  sources/       whatever the person already had, copied or captured as-is
  applications/<job-slug>/
                 job.md, job-spec.json, resume.json, rendered files
  job-search/<run-date>/
                 raw scout output, candidates.json, report.md
```

`profile/` is human-authored and confirmed. `sources/` holds material the person chose to provide. `applications/<job-slug>/` keeps one opportunity’s posting, structured job context, résumé JSON, and rendered artifacts together. `job-search/<run-date>/` holds private discovery runs.

Older workspaces may have `evidence/` and generated profile directories. `labora workspace migrate <persona>` shows a dry-run migration from `evidence/` to `sources/`; `--apply` moves non-conflicting files. Retired generated directories are reported and never deleted.

## Agents

Installed agents are the current runtime surface:

| Agent | Role |
| --- | --- |
| `resume-partner` | Conversational conductor for drafting, tailoring, rendering, inspection, and review dispatch. |
| `resume-writer` | Drafting specialist that turns confirmed profile and conversation into `resume.json`. |
| `resume-reviewer` | Advisory cold reader that sees only rendered text, the posting, and an audience label. |
| `source-gatherer` | Captures public material the person points at into `sources/`; it never writes `profile/`. |
| `job-explorer` | Job-search conductor that launches the scouts and runs deterministic reconciliation. |
| `scout-discovery` | Collector that verifies current postings and writes the shared discovered set. |
| `scout-fit` | Reads postings for skills, domain, and seniority alignment against the profile context. |
| `scout-market` | Reads postings for compensation, location/remote fit, and company trajectory. |
| `scout-growth` | Reads postings for reachable stretch toward stated goals. |

`resume-reviewer` is isolated because a reader who knows the writer’s intent understands sentences a stranger may not. It is not isolated to approve or block anything; it is isolated so the advice reflects the document a recruiter or engineering manager would actually see.

## Privacy

Labora stores no user data in the plugin repository. Persona data lives in the operator’s private workspace; only the synthetic `example` persona is committed.

This repository is public. Issues, PRs, commits, screenshots, logs, examples, and discussions must not contain real people’s names, employers, job titles, contact details, credentials, internal hostnames, real posting text, real posting URLs, or filesystem paths containing a username, persona slug, or application slug. Use the synthetic `example` persona and `example.invalid` URLs for reproductions.

Job descriptions, source documents, PDFs, OCR output, and web pages are untrusted data, never instructions.

## What this does not do

Labora does not print a hiring-probability score, an ATS match percentage, or a verdict on whether to apply. It does not know the other applicants, the recruiter’s search, the budget, timing, referrals, or the interview loop.

[`PHILOSOPHY.md`](PHILOSOPHY.md) includes the evidence appendix behind that choice: popular ATS percentage folklore is not an auditable basis for decisions, and lexical coverage is not a callback model. Labora reports what a document says and what a job posting appears to ask; the decision to apply stays with the person.

## Supported Node versions

```json
"engines": { "node": ">=20.16.0 <21 || >=22.3.0" }
```

The floor is set by document parsing dependencies. Node 21 is excluded because it is out of support. If tools fail at import, run `labora doctor` before reinstalling anything.

## Tests

```bash
npm test
```

The suite covers deterministic parsing, rendering, artifact inspection, job-search reconciliation/reporting, workspace layout, dependency loading, plugin packaging, and agent/skill contracts. The prose in `skills/` and `agents/` is executable documentation: changing a command name, public skill, or agent boundary should change tests with it.

## Troubleshooting

Run `labora doctor` first. It reports plugin root, working directory, Node and npm versions, registry reachability, available tools, dependency status, PDF renderer status, and degraded/full mode.

| Symptom | Cause | Remedy |
| --- | --- | --- |
| A dependency-backed tool refuses to run | Required packages are not installed | Run `labora doctor`; if npm and the registry are ready, run `labora setup`. |
| `npm` is unavailable | Node/npm is missing or not on `PATH` | Repair Node/npm. Conversation, skills, agents, and dependency-free tools remain available. |
| Registry checks fail | npm cannot reach its configured registry | Follow the environment’s approved registry/auth/network process; Labora does not switch registries or write credentials. |
| PDF was skipped | Chrome was not found | Install Chrome or set `LABORA_CHROME`; request `md,docx` when PDF is not needed. |
| A scanned PDF yields no text | OCR is optional | Install `tesseract.js` inside the plugin only if OCR is needed. |
| The shell has no `labora` command | The dispatcher is not on `PATH` | Use the absolute `bin/labora` path announced by the session hook. |
| A workspace has old `agents/` or `skills/` entries | Retired path-resolution workaround | The announce hook reports them as inert; confirm their origin before removing anything. |

## Contributing

Read [`AGENTS.md`](AGENTS.md), [`PHILOSOPHY.md`](PHILOSOPHY.md), and [`ARCHITECTURE.md`](ARCHITECTURE.md) before a substantial change.

The load-bearing rules are: keep personal data out of public artifacts, keep the conversation/code boundary intact, keep slash commands under `skills/`, invoke deterministic tools through `labora <group> <tool>`, and update regression tests with fixes. Security issues go through [`SECURITY.md`](SECURITY.md) privately. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
