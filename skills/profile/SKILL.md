---
name: profile
description: "Builds or refreshes a persona's verified profile. Launches the profile-builder agent, the only agent permitted to write profile/generated/, which runs with no job and no search preferences in context so the profile cannot be shaded toward one opening. With --research it dispatches profile-researcher to gather public evidence first."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> [--research]"
---

# /profile — build or refresh the verified profile

Launch the `profile-builder` agent for `<workspace>/personas/<persona>/`.

```text
task(agent_type: "labora:profile-builder", prompt: "<persona>, plus --research if requested")
```

It is the only agent permitted to write `profile/generated/`, and it runs with
**no job and no search preferences in context**, so the profile it builds cannot
be shaded toward one opening or one target level.

With `--research` it dispatches `profile-researcher` to gather public evidence
first. Never curate and browse in the same context: a curator that just read a
company's careers page is no longer judging the evidence on its own terms.

Do not run `resume-persona`, `resume-evidence` or any generation step inline
here. Missing evidence is a gap for the builder to report, never a file to
hand-edit.
