import test from "node:test";
import assert from "node:assert/strict";
import { layoutFindings } from "../src/lib/layout-findings.js";
import { validateRenderedArtifact } from "../src/lib/validate-artifact.js";
import { resolveStyleProfile } from "../src/lib/resume-style.js";

const profile = resolveStyleProfile("precision-minimal");

test("an underfilled final page is reported, with a route attached", () => {
  const result = layoutFindings({
    layout: { pageCount: 2, pageFillPercent: [100, 23], finalPageFillPercent: 23 },
    skills: ["Go", "Rust", "Node.js", "React"],
    profile,
  });
  const finding = result.issues.find((issue) => issue.code === "final_page_underfilled");
  assert.ok(finding, "the reported defect must produce a finding");
  assert.equal(finding.severity, "warning");
  assert.match(finding.detail, /23%/);
  assert.ok(finding.action.length > 0, "a finding with no route attached is unfinished work");
  assert.equal(result.layout.finalPageFillPercent, 23);
});

test("a well-filled final page reports nothing", () => {
  const result = layoutFindings({
    layout: { pageCount: 2, pageFillPercent: [100, 78], finalPageFillPercent: 78 },
    skills: ["Go", "Rust"],
    profile,
  });
  assert.deepEqual(result.issues, []);
});

test("a single page is never judged underfilled, because there is no distribution", () => {
  const result = layoutFindings({
    layout: { pageCount: 1, pageFillPercent: [42], finalPageFillPercent: 42 },
    skills: ["Go", "Rust"],
    profile,
  });
  assert.deepEqual(result.issues, []);
});

test("an orphan skill row is detected as a regression guard on the balancer", () => {
  const result = layoutFindings({
    layout: { pageCount: 1, pageFillPercent: [90], finalPageFillPercent: 90 },
    skills: ["Go", "Rust", "C"],
    profile,
    skillLines: ["Go, Rust", "C"],
  });
  const finding = result.issues.find((issue) => issue.code === "orphan_skill_row");
  assert.ok(finding);
  assert.match(finding.detail, /2 \/ 1/);
  assert.equal(result.layout.orphanSkillRows, 1);
});

test("the balanced partition produces no orphan finding for the reported 15-skill list", () => {
  const result = layoutFindings({
    layout: { pageCount: 1, pageFillPercent: [80], finalPageFillPercent: 80 },
    skills: [
      "TypeScript", "Concurrency", "Graceful Degradation", "Observability",
      "Agent Orchestration", "Agent Evaluation", "Asynchronous Workflows",
      "JavaScript", "Node.js", "AI Agents", "Model Context Protocol", "React",
      "Next.js", "Angular", "Fastify",
    ],
    profile,
  });
  assert.deepEqual(result.issues, []);
});

test("every layout finding is a warning, never an error", () => {
  const result = layoutFindings({
    layout: { pageCount: 2, pageFillPercent: [100, 5], finalPageFillPercent: 5 },
    skills: ["Go", "Rust"],
    profile,
    skillLines: ["Go", "Rust"],
  });
  assert.ok(result.issues.length >= 2);
  assert.ok(result.issues.every((issue) => issue.severity === "warning"));
});

const RESUME = {
  header: { name: "Example Person", email: "person@example.test", phone: "555-0100" },
  summary: "Example summary.",
  skills: ["Go", "Rust"],
  experience: [], education: [], projects: [], certifications: [],
};
const TEXT = "Example Person person@example.test 555-0100 Summary Example summary. Skills Go, Rust";

test("a layout warning never flips a valid artifact to invalid", () => {
  const result = validateRenderedArtifact({
    resume: RESUME,
    extractedText: TEXT,
    layout: { pageCount: 2, pageFillPercent: [100, 9], finalPageFillPercent: 9 },
    profile,
  });
  assert.equal(result.valid, true, "reporting a layout concern must not become refusing to render");
  assert.equal(result.fieldRecallPercent, 100);
  assert.ok(result.issues.some((issue) => issue.code === "final_page_underfilled"));
  assert.equal(result.layout.finalPageFillPercent, 9);
});

test("a real recall error still invalidates, so the gate did not go soft", () => {
  const result = validateRenderedArtifact({
    resume: RESUME,
    extractedText: "Example Person person@example.test 555-0100 Summary Example summary.",
    layout: { pageCount: 2, pageFillPercent: [100, 9], finalPageFillPercent: 9 },
    profile,
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.severity === "error"));
});

test("validation without a layout is unchanged and reports no layout block", () => {
  const result = validateRenderedArtifact({ resume: RESUME, extractedText: TEXT });
  assert.equal(result.valid, true);
  assert.equal(result.layout, null);
  assert.deepEqual(result.issues, []);
});
