# Security Policy

Labora runs on a person's most sensitive career material — resumes, performance
reviews, contact details — and drives a browser through their logged-in
sessions. Security reports are welcome and taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's
[Security Advisories](https://github.com/RubenSaucedo/labora/security/advisories/new)
form, which is visible only to the maintainers.

Please include what an attacker could achieve, the steps to reproduce, and the
version or commit you tested. A synthetic reproduction is strongly preferred —
**never attach a real resume, review or contact record** to demonstrate a bug.

This is a personal open-source project with no paid on-call. Expect an initial
response within about a week. There is no bounty program.

## What is in scope

The interesting attack surface is the boundary between untrusted input and
trusted output:

- **Prompt injection through untrusted content.** Job descriptions, PDFs, OCR
  output and web pages are data, never instructions. A posting that causes an
  agent to change a claim, exfiltrate persona data, or take an action outside
  its contract is a valid report.
- **Persona data leaving the machine.** Anything that writes personal data to a
  tracked path, a log, a public artifact, or a network destination.
- **Credential handling.** Labora must never request, store or transmit a
  password. Any path that does is a vulnerability.
- **Agent boundary escapes.** A curating, advocating or judging context gaining
  browser access, or a judge seeing tailoring rationale, defeats the guarantees
  the pipeline is built on.
- **Unsafe file or command handling** in the deterministic tools under `src/`.

## What is out of scope

- Vulnerabilities in the upstream model, the Copilot CLI, or Claude itself.
  Report those to their vendors.
- Known-dangerous behaviour a user opted into explicitly on their own machine.
- Findings from automated scanners with no demonstrated impact.

## For users

Labora keeps real persona data local by design: `data/personas/` is gitignored
except the synthetic `example` persona, and contact details are injected
deterministically at render time rather than passed through the drafting model.

If you fork this repository, check `git status` before committing and confirm no
persona files are staged. If personal data does reach a public repository,
rewriting history is not enough — GitHub can continue serving detached commits
at their direct SHA. Delete and recreate the repository, and rotate anything
credential-shaped that was exposed.
