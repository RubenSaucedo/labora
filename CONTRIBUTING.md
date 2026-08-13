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

### 2. Never invent evidence

Every resume bullet and every displayed skill maps to a verified claim ID
anchored in a real source. No change may make it possible to render a fact the
ledger cannot support — not a rounded metric, not an inferred seniority, not a
"reasonable" restatement of something the operator said loosely.

An operator's spoken answer is *evidence*, routed through `profile-builder` for
curation. It is never written straight onto a resume.

### 3. Agent isolation is the architecture

The judges, scouts, curator and tailor run as separate sub-agents so their
verdicts are independent and auditable. Running a stage inline, merging two
agents, or hand-priming a generic sub-agent to imitate one silently removes
every boundary that stage exists to enforce.

Concretely:

- Only acquisition agents (`profile-researcher`, the scouts, `job-explorer`)
  may hold browser tools. Untrusted job pages must never share a context with
  claim-write access.
- `resume-writer-expert` is denied raw evidence, so it cannot derive new facts.
- `profile-builder` runs with no job in context, so it cannot tilt facts toward
  one opening, and may not read `search-preferences.json`.
- The judges see only the rendered artifact and the job — never the tailoring
  rationale, the provenance, or each other.

`test/agent-architecture.test.js` enforces these. If your change makes one of
those tests fail, the test is usually right.

### 4. Prose contracts are code

The files in `agents/` and `skills/` are the contracts the agents follow, and
the test suite asserts on their sentences. Rewording a normative rule **should**
break the build — that is the mechanism working, not a flaky test.

If you intend to change a rule, change it deliberately and update the assertion
in the same commit, with the reasoning in the commit message.

### 5. Mutation-verify new tests

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

### 6. Never lower a gate to manufacture output

`fitFloor`, `consensusThreshold` and `minAgreement` decide what is ready to act
on. A run that surfaces nothing is a finding about the search, not a bug to
tune away. If a gate is genuinely miscalibrated, argue it on the evidence and
change it in its own commit.

For the same reason, never present evidence coverage as a probability of being
hired. That depends on the other applicants, which no run can observe.

### 7. Never automate an application, never handle credentials

Browsing is human-login-only: the operator logs in themselves and the agent
continues in that session. No part of Labora may ask for, store, or accept a
password, and nothing may submit an application on someone's behalf.

### 8. Never hand-edit generated artifacts

`profile/generated/` is written by `profile-builder` alone, through its owning
tools. A hand-edited claim cannot be re-verified, which defeats the ledger. If a
source moved, rebuild; if no tool exists to produce what you need, add one.

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
