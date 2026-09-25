# Labora

Labora is a conversational résumé partner: it starts with the career material
you already have, asks about the parts that are unclear, drafts and tailors the
résumé in your words, renders only the files you ask for, and reads the result
back the way a stranger would. You are the source of truth. Labora helps you say
what you did clearly; it does not decide whether you should apply.

For the product rule behind that design, read [PHILOSOPHY.md](PHILOSOPHY.md).
For the system shape, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you get

- It starts from the material you already have instead of making you face a
  blank page.
- It asks about the parts that are unclear instead of guessing or refusing.
- It writes in your words and tells you when it is suggesting rather than
  repeating.
- It produces the file formats you actually need, and only those.
- It reads the finished document back the way a stranger would.
- It never tells you that you are not a fit.

## Install

Add the marketplace served by this repository, install the plugin, then restart
the CLI so the agents and slash commands register:

```text
/plugin marketplace add RubenSaucedo/labora
/plugin install labora@labora
```

Install the deterministic tool dependencies inside the plugin:

```bash
labora setup
labora doctor
```

The plugin can still converse without dependencies. Rendering, DOCX/PDF parsing,
artifact inspection, and OCR need the Node packages declared by the plugin.
`labora doctor` reports whether you are in full mode or degraded mode, and
whether npm, the registry, dependencies, and Chrome are available.

PDF output is opt-in because it needs Chrome. Labora does not download a
browser. Install Chrome yourself or set `LABORA_CHROME` if Chrome lives
somewhere unusual. A missing browser skips the PDF and leaves Markdown or DOCX
output intact.

The installed session hook announces the absolute dispatcher path. In this
repository checkout you can also run the same dispatcher as `node bin/labora
...`.

## Your first ten minutes

Use the committed synthetic `example` persona so you do not need real career
data. The example application lives at:

```text
data/personas/example/applications/acme-senior-fe-mar-25/
```

Run the commands in this order from this repository checkout. If you installed
the plugin elsewhere, use the announced `labora` dispatcher instead of `node
bin/labora`.

| Step | Command | What it produces |
| --- | --- | --- |
| 1 | `node bin/labora list` | The installed deterministic command surface. |
| 2 | `node bin/labora doctor` | Install health: Node, npm, registry, dependencies, Chrome, and mode. |
| 3 | `/labora:start example` | The intake flow for the synthetic persona; confirmed wording belongs in `profile/`. |
| 4 | `/labora:brainstorm example` | A conversation for recovering or clarifying profile material. It writes only confirmed `profile/` changes. |
| 5 | `/labora:draft-resume example acme-senior-fe-mar-25` | `applications/acme-senior-fe-mar-25/resume.json` or suggested changes to it. |
| 6 | `/labora:tailor-resume example acme-senior-fe-mar-25` | A posting-aware revision of the same `resume.json`, with open questions left visible. |
| 7 | `/labora:render-resume example acme-senior-fe-mar-25 --formats md,docx` | `resume.md` and `resume.docx`, plus inspection and integrity output. |
| 8 | `node bin/labora inspect artifact data/personas/example/applications/acme-senior-fe-mar-25/resume.docx` | The text a parser sees in the rendered DOCX. |
| 9 | `/labora:review-resume example acme-senior-fe-mar-25` | Advisory reader notes from `resume-reviewer`; no send or do-not-send decision. |
| 10 | `/labora:log-application example acme-senior-fe-mar-25` | `outcome.json` events for the application folder when you record one. |

Useful direct checks on the same example:

```bash
node bin/labora inspect resume data/personas/example/applications/acme-senior-fe-mar-25/resume.json
node bin/labora job parse data/personas/example/applications/acme-senior-fe-mar-25/job.md
node bin/labora verify artifact \
  data/personas/example/applications/acme-senior-fe-mar-25/resume.json \
  data/personas/example/applications/acme-senior-fe-mar-25/resume.docx \
  --contact data/personas/example/profile/contact.md \
  --job data/personas/example/applications/acme-senior-fe-mar-25/job.md
```

## The commands

Public slash commands come from user-invocable skills under `skills/`.

| Command | When you reach for it | What it leaves behind |
| --- | --- | --- |
| `/labora:start <name>` | You are creating a persona or importing existing career material. | `profile/contact.md`, `profile/background.md`, `profile/career.md`, `profile/search-preferences.json`, and any captured `sources/` the person confirms. |
| `/labora:brainstorm <name>` | You want to recover stories, clarify contribution level, or enrich the profile. | Confirmed edits to `profile/`, or open questions in the conversation. |
| `/labora:draft-resume <name> [job-slug]` | You need a first general or application résumé. | `applications/<job-slug>/resume.json`, or `applications/general/resume.json` if no job slug is used. |
| `/labora:tailor-resume <name> <job-slug>` | You already have a résumé and want it adapted to a posting. | An updated `applications/<job-slug>/resume.json` and a summary of material changes. |
| `/labora:render-resume <name> <job-slug> [--formats md,docx,pdf]` | You want files to submit or inspect. | `resume.md`, `resume.docx`, `resume.pdf` when requested and available, plus PDF layout metadata when PDF renders. |
| `/labora:review-resume <name> <job-slug>` | You want an advisory cold read before deciding what to do next. | Suggestions in the conversation; edits happen only if you choose them. |
| `/labora:job-search <name>` | You want current leads from configured sources. | `job-search/<run-date>/raw/`, `candidates.json`, and `report.md`. |
| `/labora:log-application <name> <job-slug>` | You want to record what happened after applying or following up. | `applications/<job-slug>/outcome.json`. |

Internal skills exist for conventions, interviewing, writing, and editorial
method. They are not slash-command entry points.

## Working with your own files

Labora is a plugin and stores no user data in the plugin repository. Your files
live in a workspace you control:

```text
<workspace>/
  personas/
    <name>/
      profile/
        contact.md
        background.md
        career.md
        search-preferences.json
      sources/
      applications/<job-slug>/
        job.md
        job-spec.json
        resume.json
        resume.md
        resume.docx
        resume.pdf
      job-search/<run-date>/
        raw/
        candidates.json
        report.md
```

`profile/` is your own account of your career. Labora may help draft it, but it
should read wording back and save only what you confirm. `sources/` holds
material you already had, as-is. `applications/<job-slug>/` keeps one
opportunity's posting, parsed context, résumé JSON, rendered files, and outcome
log together.

Once a workspace has enough applications that a flat list stops being
scannable, you can group them by the date you started:

```text
      applications/2026-08-03/<job-slug>/
```

Both layouts work, and you can mix them. Every command takes the application
path you give it, so nothing has to be told which style you use.

Workspace resolution is deterministic. Reads search in this order:

1. `$LABORA_WORKSPACE`.
2. The nearest `labora.json` containing a `workspace` pointer.
3. The current directory when it contains `personas/`.
4. `<cwd>/data` for legacy layouts.
5. The plugin's bundled `data/` fixture for the synthetic `example` persona.

A `labora.json` pointer is plain JSON:

```json
{ "workspace": "../labora-workspace" }
```

## The tools

Run `labora list` to see the installed grouped namespace. The same commands work
as `node bin/labora ...` in this checkout.

| Group | Tools | Purpose |
| --- | --- | --- |
| `render` | `resume`, `preview` | Build requested résumé formats and preview PDF pages. |
| `inspect` | `resume`, `artifact` | Read structured résumé JSON or rendered DOCX/PDF text back as text. |
| `verify` | `artifact` | Check that a produced DOCX/PDF opens, parses, and contains expected renderer fields, sections, links, and layout metadata where available. |
| `job` | `parse`, `analyze` | Parse a posting and build structured context for conversation and tailoring. |
| `search` | `merge`, `report`, `company`, `outcome` | Reconcile scout outputs, render job-search reports, filter company views, and log funnel events. |
| `workspace` | `init`, `lint`, `migrate` | Create persona directories, report layout drift, and plan or apply layout migration. |

Common invocations:

```bash
labora render resume <resume.json> --out <dir> --formats md,docx,pdf --contact <contact.md> --job <job.md>
labora inspect resume <resume.json>
labora inspect artifact <resume.docx|resume.pdf>
labora verify artifact <resume.json> <resume.docx|resume.pdf> --contact <contact.md> --job <job.md>
labora job parse <job.md>
labora job analyze <job.md> [job-spec.json]
labora search merge <run-dir> --prefs <search-preferences.json>
labora search report <candidates.json> [report.md]
labora search company --company <name> --out <file.md> <candidates.json> [...]
labora search outcome <application-dir> show
labora search outcome <application-dir> record <event>
labora workspace init <persona>
labora workspace lint <persona>
labora workspace migrate <persona> [--apply]
```

`--formats` builds exactly the named formats. The default for `render resume` is
`md,docx`; PDF is opt-in because it needs Chrome.

`verify artifact` checks artifact integrity, never whether a career statement is
true.

## What Labora will not do

Labora does not print a hiring-probability score, an ATS match percentage, or a
verdict on whether to apply. It cannot see the other applicants, the recruiter
search, timing, budget, referrals, or the interview loop.

Labora does not auto-apply, submit forms, send messages, or handle passwords.
Job discovery is read-only and human-login-only. If a site requires
authentication, you log in yourself or provide an export.

Labora does not treat silence in your files as absence from your career. If
something is unclear, the right next step is a question. See
[PHILOSOPHY.md](PHILOSOPHY.md) for why that boundary exists.

## Troubleshooting

Run `labora doctor` first.

| Symptom | Likely cause | Remedy |
| --- | --- | --- |
| A dependency-backed tool refuses to run | Packages are not installed | Run `labora doctor`; if npm and the registry are ready, run `labora setup`. |
| `npm` is unavailable | Node/npm is missing or not on `PATH` | Repair Node/npm. Conversation, skills, agents, and dependency-free tools remain available. |
| Registry checks fail | npm cannot reach its configured registry | Follow your environment's registry/auth/network process. Labora does not switch registries or write credentials. |
| PDF was skipped | Chrome was not found | Install Chrome or set `LABORA_CHROME`; request `md,docx` when PDF is not needed. |
| A scanned PDF yields no text | OCR is optional | Install the optional OCR dependency only if you need it. |
| The shell has no `labora` command | The dispatcher is not on `PATH` | Use the absolute `bin/labora` path announced by the session hook. |
| Tools fail on import | Unsupported Node version or missing dependencies | Use Node `>=20.16.0 <21` or `>=22.3.0`, then run `labora doctor`. |

Supported Node versions are declared in `package.json`:

```json
"engines": { "node": ">=20.16.0 <21 || >=22.3.0" }
```

Node 21 is excluded because it is out of support.

## Contributing

Read [AGENTS.md](AGENTS.md), [PHILOSOPHY.md](PHILOSOPHY.md), and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before a substantial change. Keep
personal data out of public artifacts, keep slash commands under `skills/`,
invoke deterministic tools through `labora <group> <tool>`, and update
regression tests with fixes. Security issues go through
[SECURITY.md](SECURITY.md) privately.

## Privacy note

This repository is public. Use only the synthetic `example` persona and
`example.invalid` URLs in public issues, PRs, commits, screenshots, logs, and
examples. Do not publish real names, employers, job titles tied to real people,
contact details, credentials, internal hostnames, real posting text, real
posting URLs, or filesystem paths containing a username, persona slug, or
application slug.

## License

[MIT](LICENSE)
