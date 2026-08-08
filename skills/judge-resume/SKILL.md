---
name: judge-resume
description: "Re-runs the three independent gates against a rendered delivery artifact. Launches judge-ats, judge-engineer and judge-hr as separate isolated agents, each consuming its own prepare-judge-input bundle, then aggregates their verdicts into applications/<job-slug>/release.json via the resume-quality-gate skill."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> <job-slug> [--style N]"
---

# /judge-resume — run the three independent gates

Launch the three judge agents, **each in its own isolated context**, each
consuming its own `prepare-judge-input` bundle:

| agent | writes |
| --- | --- |
| `judge-ats` | `applications/<job-slug>/judges/ats.json` |
| `judge-engineer` | `applications/<job-slug>/judges/engineer.json` |
| `judge-hr` | `applications/<job-slug>/judges/hr.json` |

```text
task(agent_type: "labora:judge-ats",      prompt: "<persona> <job-slug> [--style N]")
task(agent_type: "labora:judge-engineer", prompt: "<persona> <job-slug> [--style N]")
task(agent_type: "labora:judge-hr",       prompt: "<persona> <job-slug> [--style N]")
```

Then load `resume-quality-gate` to aggregate the three verdicts into
`release.json`.

The isolation is the whole point. A judge that can see the tailoring rationale,
the claim provenance, or another judge's verdict is no longer independent
evidence — it is the pipeline grading its own work. Never read the judge skills
into this context and score inline, and never hand-prime a generic sub-agent to
imitate a judge: that looks identical in the output and removes every boundary
the stage exists to enforce.
