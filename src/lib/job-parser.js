import fs from "fs";

export function loadJobFromFile(jobPath) {
  const raw = fs.readFileSync(jobPath, "utf-8");
  const sections = {};
  let current = "description";
  for (const line of raw.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      sections[current] = "";
    } else {
      sections[current] = (sections[current] ?? "") + line + "\n";
    }
  }
  const title =
    (sections.title ?? "").trim().split("\n")[0] ||
    (sections.description ?? "").trim().split("\n")[0] ||
    "Job";
  const company = (sections.company ?? "").trim().split("\n")[0] || "";
  const description = (sections.description ?? raw).trim();
  return { title: title || "Job", company, description, raw };
}
