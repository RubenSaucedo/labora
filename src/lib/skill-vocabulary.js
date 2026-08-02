/**
 * The displayable skill vocabulary.
 *
 * The identity record used to carry a hand-written `technical_skills` allowlist that gated every
 * displayed skill. An allowlist has to enumerate everything, so it goes stale the
 * moment the claim ledger grows — and a stale allowlist silently caps the resume
 * below what the evidence actually supports.
 *
 * The vocabulary is therefore derived from the accomplishment bank, where every
 * unit already declares the terms it demonstrates, and the identity record keeps only a veto
 * list. A veto list enumerates exceptions instead of the whole world, so it
 * cannot fall behind the ledger.
 *
 * This is a labelling gate, not an evidence gate: a displayed skill must still
 * map to verified claims and survive claim grounding.
 */

export function normalizeSkill(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function skillVocabulary({ identity, bank }) {
  const vetoes = new Set((identity?.skill_vetoes || []).map(normalizeSkill));
  const allowed = new Map();

  function offer(term, source) {
    const key = normalizeSkill(term);
    if (!key || vetoes.has(key)) return;
    if (!allowed.has(key)) allowed.set(key, { label: String(term), sources: new Set() });
    allowed.get(key).sources.add(source);
  }

  for (const unit of bank?.units || []) {
    for (const term of unit.techStack || []) offer(term, `unit:${unit.id}`);
  }
  // A 3.0 identity record has no bank behind it; its former allowlist keeps it renderable.
  for (const term of identity?.legacy_skills || []) offer(term, "legacy_skills");

  return {
    terms: allowed,
    has(skill) {
      return allowed.has(normalizeSkill(skill));
    },
    labels() {
      return [...allowed.values()].map((entry) => entry.label);
    },
    get size() {
      return allowed.size;
    },
  };
}
