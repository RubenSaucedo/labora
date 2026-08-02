# Background

<!--
FROZEN EVIDENCE FILE. Durable self-reported facts only.

claims.json anchors to this file by content hash and exact line range, so any
edit invalidates the claims grounded here until they are re-verified with
  node src/tools/validate-claims.js

Belongs here: positions held, education, side projects, certifications, awards.

Does NOT belong here:
  - a written profile summary
  - resume bullets for a period that already has a richer evidence corpus
  - a list of technical skills

Those three are pre-baked resume prose. The tailor derives renderable wording
from claims.json and accomplishments.json; anything phrased like a finished
resume line here will anchor the model to it and cap output quality. Displayed
skills are derived from accomplishment techStack, not declared here.

Contact details live in contact.md.
-->

## Professional Profile
<!--
Atomic fields only, never a written summary. A summary paragraph is
copy-pasteable prose; these fields are not.
-->
- Current title:
- Years of professional experience:
- Focus:

## Work Experience
<!-- Positions held. Period-by-period narratives go in career.md instead. -->
#### Title:
#### Company:
#### Location:
#### Duration:

<!--
Add a self-reported bullet ONLY for a period with no richer evidence (no
performance reviews, no career.md coverage). Otherwise leave the position as
header fields alone and let the evidence corpus carry it.
-->

## Education
<!-- Degree, school, location, years -->

## Certifications
<!-- Optional. Name, issuer, year, and a verification link when one exists. -->

## Projects
<!-- Optional -->

## Awards & Contributions
<!-- Optional -->
