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
  web: "portfolio",
};

const SINGLE_VALUE_LINK_FIELDS = new Set(["email", "linkedin", "github", "portfolio"]);
const SUPPORTED_CONTACT_FIELDS =
  "Name, Phone, Email, Address/Location, LinkedIn, GitHub, Portfolio/Web";

function looksLikeContactDestination(value, targetKey) {
  if (targetKey === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  return /^(?:https?:\/\/|www\.)?[^\s/]+\.[^\s]+$/i.test(value);
}

function containsMultipleValues(value, targetKey) {
  if (!SINGLE_VALUE_LINK_FIELDS.has(targetKey)) return false;
  const candidates = value
    .split(/\s*;\s*|,\s+/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  return candidates.filter((candidate) => looksLikeContactDestination(candidate, targetKey)).length > 1;
}

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

  const issues = [];
  for (const [index, line] of String(text || "").split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?([^:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const sourceKey = match[1].trim().toLowerCase();
    const targetKey = CONTACT_KEYS[sourceKey];
    if (!targetKey) {
      issues.push(
        `line ${index + 1}: unknown contact field "${match[1].trim()}". ` +
        `Supported fields: ${SUPPORTED_CONTACT_FIELDS}.`
      );
      continue;
    }

    const value = match[2].trim();
    if (containsMultipleValues(value, targetKey)) {
      issues.push(
        `line ${index + 1}: contact field "${match[1].trim()}" accepts one value, not a list.`
      );
      continue;
    }
    if (!contact[targetKey]) contact[targetKey] = value;
  }

  if (issues.length) {
    throw new Error(`contact.md contains invalid fields:\n- ${issues.join("\n- ")}`);
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
