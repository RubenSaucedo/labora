# `profile/generated/` — machine-owned, do not hand-edit

Everything in this folder is **produced by the `resume-persona` skill** from the
human-authored sources one level up. Every other stage of the pipeline reads
from here and writes nothing.

| File | Produced from | Consumed by |
|---|---|---|
| `identity.json` | `../background.md` | strategy, tailor, format, claim validation |
| `claims.json` | `../background.md`, optional `../career.md`, `../../evidence/performance-reviews/**/text/*.md`, `../../evidence/repositories/<date>/repositories.md` | strategy, tailor, claim validation, job scouts |
| `accomplishments.json` | `claims.json` | strategy shortlisting, tailor, ranking |

## Ownership

**Humans edit the sources, not this folder.**

```
profile/
  contact.md                 you edit freely      never grounds claims
  background.md              you edit rarely      grounds claims
  career.md                  optional             grounds claims
  search-preferences.json    you edit             trusted job-search config
  generated/                 resume-persona only  <- you are here
```

To change what is in here, change a source file and re-run `resume-persona`.

## Why hand-editing breaks things

`claims.json` anchors every claim to its source file by **content hash and exact
line range**. A hand-written claim has no verifiable anchor, so it either fails
validation (`source_hash_mismatch`, `claim_source_mismatch`) or — worse — passes
structurally while asserting something the evidence never supported. The whole
point of the ledger is that nothing reaches a resume without a traceable source.

The same applies to `accomplishments.json`, whose units must reference real claim
IDs, and to `identity.json`, whose `experience[]` entries must be claim-backed.

## For agents

- **Read** from this folder. Treat its contents as the verified ceiling on what
  may be asserted anywhere downstream.
- **Do not write** here unless you are `resume-persona`.
- If something you need is missing, that is an **evidence gap**: report it, and
  fix it by adding evidence to a source file and re-running `resume-persona`.
  Never patch this folder to make a validation pass.

`PROFILE.md` is a generated **review surface** for humans, written by
`src/tools/render-profile.js`. It is a view of the three JSON files, not a
source: editing it changes nothing the pipeline reads. Regenerate it after
every rebuild.
