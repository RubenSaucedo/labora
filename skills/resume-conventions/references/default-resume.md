# Reusing an approved default

Discovery and preparation do not request editorial work. Read the operator's
designated baseline before suggesting a variation. A new opening URL does not
justify a rebuild, copy or re-render.

The shared workspace descriptor may declare
`"defaultResume": "profile/resume/current.json"`. Alternatively pass a descriptor
explicitly to `labora application resume <persona> --descriptor <current.json>`.
No particular filename or location establishes approval.

Example descriptor (all paths are persona-relative):

```json
{
  "schemaVersion": "1.0",
  "artifact": { "path": "profile/resume/resume.pdf", "sha256": "<artifact hash>" },
  "approval": { "path": "profile/resume/approval.json", "sha256": "<snapshot hash>" },
  "relocations": "profile/resume/relocations.json"
}
```

The immutable approval snapshot records exactly what the operator approved:

```json
{
  "schemaVersion": "1.0",
  "artifact": { "path": "profile/resume/resume.pdf", "sha256": "<artifact hash>" },
  "source": { "path": "applications/original-build/resume.json", "sha256": "<source hash>" },
  "approvedAt": "2026-10-01T10:00:00Z",
  "reference": "operator-confirmation-a",
  "acceptedFindings": []
}
```

Write this snapshot only after the person explicitly approves those exact
artifact bytes. A verification tool never creates approval. Preserve accepted
findings; reuse assurance is not a new reader review or evidence of eligibility
or employer interest.

`labora application resume <persona> <opening-id>` previews a reference on an
existing index entry. Add `--apply` to select it. Multiple openings reference
one artifact, not per-opening copies. Verification compares the artifact,
snapshot and renderer source hashes; mismatch pauses upload and asks the
operator to resolve the exact approval. It never silently rebuilds or selects
another file. Live entry must repeat this verification immediately before
upload and compare the selected reference with the reviewed plan.

If the original build is archived, leave the snapshot unchanged and record a
separate relocation file:

```json
{
  "schemaVersion": "1.0",
  "relocations": [{
    "from": "applications/original-build/resume.json",
    "to": "archive/applications/original-build/resume.json",
    "sha256": "<the same original source hash>"
  }]
}
```

Relocations are exact file mappings, not guessed directory searches. Their
destination bytes must match the original source hash. Missing, ambiguous or
changed sources need explicit correction, never a compatibility directory or a
rewrite of approval history. Moving a build does not erase accepted findings.

Read what the selected rendered artifact actually communicates for the opening,
separately from facts in the wider profile. Bring limitations as concrete
questions, never invented claims or hiring odds. If a material role-family
difference warrants variation, explain why and obtain approval before invoking
editorial or rendering skills. Place that variation beside the default with a
descriptive suffix, leave the default intact, and give the variation its own
review and exact approval. Form answers and interview preparation remain
opening-specific. The operator sends and submits.
