---
name: new-applicant
description: "Entry point for someone with no persona yet. Launches the applicant-intake agent, which interviews the operator for contact details, career history, evidence sources and search preferences, then dispatches profile-researcher and profile-builder. Invoke for a new applicant, a new persona, or to start a resume for someone new."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona>"
---

# /new-applicant — onboard a brand-new applicant

Launch the `applicant-intake` agent and hand it the persona name.

```text
task(agent_type: "labora:applicant-intake", prompt: "<persona>")
```

Do not scaffold, interview, or write profile sources in the calling context.

Scaffolding is only the last step of intake, and it is the cheap one. The
expensive part is the interview: `profile/` sources ground every later claim, so
an answer that was never spoken aloud is an answer nobody can be held to. A
persona scaffolded without it validates cleanly and is empty of evidence — the
one failure this pipeline is built to make impossible.

If you only need to re-run the mechanical scaffold for a persona whose intake
already happened, that procedure is the internal `scaffold-persona` skill, which
`applicant-intake` follows on your behalf.
