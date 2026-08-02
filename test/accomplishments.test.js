import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateAccomplishments,
  rankAccomplishments,
} from "../src/lib/validate-accomplishments.js";
import { ZAccomplishmentBank } from "../src/schemas/accomplishments.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function read(persona, file) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "data", "personas", persona, "profile", "generated", file), "utf8")
  );
}

function baseUnit(overrides = {}) {
  return {
    id: "unit-a",
    experienceId: "acme-senior-frontend-2022",
    title: "Migration",
    kind: "platform",
    startDate: "2022-03",
    endDate: "2023-06",
    contribution: "tech_lead",
    scope: { productionExposure: "shipped_ga" },
    techStack: ["react"],
    outcomes: [
      {
        claimId: "claim-acme-migration",
        metric: "page_load_time",
        direction: "reduced",
        confidence: "production_measured",
      },
    ],
    evidenceStrength: { tier: "strong", sourceKinds: ["pr_body"], artifactCount: 1 },
    disclosure: "public",
    claimIds: ["claim-acme-migration"],
    ...overrides,
  };
}

function fixture(units) {
  return {
    bank: ZAccomplishmentBank.parse({ schemaVersion: "1.0", persona: "example", units }),
    ledger: read("example", "claims.json"),
    identity: read("example", "identity.json"),
  };
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

// Only `example` is committed; other personas are gitignored private data, so
// they are covered when present rather than assumed to exist.
function shippedPersonas() {
  const root = path.join(repoRoot, "data", "personas");
  return fs
    .readdirSync(root)
    .filter((persona) =>
      fs.existsSync(path.join(root, persona, "profile", "generated", "accomplishments.json")),
    );
}

test("every shipped accomplishment bank validates against its own ledger", () => {
  for (const persona of shippedPersonas()) {
    const bank = ZAccomplishmentBank.parse(read(persona, "accomplishments.json"));
    const result = validateAccomplishments({
      bank,
      ledger: read(persona, "claims.json"),
      identity: read(persona, "identity.json"),
    });
    assert.deepEqual(result.issues, [], `${persona} bank should be clean`);
    assert.equal(result.valid, true);
  }
});

test("a unit cannot reference a claim that does not exist", () => {
  const result = validateAccomplishments(
    fixture([baseUnit({ claimIds: ["claim-acme-migration", "claim-imaginary"], outcomes: [] })])
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("unknown_claim"));
});

test("a unit cannot claim an outcome it does not own", () => {
  const result = validateAccomplishments(
    fixture([baseUnit({ claimIds: ["claim-acme-analytics"] })])
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("outcome_claim_not_in_unit"));
});

test("a unit cannot be less confidential than the claims it is built from", () => {
  const { bank, identity } = fixture([baseUnit({ disclosure: "public" })]);
  const ledger = read("example", "claims.json");
  const target = ledger.claims.find((claim) => claim.id === "claim-acme-migration");
  target.disclosure = "internal_only";

  const result = validateAccomplishments({ bank, ledger, identity });
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("unit_disclosure_too_permissive"));
});

test("a unit cannot reference an experience missing from the identity record", () => {
  const result = validateAccomplishments(
    fixture([baseUnit({ experienceId: "nowhere-2099" })])
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("unknown_experience_id"));
});

test("unit date ranges must be coherent", () => {
  const backwards = validateAccomplishments(
    fixture([baseUnit({ startDate: "2024-01", endDate: "2023-01" })])
  );
  assert.ok(codes(backwards).includes("unit_date_range"));

  const ongoingWithEnd = validateAccomplishments(
    fixture([baseUnit({ ongoing: true, endDate: "2023-06" })])
  );
  assert.ok(codes(ongoingWithEnd).includes("unit_date_range"));
});

test("duplicate unit ids and unknown supersedes targets are rejected", () => {
  const duplicates = validateAccomplishments(fixture([baseUnit(), baseUnit()]));
  assert.ok(codes(duplicates).includes("duplicate_unit_id"));

  const dangling = validateAccomplishments(
    fixture([baseUnit({ supersedes: ["unit-ghost"] })])
  );
  assert.ok(codes(dangling).includes("unknown_superseded_unit"));
});

test("ranking prefers stack overlap, stronger evidence and measured outcomes", () => {
  const { bank } = fixture([
    baseUnit({ id: "unit-match" }),
    baseUnit({
      id: "unit-weak",
      techStack: ["cobol"],
      contribution: "reviewer",
      scope: { productionExposure: "prototype" },
      evidenceStrength: { tier: "weak", sourceKinds: ["self_report"], artifactCount: 0 },
      outcomes: [],
    }),
  ]);

  const ranked = rankAccomplishments({
    bank,
    jobTerms: ["React"],
    asOf: new Date("2024-01-01T00:00:00Z"),
  });
  assert.equal(ranked[0].unitId, "unit-match");
  assert.deepEqual(ranked[0].matchedTerms, ["react"]);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("ranking decays older work and treats ongoing units as current", () => {
  const { bank } = fixture([
    baseUnit({ id: "unit-old", endDate: "2018-01" }),
    baseUnit({ id: "unit-now", endDate: null, ongoing: true }),
  ]);

  const ranked = rankAccomplishments({
    bank,
    jobTerms: ["react"],
    asOf: new Date("2024-01-01T00:00:00Z"),
  });
  const byId = new Map(ranked.map((entry) => [entry.unitId, entry]));
  assert.equal(byId.get("unit-now").monthsAgo, 0);
  assert.ok(byId.get("unit-old").monthsAgo > 60);
  assert.ok(byId.get("unit-now").score > byId.get("unit-old").score);
});

test("ranking is deterministic and never reads prose", () => {
  const { bank } = fixture([baseUnit({ id: "unit-a" }), baseUnit({ id: "unit-b" })]);
  const args = { bank, jobTerms: ["react"], asOf: new Date("2024-01-01T00:00:00Z") };
  assert.deepEqual(rankAccomplishments(args), rankAccomplishments(args));
});
