import test from "node:test";
import assert from "node:assert/strict";

import { findChrome } from "../src/lib/browser.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";
import { resolveStyleProfile } from "../src/lib/resume-style.js";

const needsBrowser = findChrome() ? false : "no Chromium available";

// A resume built to sit exactly on the page boundary: the DOM measures the
// content as a hair over two pages, while Chromium paginates it into two. That
// gap is the whole defect, so the fixture is grown one single-line entry at a
// time until it crosses.
function boundaryResume(certificationCount) {
  return {
    header: {
      name: "Example Person",
      title: "Senior Engineer",
      email: "person@example.test",
      phone: "555-0100",
    },
    summary: "Engineer with a record of shipping reliable distributed systems at scale.",
    skills: ["Go", "Rust", "Python", "TypeScript", "SQL", "Kubernetes"],
    experience: [
      {
        company: "Example Alpha", role: "Senior Engineer", startDate: "2022", endDate: "Present",
        location: "Remote",
        highlights: Array.from({ length: 6 }, (_, index) =>
          `Delivered example workstream ${index} across several teams, measured against agreed service objectives.`),
      },
      {
        company: "Example Beta", role: "Engineer", startDate: "2019", endDate: "2022",
        location: "Remote",
        highlights: Array.from({ length: 4 }, (_, index) =>
          `Shipped example component ${index} and reported its operating characteristics quarterly.`),
      },
    ],
    education: [{ school: "Example University", degree: "BSc", field: "Computer Science", endDate: "2015" }],
    projects: [],
    certifications: Array.from({ length: certificationCount }, (_, index) => ({
      name: `Example Credential ${index + 1}`,
      issuer: "Example Institute",
      year: "2024",
    })),
  };
}

async function renderedPageCount(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getInfo()).total;
  } finally {
    await parser.destroy();
  }
}

async function measure(certifications, profile) {
  const { formatResumeToPdfWithLayout } = await import("../src/agents/format-resume.js");
  const { buffer, layout } = await formatResumeToPdfWithLayout({
    resumeJson: boundaryResume(certifications),
    style: profile,
  });
  return { layout, actual: await renderedPageCount(buffer) };
}

test(
  "measured layout never claims a page the PDF does not contain",
  { skip: needsBrowser },
  async () => {
    const { layoutFindings } = await import("../src/lib/layout-findings.js");
    const profile = resolveStyleProfile("precision-minimal");

    // The entry that crosses the boundary depends on font metrics, so it is
    // found rather than pinned: a hard-coded count would pass here and prove
    // nothing on a machine that measures text differently. Bisecting keeps the
    // browser launches down to what CI can afford.
    let low = 1;
    let high = 40;
    assert.equal((await measure(high, profile)).actual > 1, true, "the fixture must reach a second page");
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await measure(middle, profile)).actual > 1) high = middle;
      else low = middle + 1;
    }

    // Both sides of the crossing: the phantom page appeared just past it, where
    // the DOM measured a sliver of a third page that Chromium never printed.
    for (const certifications of [low - 2, low - 1, low, low + 1, low + 2]) {
      if (certifications < 1 || certifications > 40) continue;
      const { layout, actual } = await measure(certifications, profile);

      assert.equal(
        layout.pageCount,
        actual,
        `with ${certifications} single-line entries the layout claimed ` +
        `${layout.pageCount} pages and the PDF has ${actual}`
      );
      assert.equal(layout.pageFillPercent.length, layout.pageCount);

      const { issues } = layoutFindings({
        layout,
        skills: boundaryResume(certifications).skills,
        profile,
      });
      for (const issue of issues.filter((entry) => entry.code === "final_page_underfilled")) {
        const page = Number(/page\[(\d+)\]/.exec(issue.field)?.[1]);
        assert.ok(
          page >= 1 && page <= actual,
          `finding points at page ${page} of a ${actual}-page PDF`
        );
      }
    }
  }
);

test("a group label that also occurs in a bullet is still located correctly", () => {
  // "Platform" reads as an ordinary word in an experience bullet and as a group
  // label in the skills section. Searching for the bare word found the bullet,
  // placing the label before its predecessor and failing the order check on a
  // render that was entirely correct.
  const resume = {
    header: { name: "Example Person", title: "Engineer", email: "person@example.test", phone: "555-0100" },
    summary: "Example summary.",
    skills: ["Go", "Rust", "Kubernetes", "Docker"],
    skillGroups: [
      { label: "Languages", items: ["Go", "Rust"] },
      { label: "Platform", items: ["Kubernetes", "Docker"] },
    ],
    experience: [{
      company: "Example", role: "Engineer", startDate: "2020", endDate: "Present", location: "Remote",
      highlights: ["Wrote the runbooks adopted across the platform group"],
    }],
    education: [], projects: [], certifications: [],
  };

  const text = [
    "Example Person", "Engineer", "person@example.test | 555-0100",
    "Summary", "Example summary.",
    "Experience", "Example | 2020 - Present", "Engineer",
    "Wrote the runbooks adopted across the platform group",
    "Skills", "Languages: Go, Rust", "Platform: Kubernetes, Docker",
  ].join("\n");

  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    sectionOrder: resolveStyleProfile("precision-minimal").sectionOrder,
  });

  assert.deepEqual(result.issues.filter((issue) => issue.code === "skill_group_order"), []);
  assert.deepEqual(
    result.issues.filter((issue) => issue.code === "skill_outside_approved_group"),
    []
  );
});

test("a reordered group is still reported once, not once per skill", () => {
  const resume = {
    header: { name: "Example Person", title: "Engineer", email: "person@example.test", phone: "555-0100" },
    summary: "Example summary.",
    skills: ["Go", "Rust", "Kubernetes", "Docker"],
    skillGroups: [
      { label: "Languages", items: ["Go", "Rust"] },
      { label: "Platform", items: ["Kubernetes", "Docker"] },
    ],
    experience: [], education: [], projects: [], certifications: [],
  };

  const text = [
    "Example Person", "Engineer", "person@example.test | 555-0100",
    "Summary", "Example summary.",
    "Skills", "Platform: Kubernetes, Docker", "Languages: Go, Rust",
  ].join("\n");

  const result = validateRenderedArtifact({
    resume,
    extractedText: text,
    sectionOrder: resolveStyleProfile("precision-minimal").sectionOrder,
  });

  assert.equal(result.issues.some((issue) => issue.code === "skill_group_order"), true);
  assert.deepEqual(
    result.issues.filter((issue) => issue.code === "skill_outside_approved_group"),
    [],
    "the groups are intact; only their order is wrong"
  );
});
