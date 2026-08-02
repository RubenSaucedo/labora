# /profile <persona> [--research]

Launch the `profile-builder` agent (`agents/profile-builder.agent.md`) for
`data/personas/<persona>/`.

It is the only agent permitted to write `profile/generated/`, and it runs with
**no job and no search preferences in context**, so the profile it builds cannot
be shaded toward one opening or one target level.

With `--research`, it dispatches `profile-researcher` to gather public evidence
first. Never curate and browse in the same context.
