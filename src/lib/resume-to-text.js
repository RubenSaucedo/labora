/**
 * Serialize structured resume (job-tailored or humanized JSON) to plain text.
 * Used for display, HR Judge input, or any place that needs a single text blob.
 */
export function resumeToText(resume) {
  if (!resume) return "";
  const lines = [];
  const contact = resume.contact && typeof resume.contact === "object" ? resume.contact : {};
  const contactParts = [contact.name, contact.email, contact.phone, contact.location, contact.linkedin, contact.github, contact.portfolio].filter(Boolean);
  if (contactParts.length) {
    lines.push(contactParts.join(" | "));
    lines.push("");
  }
  lines.push(resume.ats_title || resume.target_role || "");
  lines.push("");
  lines.push("Summary");
  lines.push(resume.summary || "");
  lines.push("");
  lines.push("Skills");
  lines.push([...(resume.skills_primary || []), ...(resume.skills_secondary || [])].join(", "));
  lines.push("");
  lines.push("Experience");
  for (const e of resume.experience || []) {
    lines.push(`${e.company || ""} | ${e.role || ""} | ${e.period || ""}`);
    for (const b of e.bullets || []) lines.push(`- ${b}`);
    lines.push("");
  }
  if (Array.isArray(resume.education) && resume.education.length) {
    lines.push("Education");
    for (const ed of resume.education) {
      const parts = [ed.school, ed.degree, ed.field, ed.location, [ed.startDate, ed.endDate].filter(Boolean).join("–")].filter(Boolean);
      if (parts.length) lines.push(parts.join(" | "));
    }
    lines.push("");
  }
  if (Array.isArray(resume.projects) && resume.projects.length) {
    lines.push("Projects");
    for (const p of resume.projects) {
      if (p.name) lines.push(p.name);
      if (p.description) lines.push(p.description);
      for (const h of p.highlights || []) lines.push(`- ${h}`);
    }
    lines.push("");
  }
  if (Array.isArray(resume.certifications) && resume.certifications.length) {
    lines.push("Certifications");
    lines.push(resume.certifications.map((c) => (typeof c === "string" ? c : (c && c.name) || "")).filter(Boolean).join(", "));
    lines.push("");
  }
  if (Array.isArray(resume.awards_or_contributions) && resume.awards_or_contributions.length) {
    lines.push("Awards & Contributions");
    for (const a of resume.awards_or_contributions) {
      const title = typeof a === "string" ? a : (a && a.title) || "";
      const rest = typeof a === "object" && a ? [a.description, a.year, a.link].filter(Boolean).join(" — ") : "";
      lines.push(rest ? `${title} — ${rest}` : title);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
