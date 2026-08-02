# Labora

Copilot-native resume pipeline for producing evidence-grounded, job-tailored
resumes with deterministic quality gates.

The system improves confidence in factual integrity, requirement coverage,
document parseability, and recruiter readability. It does not claim to emulate
every commercial ATS or guarantee an interview.

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

Install the plugin, then restart the CLI so the agents register:

```bash
/plugin install RubenSaucedo/labora
```

Work conversationally — the agents and skills route by intent:

```text
new applicant <persona>
process evidence for <persona>
build the profile for <persona>
find jobs for <persona>
build a resume for <persona> for <job-slug>
judge <persona> <job-slug>
```

Claude Code users get the same entry points as `/new-applicant`, `/init-resume`,
`/profile`, `/find-jobs`, `/build-resume`, `/resume-tailor`, `/resume-format` and
`/judge-resume` from `.claude/commands/`.

The `resume-build` agent checks content hashes, rebuilds stale stages, and writes
`release.json` with one of:

- `send_ready`
- `human_review`
- `blocked`

Human approval remains mandatory.

## Data layout

```text
data/personas/<name>/
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

Real persona data is gitignored. Only `data/personas/example/` is committed.
Contact information remains blank in model-written JSON and is injected from
`profile/contact.md` during deterministic rendering.

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

All skills load `skills/resume-conventions/SKILL.md`. Judge skills hold the
rubric; the matching agents provide the isolated context that runs them.

## Deterministic tools

```bash
node src/tools/analyze-job.js <job.md> [job-spec.json]
node src/tools/validate-evidence-cleaning.js <extracted.md> <cleaned.md> --metadata <extracted.json>
node src/tools/validate-application-strategy.js <strategy.json> <job-spec.json> <claims.json> [--accomplishments <accomplishments.json>]
node src/tools/rank-accomplishments.js <accomplishments.json> <job-spec.json> [--limit <n>]
node src/tools/score-ats.js <resume.json> <job.md> --job-spec <job-spec.json>
node src/tools/validate-claims.js <resume.json> <identity.json> <claims.json> [--accomplishments <accomplishments.json>]
node src/tools/format-docx.js <resume.json> <out.docx> --job <job.md> --contact <contact.md>
node src/tools/format-pdf.js <resume.json> <out.pdf> --job <job.md> --contact <contact.md>
node src/tools/render-artifact-preview.js <out.pdf> <application-dir>/previews
node src/tools/validate-artifact.js <resume.json> <out.docx|out.pdf> --contact <contact.md> --job <job.md> [--cross-parser]
node src/tools/prepare-judge-input.js <ats|engineer|hr> <application-dir> <artifact>
node src/tools/run-state.js check <application-dir> --style 1
node src/tools/quality-gate.js <application-dir> --artifact <selected.docx|selected.pdf>
node src/tools/merge-candidates.js <run-dir> --prefs <search-preferences.json> --claims <claims.json> [--fit-floor 60] [--seen <seen.json>] [--suppress-seen]
node src/tools/calibrate-judges.js [--persona <name>] [--out <calibration.json>]
node src/tools/application-outcome.js <application-dir> show|record <event>
```

`coverage_percent` is lexical coverage only.
Requirements carry both employer priority and release severity. Missing
`hard_eligibility` blocks; missing `core` requirements routes to human review;
`preferred` and `soft_signal` gaps remain advisory. None of the scores is a
hiring probability.

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
`node src/tools/snapshot-repos.js --persona <name>` records repository facts
(visibility, languages, commit counts, dates, README excerpt) under
`evidence/repositories/<date>/`. Only the generated `repositories.md` grounds
claims, so any reviewer can re-run the tool and diff the result. Visibility is
recorded per repository because a public repository is verifiable by a reader
while a private one is self-reported.

Prefer selective evidence and minimal disclosure. Gitignore does not protect
data already sent to a cloud model or written to logs.

## Tests

```bash
npm test
```

The regression suite covers requirement extraction, metadata contamination,
unsupported metrics, duplicate claims, contact injection, DOCX round trips,
artifact freshness, cross-parser divergence, job-search consensus and cross-run
dedup, fit-floor enforcement, application strategy references, isolated judge
bundles, application outcomes, judge calibration, and release decisions.

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
