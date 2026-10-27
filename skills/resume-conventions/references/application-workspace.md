# Shared current-state applications

This opt-in contract coexists with native application packages. Inspection and
session startup never adopt, migrate or rewrite a workspace. Read the operator's
instructions before proposing outputs.

At the persona root, the operator may author `application-workspace.json`:

```json
{
  "schemaVersion": "1.0",
  "layout": "shared-current-state",
  "indexFormat": "labora-application-index-v1",
  "instructions": "applications/README.md",
  "index": "applications/index.json",
  "dashboard": "applications/dashboard.md",
  "briefs": "applications/briefs",
  "forms": "applications/forms",
  "answers": "applications/answers",
  "plans": "applications/plans"
}
```

Paths are explicit and persona-relative; different paths are allowed. The
instructions file must already exist. Existing indexes using another format
need an operator-agreed adapter or conversion, not automatic adoption. The
declared index uses `{ "schemaVersion": "1.0", "openings": [] }`; additional
operator metadata is preserved. Generated briefs and dashboard carry ownership
markers. Unmarked files are never overwritten.

Inspect with `labora application inspect <persona>`. To hand off one observation,
prepare a selection such as:

```json
{
  "openingId": "opening-a",
  "identity": { "authority": "example.invalid", "requisition": "a" },
  "source": {
    "path": "archive/job-search/run-a/candidates.json",
    "sha256": "<SHA-256 of the entire observation file>",
    "jobId": "discovery-a",
    "observedAt": "2026-10-01T10:00:00Z",
    "postingHash": "<original postingHash>"
  }
}
```

Run `labora application track <persona> <selection.json>` to preview; add
`--apply` to update the selected record, brief and dashboard. Apply serializes
index writers and checks for concurrent changes. The index is authoritative;
if writing a derived output fails, correct that file error and repeat the same
handoff to regenerate outputs. Do not manually maintain a queue in run reports.

An exact canonical HTTP(S) `identity.url` can replace authority/requisition.
Titles alone never establish identity. Different requisitions remain distinct;
conflicting IDs or duplicate identities require operator reconciliation.

The source must resolve exactly under this persona and match its recorded
bytes, candidate ID, posting hash and timestamp. Moving a run into the archive
requires updating `source.path`, not the original observation bytes or dates.
Nothing searches for a substitute. Sources stay historical until an explicit
`verification` with `status`, `checkedAt`, and checked `url` records a fresh
observation. `seen.json` only deduplicates leads.

Form capture, answer review and submission have independent state. A refresh
cannot manufacture a submission event. Research, archive, tooling and answer
directories remain operator-owned; no repair invokes migration, resume
generation, scaffolding or uploads. Native packages remain addressable by their
explicit paths and require no shared descriptor.
