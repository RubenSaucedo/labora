export const DISCLOSURE_VALUES = Object.freeze([
  "public",
  "internal_generalizable",
  "internal_only",
]);

export const RESTRICTION_RANK = Object.freeze({
  public: 0,
  internal_generalizable: 1,
  internal_only: 2,
});

export function renderAuthorization(value) {
  const disclosure = value?.disclosure;
  if (disclosure === "public") return "authorized";
  if (disclosure === "internal_generalizable") return "requires_generalization";
  if (disclosure === "internal_only") return "withheld_confidential";
  return "withheld_unclassified";
}
