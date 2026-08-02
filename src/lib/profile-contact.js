import fs from "node:fs";

// Reads profile/contact.md, the persona's private contact card.
//
// contact.md is deliberately excluded from the claim-grounding corpus (see
// sourceMayGroundClaims in validate-resume-claims.js): claims are anchored to
// their source file by content hash, so if contact details shared a file with
// grounded evidence, changing a phone number would invalidate the ledger.
const CONTACT_KEYS = {
  name: "name",
  phone: "phone",
  email: "email",
  address: "location",
  location: "location",
  linkedin: "linkedin",
  github: "github",
  portfolio: "portfolio",
};

export function parseContact(text) {
  const contact = {
    name: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
    github: "",
    portfolio: "",
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?([^:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const sourceKey = match[1].trim().toLowerCase();
    const targetKey = CONTACT_KEYS[sourceKey];
    if (targetKey && !contact[targetKey]) contact[targetKey] = match[2].trim();
  }

  return contact;
}

export function loadContact(contactPath) {
  return parseContact(fs.readFileSync(contactPath, "utf8"));
}

export function injectContact(resume, contact) {
  const required = ["name", "email", "phone"];
  const missing = required.filter((key) => !contact?.[key]);
  if (missing.length) {
    throw new Error(`contact.md is missing required contact fields: ${missing.join(", ")}.`);
  }
  return {
    ...resume,
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      location: contact.location || "",
      linkedin: contact.linkedin || "",
      github: contact.github || "",
      portfolio: contact.portfolio || "",
    },
  };
}
