import test from "node:test";
import assert from "node:assert/strict";
import { balanceSkillLines } from "../src/lib/skill-layout.js";

// The exact list from the issue report, in the order it rendered as 7 / 7 / 1.
const FIFTEEN = [
  "TypeScript", "Concurrency", "Graceful Degradation", "Observability",
  "Agent Orchestration", "Agent Evaluation", "Asynchronous Workflows",
  "JavaScript", "Node.js", "AI Agents", "Model Context Protocol", "React",
  "Next.js", "Angular", "Fastify",
];

const counts = (lines) => lines.map((line) => line.split(", ").length);

test("the reported 7/7/1 orphan row never renders", () => {
  const lines = balanceSkillLines(FIFTEEN);
  assert.equal(lines.length, 3);
  assert.ok(Math.min(...counts(lines)) >= 2, `produced ${counts(lines).join("/")}`);
  assert.notDeepEqual(counts(lines), [7, 7, 1]);
  assert.ok(!lines.includes("Fastify"), "the fifteenth skill must not be stranded alone");
});

test("width balancing beats the count-even fallback on the reported list", () => {
  // #113 asks for measured-width partitioning "when possible", and names
  // count-even rebalancing only as the floor. On the reported list the widths
  // are 60/73/76 rather than 81/72/56, so the rendered lines are visibly more
  // even than the count-based suggestion in the issue.
  const spread = (lines) => Math.max(...lines.map((l) => l.length)) - Math.min(...lines.map((l) => l.length));
  const countEven = [FIFTEEN.slice(0, 5), FIFTEEN.slice(5, 10), FIFTEEN.slice(10)]
    .map((run) => run.join(", "));
  assert.ok(
    spread(balanceSkillLines(FIFTEEN)) < spread(countEven),
    "width partitioning must produce more even lines than equal item counts"
  );
});

test("no run is ever a single item once there are two runs", () => {
  for (let size = 2; size <= 60; size += 1) {
    const items = Array.from({ length: size }, (_, i) => `skill-${i}`);
    const lines = balanceSkillLines(items);
    const sizes = counts(lines);
    if (sizes.length > 1) {
      assert.ok(Math.min(...sizes) >= 2, `size ${size} produced ${sizes.join("/")}`);
    }
  }
});

test("one very long item cannot strand itself, even when 7/1 minimises the longest line", () => {
  // Without the minimum-run constraint this is the adversarial case: every
  // alternative to 7/1 forces the long item to share a line, so 7/1 is the
  // genuine minimiser and a width-only objective would choose it.
  const items = ["a", "b", "c", "d", "e", "f", "g", "x".repeat(400)];
  assert.ok(Math.min(...counts(balanceSkillLines(items))) >= 2);
});

test("order is preserved and nothing is added or dropped", () => {
  assert.deepEqual(balanceSkillLines(FIFTEEN).join(", ").split(", "), FIFTEEN);
});

test("no line exceeds maxPerLine", () => {
  for (const size of [8, 15, 22, 43]) {
    const items = Array.from({ length: size }, (_, i) => `skill-${i}`);
    for (const line of balanceSkillLines(items, { maxPerLine: 7 })) {
      assert.ok(line.split(", ").length <= 7);
    }
  }
});

test("repeated calls are identical, so repeated renders cannot drift", () => {
  assert.deepEqual(balanceSkillLines(FIFTEEN), balanceSkillLines(FIFTEEN));
});

test("lines are balanced by width, not merely by count", () => {
  // Four long names then four short ones. A count-even split would put all the
  // long names on one line; balancing by width must not.
  const items = [
    "Model Context Protocol", "Distributed Tracing", "Graceful Degradation", "Agent Orchestration",
    "Go", "Rust", "C", "R",
  ];
  const [first, second] = balanceSkillLines(items, { maxPerLine: 7 });
  const widest = Math.max(first.length, second.length);
  const narrowest = Math.min(first.length, second.length);
  assert.ok(widest - narrowest < 40, `unbalanced widths: ${first.length} vs ${second.length}`);
});

test("category lines stay one per line instead of being merged", () => {
  const lines = balanceSkillLines(["Languages: Go, Rust", "Cloud: AWS, GCP"]);
  assert.deepEqual(lines, ["Languages: Go, Rust", "Cloud: AWS, GCP"]);
});

test("empty, single and non-array inputs are handled", () => {
  assert.deepEqual(balanceSkillLines([]), []);
  assert.deepEqual(balanceSkillLines(["Go"]), ["Go"]);
  assert.deepEqual(balanceSkillLines(null), []);
  assert.deepEqual(balanceSkillLines(undefined), []);
  assert.deepEqual(balanceSkillLines(["", "  ", "Go"]), ["Go"]);
});

test("maxPerLine below 3 is a configuration error, not a silent orphan", () => {
  assert.throws(() => balanceSkillLines(FIFTEEN, { maxPerLine: 2 }), /maxPerLine/);
  assert.throws(() => balanceSkillLines(FIFTEEN, { maxPerLine: 7.5 }), /maxPerLine/);
});
