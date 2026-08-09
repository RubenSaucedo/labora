// Parses a published pay band out of posting text.
//
// Scouts recorded `compensation: null` for postings that did publish a band, in
// a thoroughly standard form. The report then told the operator that pay was
// not published and to ask the recruiter -- advice that was wrong, and wrong in
// a way that shaped ranking, because search preferences carry a
// `minCompensation` floor.
//
// `null` must mean "absent from the posting", never "not extracted".

// Written out because a posting quoting "$180,000" and one quoting "$180K" are
// the same number, and a band spanning "$180K - $220,000" is common.
const AMOUNT = String.raw`[$£€]\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK]|,000)?`;

const RANGE = new RegExp(
  String.raw`${AMOUNT}\s*(?:-|–|—|\bto\b|\band\b)\s*${AMOUNT}`,
  "g"
);

// A band is only a band if the sentence is about pay. Without this, an equity
// figure, a funding round or a revenue number becomes a salary.
const PAY_CONTEXT =
  /\b(?:base )?(?:pay|salary|compensation|salary range|pay range|base)\b/i;

// Hourly and equity figures are real numbers in pay sentences that are not the
// annual base band, and silently promoting them would be worse than null.
const HOURLY = /\bper hour\b|\/\s?hour\b|\bhourly\b|\ban hour\b/i;
const EQUITY = /\bequity\b|\bstock\b|\bRSU\b|\boptions\b/i;

// The same posting often quotes a band for a location other than the one it is
// listed under, which changes what the number means to the reader.
const CITY_QUALIFIER =
  /(?:\b[Tt]he\s+)?\b(?!(?:The|Base|Salary|Pay|Compensation|Annual|Total|Target|Starting|Expected|Estimated|This|Our)\b)([A-Z][A-Za-z.\-]*(?:\s+[A-Z][A-Za-z.\-]*){0,3}(?:,\s*[A-Z]{2})?)\s+(?:base\s+)?(?:pay|salary|compensation)\s+range\b/;

const CURRENCY = [
  [/\bCAD\b|\bC\$/i, "CAD"],
  [/\bGBP\b|£/, "GBP"],
  [/\bEUR\b|€/, "EUR"],
  [/\bUSD\b|\bUS\$/i, "USD"],
];

function toNumber(digits, suffix) {
  const base = Number(String(digits).replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  if (suffix && /^[kK]$/.test(suffix)) return base * 1000;
  if (suffix === ",000") return base * 1000;
  // "$180" in a salary sentence is thousands; nobody publishes a $180 band.
  if (base < 1000) return base * 1000;
  return base;
}

function splitSentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+|\n+/);
}

/**
 * Returns a ZCompensation-shaped object, or null when the posting genuinely
 * publishes no band.
 */
export function parseCompensation(postingText) {
  for (const sentence of splitSentences(postingText)) {
    if (!PAY_CONTEXT.test(sentence)) continue;
    if (HOURLY.test(sentence)) continue;

    RANGE.lastIndex = 0;
    const match = RANGE.exec(sentence);
    if (!match) continue;

    const min = toNumber(match[1], match[2]);
    const max = toNumber(match[3], match[4]);
    if (min == null || max == null || max < min) continue;

    // An equity mention alongside a plausible salary band is fine; an equity
    // range with no salary band is not a salary.
    if (EQUITY.test(sentence) && !/\b(?:base|salary|pay)\b/i.test(sentence)) continue;

    const currency = (CURRENCY.find(([pattern]) => pattern.test(sentence)) || [null, "USD"])[1];
    const city = sentence.match(CITY_QUALIFIER)?.[1]?.trim() || "";

    return {
      min,
      max,
      currency,
      // The exact sentence, so the operator can check the number rather than
      // trust it -- and can see which city it was quoted for.
      source: sentence.trim().slice(0, 300),
      // Always present, never omitted: an absent key and an empty string read
      // the same to a consumer that only checks truthiness, and the schema
      // defaults it anyway.
      locationQualifier: city,
    };
  }
  return null;
}
