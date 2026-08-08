---
name: resume-format
description: "Deterministically injects private contact data, renders ATS-safe DOCX and optional PDF, and verifies field recall and section order. Never rewrites resume content."
tools: [bash, view, glob, grep]
user-invocable: true
argument-hint: "<persona> <job-slug> [--style N]"
---

# resume-format

Load `resume-conventions`. Formatting never edits content.

Render DOCX:

```bash
labora format-docx \
  <application>/resume.json \
  <application>/final-resume-style-<N>.docx \
  --style <N> \
  --job <application>/job.md \
  --contact <persona>/profile/contact.md
```

Generate a PDF companion for visual review even when DOCX is the selected
delivery artifact. Select one delivery artifact for this run; do not assume PDF
or DOCX universally parses better.

PDF rendering drives an installed Chrome; labora does not ship a browser. If
`labora doctor` reports no PDF renderer, the DOCX path is unaffected — deliver
the DOCX, and record the missing preview as a gap. Do not substitute a
hand-described "preview" for one that was never rendered.

Render page previews:

```bash
labora render-artifact-preview \
  <application>/final-resume-style-<N>.pdf \
  <application>/previews
```

Then run `validate-artifact` against the **selected delivery artifact** with both
`--contact <contact.md>` and `--job <job.md>`, and save
`validations/artifact.json`. It must report:

- 100% required field recall;
- contact name/email/phone present;
- valid section order;
- no lost experience bullets.
- the selected artifact hash and, for PDF, page count.

Record `format` and `validate_artifact` with `run-state`. If validation fails,
fix the formatter or source mapping; never hide the failure in a judge.
