import test from "node:test";
import assert from "node:assert/strict";
import { parseContact } from "../src/lib/profile-contact.js";

test("maps Web to the portfolio contact field", () => {
  const contact = parseContact("- Web: https://example.test");
  assert.equal(contact.portfolio, "https://example.test");
});

test("rejects unknown contact fields instead of discarding them", () => {
  assert.throws(
    () => parseContact("- Wesbite: https://example.test"),
    /unknown contact field "Wesbite"/
  );
});

test("rejects multiple destinations in a single link field", () => {
  for (const value of [
    "first-site.test, second-site.test",
    "first-site.test;second-site.test",
  ]) {
    assert.throws(
      () => parseContact(`- Portfolio: ${value}`),
      /accepts one value, not a list/
    );
  }
});

test("allows commas in location fields", () => {
  const contact = parseContact("- Location: Seattle, WA");
  assert.equal(contact.location, "Seattle, WA");
});
