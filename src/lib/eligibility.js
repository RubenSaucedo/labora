function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\bts[\s/.-]*sci\b/g, "top secret/sci")
    .replace(/\btop secret[\s/.-]+sci\b/g, "top secret/sci")
    .replace(/\s+/g, " ")
    .trim();
}

export function clearanceLevel(text) {
  const value = normalize(text);
  if (/\btop secret\/sci\b/.test(value)) return 4;
  if (/\btop secret\b/.test(value)) return 3;
  if (/\bsecret(?: security)? clearance\b/.test(value)) return 2;
  if (/\bsecurity clearance\b/.test(value)) return 1;
  return 0;
}

export function clearanceMatched(requirementText, candidateText) {
  const requirement = normalize(requirementText);
  const candidate = normalize(candidateText);
  if (/\bpublic trust\b/.test(requirement)) {
    return /\bpublic trust\b/.test(candidate) &&
      (!/\bactive\b/.test(requirement) || /\bactive\b.{0,40}\bpublic trust\b/.test(candidate));
  }
  const requiredLevel = clearanceLevel(requirementText);
  const candidateLevel = clearanceLevel(candidateText);
  if (!requiredLevel || candidateLevel < requiredLevel) return false;
  if (
    requiredLevel === 1 &&
    !/\b(?:security clearance|secret clearance|top secret)\b/.test(candidate)
  ) {
    return false;
  }
  if (!/\bactive\b/i.test(requirementText)) return true;
  return /\bactive\b.{0,40}\b(?:top secret\/sci|ts\/sci|top secret|secret(?: security)? clearance|security clearance|public trust)\b/i
    .test(candidate);
}
