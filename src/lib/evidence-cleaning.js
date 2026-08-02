function numericTokens(text) {
  return String(text || "").match(
    /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?(?:%|\+)?(?:\s*(?:percent|years?|months?|weeks?|days?|hours?|minutes?|seconds?|users?|customers?|clients?|teams?|products?|projects?|requests?|transactions?|dollars?|usd|gb|mb|kb))?(?![A-Za-z0-9])/gi
  ) || [];
}

function normalizedToken(token) {
  return token
    .replace(/,/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+to\s+/gi, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function validateEvidenceCleaning({
  extractedText,
  cleanedText,
  sourceHash = null,
  expectedSourceHash = null,
  extractedHash = null,
  expectedExtractedHash = null,
  cleanedHash = null,
}) {
  const extractedNumbers = new Set(numericTokens(extractedText).map(normalizedToken));
  const cleanedNumbers = [...new Set(numericTokens(cleanedText).map(normalizedToken))];
  const introducedNumbers = cleanedNumbers.filter((token) => !extractedNumbers.has(token));
  const issues = introducedNumbers.map((token) => ({
    severity: "error",
    code: "introduced_numeric_token",
    token,
    message: `Cleaned evidence introduced numeric token "${token}" absent from the extraction.`,
  }));
  if (expectedSourceHash && sourceHash !== expectedSourceHash) {
    issues.push({
      severity: "error",
      code: "source_hash_mismatch",
      message: "The raw PDF no longer matches the extraction metadata.",
    });
  }
  if (expectedExtractedHash && extractedHash !== expectedExtractedHash) {
    issues.push({
      severity: "error",
      code: "extraction_hash_mismatch",
      message: "The mechanical extraction no longer matches its metadata.",
    });
  }

  return {
    schemaVersion: "1.0",
    valid: issues.length === 0,
    introducedNumbers,
    bindings: {
      sourceHash,
      extractedHash,
      cleanedHash,
    },
    issues,
  };
}
