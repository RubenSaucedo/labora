---
name: render-resume
description: Use when turning a Labora resume.json into Markdown, DOCX, or PDF artifacts and checking what actually rendered.
tools: [bash, view, glob, grep, edit, create]
user-invocable: true
argument-hint: "<name> <job-slug> [--formats md,docx,pdf]"
---

# Render resume

Rendering is mechanical. It should answer: did the chosen files get produced, can they be read, and does the parsed artifact contain the expected sections and links?

## Inputs

- `personas/<name>/applications/<job-slug>/resume.json`
- `personas/<name>/profile/contact.md`
- optional `personas/<name>/applications/<job-slug>/job.md`

Default formats are `md,docx`. PDF is opt-in because it depends on Chrome. A missing browser costs the PDF only; it is not a failed resume.

## Steps

1. Confirm the requested formats. If absent, use `md,docx`.
2. Run:

```bash
labora render resume <resume.json> --out <application-dir> --formats <formats> --contact <contact.md> --job <job.md>
```

3. For each produced artifact, run:

```bash
labora verify artifact <resume.json> <artifact> --contact <contact.md> --job <job.md>
labora inspect artifact <artifact>
```

4. Read the inspection output. Report what actually rendered, including missing sections, broken links, parser-visible text problems, or a PDF skipped because Chrome is unavailable.
5. If a PDF was produced and the person wants a visual check, run `labora render preview <file.pdf> <out-dir>`.

## Output

List artifact paths by format, verification findings, and any format-specific failures. Do not convert artifact integrity findings into a judgment about the person or the application.
