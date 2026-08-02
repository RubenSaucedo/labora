export const SKILL_ALIAS_VERSION = "2026-07-28";

export const SKILL_ALIASES = {
  react: ["react", "react.js"],
  jquery: ["jquery"],
  typescript: ["typescript"],
  javascript: ["javascript", "ecmascript"],
  css: ["css", "cascading style sheets"],
  "node.js": ["node.js", "nodejs"],
  "github-actions": ["github actions"],
  "spa-development": ["spa development", "single-page application", "single page application", "spa"],
  "frontend-development": ["frontend development", "front-end development", "frontend engineering", "frontend engineer", "frontend"],
  "backend-development": ["backend development", "back-end development", "server-side development", "backend engineer", "backend"],
  "performance-optimization": ["performance optimization", "performance tuning", "web performance", "page load time", "page load times", "load time"],
  accessibility: ["web accessibility", "accessibility", "a11y"],
  wcag: ["wcag", "wcag 2.0", "wcag 2.1", "wcag 2.2"],
  "ci-cd": ["ci/cd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"],
  testing: ["testing frameworks", "automated testing", "unit testing", "integration testing", "test automation"],
  mentoring: ["mentoring", "mentor", "mentored", "coaching engineers", "developing engineers"],
  communication: ["communication", "written communication", "verbal communication"],
  "design-systems": ["design system", "design systems"],
  "component-libraries": ["component library", "component libraries", "ui library", "ui libraries"],
  "open-source": ["open source", "open-source"],
  graphql: ["graphql"],
  nextjs: ["next.js", "nextjs"],
  vue: ["vue", "vue.js"],
  angular: ["angular"],
  aws: ["aws", "amazon web services"],
  azure: ["azure", "microsoft azure"],
  gcp: ["gcp", "google cloud", "google cloud platform"],
  kubernetes: ["kubernetes", "k8s"],
  docker: ["docker", "containerization", "containers"],
  terraform: ["terraform", "infrastructure as code", "iac"],
  "system-design": ["system design", "software architecture", "distributed systems"],
  leadership: ["technical leadership", "engineering leadership", "team leadership"],
  "cross-functional": ["cross-functional", "cross functional", "stakeholder collaboration"],
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsSurfaceForm(text, surfaceForm) {
  const normalized = String(text || "").toLowerCase();
  const escaped = escapeRegExp(surfaceForm.toLowerCase());
  const needsBoundaries = /^[a-z0-9]/.test(surfaceForm) && /[a-z0-9]$/.test(surfaceForm);
  const pattern = needsBoundaries ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, "i").test(normalized);
}

export function canonicalSkillsInText(text) {
  const matches = [];
  for (const [canonicalId, surfaceForms] of Object.entries(SKILL_ALIASES)) {
    const matchedSurface = surfaceForms.find((surface) => containsSurfaceForm(text, surface));
    if (matchedSurface) {
      matches.push({ canonicalId, matchedSurface, surfaceForms });
    }
  }
  return matches;
}
