# Labora

Copilot-native resume pipeline for producing evidence-grounded, job-tailored
resumes with deterministic quality gates.

The system improves confidence in factual integrity, requirement coverage,
document parseability, and recruiter readability. It does not claim to emulate
every commercial ATS or guarantee an interview.

Labora exists to help a person get a job, which means a gap is an opportunity
with a next step rather than a verdict, and *we have no evidence of X* is never
*the candidate lacks X*. That flexibility governs what labora looks for and asks
about — never what it prints, where every rendered bullet still maps to a
verified claim. [`PHILOSOPHY.md`](PHILOSOPHY.md) states the rules in full and
outranks the rest of the documentation.

## Architecture

Reasoning lives in Copilot skills. Stable and safety-critical work lives in Node
tools:

```text
evidence -> identity + claims -> job specification -> application strategy -> tailored resume
         -> claim validation -> DOCX/PDF -> artifact validation
         -> ATS / engineer / HR judges -> release gate
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the contracts.

## Quick start

**1. Add the marketplace and install the plugin**, then restart the CLI so the
agents register:

```bash
/plugin marketplace add RubenSaucedo/labora
/plugin install labora@labora
```

Direct repo installs (`/plugin install RubenSaucedo/labora`) still work, but the
CLI now warns that only `plugin@marketplace` installs will be supported.

**2. Enable full deterministic assurance.** The deterministic tools are Node scripts with
real runtime dependencies (`zod`, `docx`, `mammoth`, `pdf-parse`,
`puppeteer-core`). A plugin installer copies the repo but never runs
`npm install`, so install them once:

```bash
labora setup
```

`labora` is the dispatcher at `<plugin>/bin/labora`; the session-start hook
prints its absolute path. `labora doctor` reports install health, including
whether npm can reach its configured registry and whether Chrome was found for
PDF rendering. Without npm, agents, skills and dependency-free tools remain
available in degraded advisory mode. A dependency-backed tool refuses only its
own stage, and Labora never approximates that calculation or validation.
Labora does not download a
browser — set `LABORA_CHROME` if yours is somewhere unusual. OCR for scanned
PDFs is optional; install it with `npm install tesseract.js` inside the plugin.

**3. Create a workspace** — a directory you own that holds `personas/`. Your
career data lives here, never in the plugin:

```bash
mkdir -p ~/src/labora-<you>/personas && cd ~/src/labora-<you>
git init          # optional, but if you do version it, keep the repo PRIVATE
```

**4. Work from that directory.** That is the entire configuration: labora finds
`personas/` because you ran it there. Agents and skills route by intent:

```text
new applicant <persona>
process evidence for <persona>
build the profile for <persona>
find jobs for <persona>
build a resume for <persona> for <job-slug>
judge <persona> <job-slug>
```

Every entry point is also a slash command, in Copilot CLI and Claude Code alike:

| command | does |
| --- | --- |
| `/new-applicant <persona>` | interview and onboard someone with no persona yet |
| `/profile <persona> [--research]` | build or refresh the verified profile |
| `/resume-evidence <persona>` | extract and clean newly dropped evidence PDFs |
| `/job-search <persona>` | discover and rank real openings |
| `/prepare-resume <persona> <job-slug>` | analyse a job and tailor against it |
| `/resume-format <persona> <job-slug> [--style N]` | render the delivery artifacts |
| `/judge-resume <persona> <job-slug> [--style N]` | run the three independent gates |
| `/build-resume <persona> <job-slug> [--style N]` | all of it, through the release decision |
| `/career-issue <persona>` | turn a named gap route into an issue on a repo the persona owns |

Those nine are the whole public surface. The remaining skills are internal
pipeline stages, marked `user-invocable: false` because each one runs inside an
isolated agent or writes `profile/generated/`, and invoking it directly would
walk around the boundary it exists to enforce.

The `resume-build` agent checks content hashes, rebuilds stale stages, and writes
`release.json` with one of:

- `send_ready`
- `human_review`
- `blocked`

Human approval remains mandatory.

## Data layout

Persona data is **personal** — career history, performance reviews,
compensation, generated resumes. It lives in a private workspace **outside this
repository**, so labora itself never stores user data and can be installed as a
plugin without carrying anyone's history.

```text
<workspace>/personas/<name>/
├── profile/
│   ├── contact.md                  # you edit
│   ├── background.md               # you edit
│   ├── career.md                   # you edit (optional)
│   ├── search-preferences.json     # you edit
│   └── generated/                  # resume-persona writes; everyone else reads
│       ├── identity.json
│       ├── claims.json
│       └── accomplishments.json
├── evidence/
│   ├── performance-reviews/{raw,extracted,text,validations}
│   ├── repositories/<date>/{repositories.md,repositories.json}
│   └── references/
├── career-issues/                  # career-issue drafts; you file them yourself
│   └── <date>-<kind>-<slug>.{md,json}
└── applications/<job-slug>/
    ├── job.md
    ├── job-spec.json
    ├── application-strategy.json
    ├── resume.json
    ├── ats-results.json
    ├── final-resume-style-<N>.docx
    ├── final-resume-style-<N>.pdf
    ├── validations/{strategy,claims,artifact}.json
    ├── previews/{manifest.json,page-<N>.png}
    ├── judges/{ats,engineer,hr}.json
    ├── release.json
    ├── outcome.json
    ├── run.json
    └── summary.md
```

### Persona workspaces

labora is a **plugin**: it holds code and the synthetic `example` fixture, and
no user data. Your data lives in a workspace you own — any directory containing
`personas/`.

```text
src/
├── labora/          # the plugin — code only, installable, no user data
└── labora-ruben/    # your workspace
    └── personas/ruben/
```

**Run labora from your workspace.** That is the whole configuration:

```bash
cd ~/src/labora-ruben
# every tool and agent now resolves personas/ from here
```

Resolution order, first match wins:

1. `$LABORA_WORKSPACE` — explicit override
2. the `workspace` field of the nearest `labora.json` (resolved relative to that
   file) — useful only when you must run from *outside* your workspace
3. **`<cwd>`, when it contains `personas/`** — the normal path
4. `<cwd>/data` — legacy in-repo layout
5. the plugin's bundled `data/` — keeps the committed `example` persona
   reachable wherever the plugin is installed

Options 1 and 2 exist for unusual setups. If you `cd` into your workspace you
need neither, and the plugin repo never learns your workspace exists.

Git is a recommendation, not a requirement — mandating a repo adds an
accidental-public-remote failure mode worse than the problem it solves. If you
do version it, use a **private** repo; the convention is `labora-<owner>`.

Only `data/personas/example/` is committed; it is synthetic. Contact information
remains blank in model-written JSON and is injected from `profile/contact.md`
during deterministic rendering.

Migrating an existing in-repo persona:

```bash
mkdir -p ../labora-<name>/personas
mv data/personas/<name> ../labora-<name>/personas/<name>
cd ../labora-<name>
node <path-to-labora>/src/tools/migrate-claim-sources.js <name>          # dry run
node <path-to-labora>/src/tools/migrate-claim-sources.js <name> --write
node <path-to-labora>/src/tools/validate-profile.js <name>               # expect: profile VALID
```

Claim provenance is stored **persona-relative** so it travels with the persona.
`migrate-claim-sources.js` repoints legacy repo-relative paths and refuses to
write unless every source hashes identically to the value recorded at
verification time — so a migration can never silently change what a verified
claim asserts.

Two tests assert against a real persona and skip when none is present. To run
them, point at a workspace: `LABORA_WORKSPACE=../labora-<name> npm test`.

The profile is split by **ownership**, then by lifetime:

| File | Owner | Edited | Grounds claims | Holds |
|---|---|---|---|---|
| `contact.md` | you | freely | **no** | private contact card |
| `background.md` | you | rarely | yes | durable facts: positions, education, projects, certifications, awards |
| `career.md` | you | optional; on review cycles | yes | period narrative — skip it when cleaned per-review evidence already covers the same periods |
| `search-preferences.json` | you | freely | n/a | trusted job-search config |
| `generated/identity.json` | `resume-persona` | never by hand | n/a | structural spine |
| `generated/claims.json` | `resume-persona` | never by hand | n/a | verified claim ledger |
| `generated/accomplishments.json` | `resume-persona` | never by hand | n/a | retrieval index over the ledger |

You edit the sources; `resume-persona` regenerates `generated/`. The boundary is
ownership, not file type — `search-preferences.json` is JSON but human-authored,
so it stays with the sources. To change anything under `generated/`, change a
source and re-run `resume-persona`; never hand-edit the artifacts, because claims
are anchored to their sources by content hash and a hand-written claim has no
verifiable anchor. See `profile/generated/README.md`.

`contact.md` is deliberately excluded from the grounding corpus. Claims are
anchored to their source file by content hash, so if contact details shared a
file with grounded evidence, changing a phone number would invalidate the
ledger. Neither `background.md` nor `career.md` may contain a profile summary,
resume bullets for a well-evidenced period, or a skill list: that is pre-baked
resume prose, and it anchors the tailor instead of informing it.

## Agents

Each agent has one **trust posture**, and the posture decides what it may *see*.
Contamination, not capability, is what breaks an assurance pipeline: a curator
who knows the target job shades facts toward it, an advocate holding raw evidence
composes from sources no claim covers, and a judge that has seen the rationale
grades what you meant instead of what the page says.

| Posture | Agent | Sees | Writes |
|---|---|---|---|
| Intake | `applicant-intake` | the operator's answers | human-authored `profile/` sources |
| Acquire | `profile-researcher` | untrusted web, GitHub, credential issuers | `evidence/` only |
| Acquire | `scout-discovery`, `scout-fit`, `scout-market`, `scout-growth` | job sources, claims, preferences | discovery run dir |
| Curate | `profile-builder` | evidence + sources, **no job** | `profile/generated/` (sole owner) |
| Advocate | `resume-tailor` | claims, bank, job spec — **never raw evidence** | `resume.json` |
| Adjudicate | `judge-ats`, `judge-engineer`, `judge-hr` | rendered artifact + job only | `judges/*.json` |
| Conduct | `resume-build`, `job-explorer` | orchestration state | summaries, reconciliation |

| Agent | Role |
|---|---|
| `applicant-intake` | Onboarding conductor: interviews a brand-new applicant for contact, career history, evidence sources and preferences, then dispatches the researcher and curator |
| `resume-build` | Conductor: sequences skills + deterministic tools, launches the tailor and judges, applies the release gate |
| `profile-builder` | Profile conductor and sole owner of `profile/generated/`; dispatches the researcher |
| `profile-researcher` | Isolated evidence acquisition — the only agent that touches untrusted pages, and it cannot write claims |
| `resume-tailor` | Isolated advocate — composes only from verified claims |
| `judge-ats` | Isolated ATS-gate judge (fresh context) |
| `judge-engineer` | Isolated technical hiring-manager judge (fresh context) |
| `judge-hr` | Isolated recruiter / HR screening judge (fresh context) |
| `job-explorer` | Job-discovery conductor: collects postings, launches three independent scoring scouts, and reconciles them |
| `scout-discovery` | Read-only collector — verifies and deduplicates current postings without scoring |
| `scout-fit` | Isolated scout — skills/domain/seniority match vs. verified claims |
| `scout-market` | Isolated scout — compensation, location/remote, company health |
| `scout-growth` | Isolated scout — roles that stretch the persona toward stated goals |

The profile agents are split so the stage handling untrusted web content has no
write access to the claim ledger: a hostile page can at worst dirty a file under
`evidence/`, never author a claim.

`test/agent-architecture.test.js` enforces these boundaries, so a posture cannot
be widened by accident — granting the tailor a browser tool fails the suite.

The three judges run as separate sub-agents with their own context so their
verdicts stay independent of the tailoring reasoning. Each sees only the job and
the selected delivery artifact — never provenance, generator rationale, or the
other judges. The conductor launches them in parallel.

The `job-explorer` first creates one shared deduplicated posting set. Three scout
sub-agents then score every posting independently from fit, market, and growth
angles. A deterministic reconciler requires a credible fit score plus consensus.
Canonical job IDs, posting hashes, and the configured IANA timezone bind every
lead to one fresh dated run. It proposes leads — it never applies.
See `ARCHITECTURE.md` for the discovery layout and consensus rule.

## Skills

| Skill | Responsibility |
|---|---|
| `new-applicant` | Scaffold a persona workspace and ask for search preferences |
| `job-search` | Job-discovery contract; dispatches the `job-explorer` agent |
| `resume-evidence` | OCR and faithfully clean private source documents |
| `resume-persona` | Build the identity spine, a source-addressed claim ledger, and the accomplishment bank |
| `resume-job-analysis` | Classify required, preferred and responsibility constraints |
| `resume-application-strategy` | Build the private positioning brief and targeted evidence questions |
| `resume-tailor` | Tailor only from verified claims and map provenance |
| `resume-format` | Inject contact, render DOCX/PDF, validate artifact recall |
| `judge-ats` | ATS rubric/procedure — executed by the `judge-ats` agent |
| `judge-engineer` | Engineering-depth rubric — executed by the `judge-engineer` agent |
| `judge-hr` | Recruiter-screen rubric — executed by the `judge-hr` agent |
| `resume-quality-gate` | Aggregate deterministic and model evaluations |
| `application-outcomes` | Record operator-confirmed funnel events without causal claims |
| `career-issue` | Draft an issue on a repo the persona owns from a named gap route |

All skills load `skills/resume-conventions/SKILL.md`. Judge skills hold the
rubric; the matching agents provide the isolated context that runs them.

## Deterministic tools

```bash
labora analyze-job <job.md> [job-spec.json]
labora validate-evidence-cleaning <extracted.md> <cleaned.md> --metadata <extracted.json>
labora validate-application-strategy <strategy.json> <job-spec.json> <claims.json> [--accomplishments <accomplishments.json>]
labora rank-accomplishments <accomplishments.json> <job-spec.json> [--limit <n>]
labora score-ats <resume.json> <job.md> --job-spec <job-spec.json>
labora validate-claims <resume.json> <identity.json> <claims.json> [--accomplishments <accomplishments.json>] [--job-spec <job-spec.json>]
labora format-docx <resume.json> <out.docx> --job <job.md> --contact <contact.md>
labora format-pdf <resume.json> <out.pdf> --job <job.md> --contact <contact.md>
labora render-artifact-preview <out.pdf> <application-dir>/previews
labora validate-artifact <resume.json> <out.docx|out.pdf> --contact <contact.md> --job <job.md> [--cross-parser]
labora prepare-judge-input <ats|engineer|hr> <application-dir> <artifact>
labora run-state check <application-dir> --style 1
labora quality-gate <application-dir> --artifact <selected.docx|selected.pdf>
labora check-judge-models [--json] [--settings <path>]
labora merge-candidates <run-dir> --prefs <search-preferences.json> --claims <claims.json> [--fit-floor 60] [--seen <seen.json>] [--suppress-seen]
labora calibrate-judges [--persona <name>] [--out <calibration.json>]
labora application-outcome <application-dir> show|record <event>
labora career-issue draft <persona> --kind <polish|legibility|gap|growth> --repo <owner/repo> --title <text> --problem <text> --route <text> --done-when <text>
labora career-issue check <persona> <body-file>
```

`coverage_percent` is lexical coverage only.
Requirements carry both employer priority and release severity. Missing
`hard_eligibility` blocks; missing `core` requirements routes to human review;
`preferred` and `soft_signal` gaps remain advisory. None of the scores is a
hiring probability.

`analyze-job` flags non-requirement prose — EEO paragraphs, pay ranges,
benefits blocks — in `nonRequirements` with a reason. The flag is advisory and
never removes the line from scoring, because a wrongly withheld requirement is
invisible while a retained one is merely noisy. Each entry carries its reason so
the filter can be audited rather than trusted. Work-authorization detection is
negation-aware in both directions: an equal-opportunity paragraph ("without
regard to … citizenship status") is never an eligibility gate, and a refusal to
sponsor ("no visa sponsorship is available") always is.

`--cross-parser` extracts the rendered artifact a second time with an independent
parser (OCR render for PDF, mammoth HTML for DOCX) and reports fields the two
parsers disagree on — a real-world ATS fragility signal. Divergences are advisory
warnings, never a hard failure.

Judges consume one deterministic input bundle containing only the parsed job,
selected artifact text, permitted diagnostics, and content hashes. Prompt and
input hashes make calibration comparable across prompt/model changes. The HR
judge also views rendered page previews; career gaps, current employment status,
school prestige, and protected-trait proxies are not screening criteria. Preview
manifests bind the page hashes to the selected PDF hash; stale or mismatched
images are withheld from the judge.

### Judge model diversity

Three judges sharing one model share that model's blind spots, so unanimity
means less than it appears. Which model backs a sub-agent is an operator
setting rather than something a plugin can select — it lives in the CLI's
`subagents.agents.<name>.model` configuration (`/subagents`, or `settings.json`):

```json
{ "subagents": { "agents": { "judge-engineer": { "model": "<other-model>" } } } }
```

`labora check-judge-models` reports the configured model for `resume-tailor`
and each judge and exits `0` when at least one judge differs, `1` when they all
share the tailor's model, and `2` when the configuration cannot be read — an
unanswerable check is never reported as a passing or a failing one. The result
is recorded in `release.json` as `judgeModels`. It is evidence, not a gate: it
does not change the release state, because model choice is a property of your
runtime rather than a defect in an application.

Judges never report their own model. Asked directly, a model answers with a
plausible name that may be wrong — one runtime model reported itself as "Claude
3.5 Sonnet" while running as `claude-haiku-4.5`. `metadata.model` is therefore
supplied from the resolved configuration and compared by the quality gate like
the hashes beside it, except when either side is `unknown`: an unreadable
config file must not invalidate three otherwise correct verdicts.

Three honest limits. The check reads the user settings file, so configuration
in other scopes can only make your real setup *more* diverse than reported.
Under Claude Code, or any host without a `~/.copilot` directory, the check
reports `unsupported` rather than guessing. And configured is not observed — it
never proves which model produced a verdict.

`merge-candidates --seen` persists a per-persona ledger so overnight runs mark
only genuinely new leads (`isNew`, `newLeadCount`) and stop re-surfacing postings
the operator already applied to or ignored. `report-candidates` then leads the
`report.md` with new postings (new-vs-resurfaced summary, a `New` column, and
new-first ordering). `calibrate-judges` aggregates historical judge verdicts into
score/verdict distributions, per-model bias, month drift, and cross-judge
agreement.
Discovery retains normalized posting text and verifies its SHA-256 hash within
the dated run. Fit scores at the promotion floor must cite both verified claim
IDs and exact configured preferences.

## Evidence and privacy

Place source PDFs under `evidence/performance-reviews/raw/`. The evidence skill
persists the mechanical extraction and source hash before writing cleaned text.
A deterministic validator rejects numbers or dates introduced during cleaning.
Failed, missing, or stale evidence-cleaning validations invalidate the persona
stage and prevent release.
Documents and job descriptions are treated as untrusted data, never instructions.

Repository evidence is retrieved, not written by hand:
`labora snapshot-repos --persona <name>` records repository facts
(visibility, languages, commit counts, dates, README excerpt) under
`evidence/repositories/<date>/`. Only the generated `repositories.md` grounds
claims, so any reviewer can re-run the tool and diff the result. Visibility is
recorded per repository because a public repository is verifiable by a reader
while a private one is self-reported.

Prefer selective evidence and minimal disclosure. Gitignore does not protect
data already sent to a cloud model or written to logs.

`labora career-issue` is the one tool whose output is meant to leave the
workspace, so it is the one that refuses. It drafts an issue for a repository
the persona owns, derives the terms that must not be published from the
workspace itself — employers in `identity.json`, target companies and slugs
under `applications/` — and withholds the `gh issue create` command when the
draft matches one. The draft is still written, because the workspace is private
and may hold the real wording; only publication is gated. It never runs `gh`:
twenty issues appearing on someone's repository in one minute is a worse
outcome than the gap was. A filed issue is a promise, not evidence, and no
later stage reads open issues as claims.

## Tests

```bash
npm test
```

The regression suite covers two distinct classes of guarantee.

**Pipeline correctness** — requirement extraction and eligibility-gate
attribution, metadata contamination, unsupported metrics, duplicate claims,
contact injection, DOCX round trips, artifact freshness, cross-parser
divergence, job-search consensus and cross-run dedup, fit-floor enforcement,
application strategy references, isolated judge bundles, application outcomes,
judge calibration, and release decisions.

**Packaging invariants** — the things that break only after a real install, and
so cannot be caught by running the pipeline locally:

| Test | Guards |
|---|---|
| `test/plugin-root.test.js` | plugin files resolve against `pluginRoot`, never `process.cwd()`, so a workspace containing `agents/` cannot supply the prompt a judge is certified against |
| `test/plugin-packaging.test.js` | the dispatcher, hook and manifests ship and stay consistent |
| `test/heavy-deps.test.js` | optional and heavy dependencies stay lazily loaded, so a missing browser or OCR engine degrades instead of breaking every tool |

The prose in `agents/` and `skills/` is asserted on directly, so rewording a
rule is expected to break the build.

## Troubleshooting

Run `labora doctor` first. It reports every failure below in one pass:

```text
plugin root   /path/to/labora
working dir   /path/to/your-workspace
node          v22.19.0
npm           10.9.3
registry      https://registry.npmjs.org/ (reachable)
tools         29 available
dependencies  ready
pdf renderer  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
mode          full deterministic capabilities installed
```

| Symptom | Cause | Remedy |
|---|---|---|
| A dependency-backed tool refuses to run | Its required packages are not installed | Run `labora doctor`; use `labora setup` only when npm and the registry are ready |
| `npm` reports unavailable | The Node installation does not include npm or npm is not on `PATH` | Repair the Node/npm installation; agents, skills and dependency-free tools still work |
| `registry` reports authentication, access, network or TLS failure | npm cannot reach its configured registry | Follow the environment's approved registry/auth/network process; Labora never switches registries or writes credentials |
| `dependencies` reports missing after `setup` | Node is older than the supported range | Node `>=20.16 <21` or `>=22.3` — see below |
| `pdf renderer` reports none found | Labora never downloads a browser | Install Chrome, or set `LABORA_CHROME` to its binary |
| A scanned PDF yields no text | OCR is an optional dependency | `npm install tesseract.js` inside the plugin directory |
| Skills tell you to run `labora <tool>`, but your shell has no such command | `bin/labora` is deliberately not added to `PATH` | See *How the agent finds the tools* below |
| A tool reports a stage is stale | File existence is not freshness | `labora run-state` reports what must re-run |

### Supported Node versions

```json
"engines": { "node": ">=20.16.0 <21 || >=22.3.0" }
```

The floor is set by `pdf-parse`, not by labora itself. Node 21 is excluded
because it is out of support. On an unsupported runtime the tools fail at
import, which looks like a missing-dependency error but is not — check
`labora doctor` before reinstalling anything.

### How the agent finds the tools

`bin/labora` lives inside the plugin, and a plugin install lands at an
unpredictable path that differs per machine and per install method. Putting it
on `PATH` would make the plugin mutate the user's shell environment, so labora
does not.

Instead, the `sessionStart` hook in `hooks.json` runs `labora announce`, which
returns the absolute path as session context:

```json
{ "additionalContext": "labora plugin <version> is installed at /path/to/labora.\n\nSkills and agents invoke deterministic tools as \"labora <tool> [args]\".\nThat command is not on PATH. Run it as:\n  /path/to/labora/bin/labora <tool> [args]" }
```

That is the only reason the agent knows where the tools are. **If you disable
hooks, every skill instruction that says `labora <tool>` will fail** — the agent
has no way to resolve it. Either re-enable the hook, or tell the agent the
absolute path to `bin/labora` once at the start of a session.

This also explains a rule that otherwise looks arbitrary: skills invoke
`labora <tool>`, never `node src/tools/<tool>.js`. A relative path resolves
against the workspace you are working in, not the plugin, so it resolves to
nothing.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first, and
[`ARCHITECTURE.md`](ARCHITECTURE.md) before a substantial change.

Most rules exist to protect a guarantee rather than a preference. The load
bearing ones: never commit real persona data, never make it possible to render
a fact the ledger cannot support, never widen an agent boundary, and never lower
a discovery gate to manufacture leads. The prose in `agents/` and `skills/` is
asserted on by the test suite, so rewording a rule is expected to break the
build.

Security issues go through [`SECURITY.md`](SECURITY.md) privately, never a
public issue. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
