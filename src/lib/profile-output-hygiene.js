const EDITORIAL_MARKERS = [
  ["recommended wording", /\brecommended\s+(?:(?:resume|cv)\s+)?(?:wording|language|phrasing)\b/i],
  ["one-line statement", /\b(?:defensible\s+)?one[- ]line\s+(?:statement|summary|version)\b/i],
  ["resume bullet", /\b(?:resume|cv)\s+(?:bullet|line|summary)\b/i],
  ["lead with", /\blead\s+with\b/i],
  ["phrase as", /\bphrase(?:\s+this)?\s+as\b/i],
  ["frame as", /\b(?:frame|position|word)(?:\s+this)?\s+as\b/i],
  ["assessment language", /\b(?:best|strongest|most compelling)\s+(?:example|story|achievement)\b/i],
  ["selling point", /\b(?:key|primary)\s+selling\s+point\b/i],
];

export function profileEditorialMarker(value) {
  const text = String(value || "");
  return EDITORIAL_MARKERS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}
