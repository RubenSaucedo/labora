# /judge-resume <persona> <job-slug> [--style N]

Launch the three judge agents, each in its own isolated context, each consuming
its own `prepare-judge-input` bundle:

- `judge-ats`      -> `applications/<job-slug>/judges/ats.json`
- `judge-engineer` -> `applications/<job-slug>/judges/engineer.json`
- `judge-hr`       -> `applications/<job-slug>/judges/hr.json`

Then load `skills/resume-quality-gate/SKILL.md` to aggregate into `release.json`.
