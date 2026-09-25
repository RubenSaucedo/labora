# Contributing to Labora

Thanks for your interest. Labora's job is to make sure nothing reaches a
recruiter that it cannot source, so most of the rules below exist to protect
that guarantee rather than to enforce taste.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before a substantial change. It
explains *why* the pipeline is shaped the way it is, which is usually the
missing context behind a rejected PR.

## Getting set up

```bash
git clone https://github.com/RubenSaucedo/labora.git
cd labora
npm install
npm test        # 242 tests, Node 22+, no framework to install
```

There is no build step and no linter. `npm test` is the gate.

## The rules

### 1. Never commit persona data

Persona data lives in a **private workspace outside this repo**
(`$LABORA_WORKSPACE` or the `workspace` field of a gitignored `labora.json` —
see `labora.example.json`). Only the synthetic `example` persona is committed.
Real career history, performance reviews, contact details and generated resumes
stay on the machine that produced them.

That separation is structural, not a convention to remember: the likeliest way
this repo leaks personal data is a contributor testing with their own resume and
running `git add -A`, and a gitignore negation pattern is one `-f` away from
failing. Keep your persona in a workspace and there is nothing to stage. If you
still use the legacy in-repo `data/personas/` layout, check `git status` before
pushing and confirm nothing under `data/personas/<your-name>/` is staged.

The same applies to **test fixtures and documentation**. Use synthetic names.
A real employer in a fixture discloses where someone actually works or is
applying, even though it looks like harmless sample data.

### 2. Never invent anything

Labora writes what the person tells it. When a detail is missing it asks one
concrete question; it does not guess, insert a placeholder, or quietly widen
scope, ownership, seniority or a number. When it suggests wording the person has
not confirmed, it says so.

There used to be a claim ledger enforcing this with a validator, and it is gone.
It produced constant false negatives against people's own careers — see
`PHILOSOPHY.md` for the issue history. Honesty is now a conversational contract,
which means it lives in the prose contracts under `skills/` and `agents/`. Treat
a change that weakens one of those sentences as seriously as a change that
weakens a check.

### 3. Never add a way to say no

This is the rule the whole product turns on. Before adding any check, ask:

> Could this ever tell someone they did not do something they did?

If yes, it does not belong in code. A tool that is occasionally too generous
costs an awkward interview. A tool that is systematically too strict costs the
job, and it fails silently, which is why it accumulates.

Labora has no verdict, no score, no hiring probability, no release gate and no
"not a fit". Deterministic code may report facts about a *file* — it did not
render, it will not open, a section is missing — never facts about a person.

### 4. Agent isolation is still the architecture

Agents run as separate sub-agents so their work is independent. Running a stage
inline, merging two agents, or hand-priming a generic sub-agent to imitate one
silently removes the boundary that stage exists to provide.

Concretely:

- Only acquisition agents (`source-gatherer`, the scouts, `job-explorer`) may
  hold browser tools. Untrusted job pages must never share a context with write
  access to someone's profile.
- `resume-reviewer` sees only the rendered document, the posting and an audience
  label. This is not a gate — it is the only way the reading is worth anything,
  because a reader who knows what the writer meant will understand sentences a
  stranger will not.

`test/agent-architecture.test.js` enforces these. If your change makes one of
those tests fail, the test is usually right.

### 5. Prose contracts are code

The files in `agents/` and `skills/` are the contracts the agents follow, and the
test suite asserts on their sentences. Rewording a normative rule **should**
break the build — that is the mechanism working, not a flaky test.

If you intend to change a rule, change it deliberately and update the assertion
in the same commit, with the reasoning in the commit message.

### 6. Mutation-verify new tests

A test that passes when the rule is deleted is not a test. After adding one,
break the rule in the source or contract file and confirm your test fails:

```bash
# edit the rule out, then:
npm test
# restore it, then confirm green again
```

Assert the **normative sentence**, not a keyword that happens to appear nearby.
A regex loose enough to match an incidental token will pass even after someone
removes the guarantee it was written to protect.

### 7. Never lower a search gate to manufacture output

`fitFloor`, `consensusThreshold` and `minAgreement` decide which job leads are
worth acting on. A run that surfaces nothing is a finding about the search, not a
bug to tune away. If a threshold is genuinely miscalibrated, argue it on the
evidence and change it in its own commit.

Never present anything as a probability of being hired. That depends on the
other applicants, which no run can observe.

### 8. Never automate an application, never handle credentials

Browsing is human-login-only: the operator logs in themselves and the agent
continues in that session. No part of Labora may ask for, store or accept a
password, and nothing may submit an application on someone's behalf.

### 9. Dependencies need justification

Labora has six runtime dependencies and no dev dependencies. This code reads
personal documents, so every added package widens a supply chain that has access
to them. Prefer the standard library. If a dependency is genuinely necessary,
say what it does and why it cannot be avoided.

## Pull requests

- Keep the change focused; unrelated fixes belong in their own PR.
- `npm test` must pass.
- Explain **why** in the commit message, not just what. The diff already shows
  what changed; the reasoning is what a future reader needs.
- New behaviour needs a test. Changed rules need their assertion updated.
- Say plainly what you did not verify. An honest gap is more useful than a
  confident claim that does not hold.

## Reporting problems

Bugs and ideas go in [Issues](https://github.com/RubenSaucedo/labora/issues).
**Never paste a real resume, job offer, performance review or contact details
into an issue** — reduce it to a synthetic example that reproduces the problem.

Security vulnerabilities go through [`SECURITY.md`](SECURITY.md) instead, not a
public issue.
