---
name: build-resume
description: "Runs the full resume assurance pipeline for one job. Launches the resume-build conductor agent, which sequences evidence, profile, job analysis, tailoring, claim validation, rendering, artifact gates and the three independent judges, then writes applications/<job-slug>/release.json. Hash-aware, so it reuses only stages that are genuinely fresh."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> <job-slug> [--style N]"
---

# /build-resume — run the assurance pipeline end to end

Launch the `resume-build` agent (`agents/resume-build.agent.md`).

```text
task(agent_type: "labora:resume-build", prompt: "<persona> <job-slug>, style N if given")
```

It runs the hash-aware pipeline end to end and finishes with
`applications/<job-slug>/release.json`, which reports findings and never
refuses. Sending is recorded separately by `labora approve`, and only from an
explicit operator act.

Do not run any stage in the calling context. The conductor holds the job
description, which is exactly why it must delegate profile curation and every
judge to isolated sub-agents rather than doing that work itself.

For a single stage, use the narrower entry points: `/profile` to build the
verified profile, `/prepare-resume` to analyse a job and tailor against it,
`/resume-format` to re-render, `/judge-resume` to re-run the gates.
