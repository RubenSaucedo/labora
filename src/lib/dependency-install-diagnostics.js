const NETWORK_FAILURE = /\b(?:EAI_AGAIN|ENETUNREACH|ENOTCONN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_TLS|CERT_[A-Z_]+)\b|unable to verify the first certificate|self[- ]signed certificate|tls handshake/i;

export function sanitizeRegistryUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const registry = new URL(raw);
    registry.username = "";
    registry.password = "";
    registry.search = "";
    registry.hash = "";
    return registry.toString();
  } catch {
    return "(invalid registry URL)";
  }
}

export function sanitizeNpmOutput(value) {
  return String(value || "")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "(invalid URL redacted)";
      }
    })
    .replace(
      /((?:_authToken|authToken|token|password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]",
    );
}

export function classifyNpmFailure({ error = null, stderr = "", registry = "" } = {}) {
  const detail = [error?.code, error?.message, stderr].filter(Boolean).join("\n");
  const safeRegistry = sanitizeRegistryUrl(registry);
  const registrySuffix = safeRegistry ? ` at ${safeRegistry}` : "";

  if (error?.code === "ENOENT" || /\bENOENT\b/.test(detail)) {
    return {
      kind: "npm_missing",
      summary: "npm is unavailable.",
      route: "Install or repair a Node distribution that includes npm, then run \"labora doctor\" again.",
    };
  }
  if (/\bE401\b|401\s+Unauthorized/i.test(detail)) {
    return {
      kind: "registry_authentication",
      summary: `The npm registry rejected authentication${registrySuffix}.`,
      route: "Re-authenticate using the registry process approved for this environment, then run \"labora doctor\" again.",
    };
  }
  if (/\bE403\b|403\s+Forbidden/i.test(detail)) {
    return {
      kind: "registry_forbidden",
      summary: `The npm registry refused access${registrySuffix}.`,
      route: "Check registry credentials and access policy with the owner of this environment, then run \"labora doctor\" again.",
    };
  }
  if (/\bE404\b|404\s+Not Found/i.test(detail)) {
    return {
      kind: "registry_package_unavailable",
      summary: `The configured npm registry cannot provide a required package${registrySuffix}.`,
      route: "Check registry routing and package access with the owner of this environment, then run \"labora doctor\" again.",
    };
  }
  if (NETWORK_FAILURE.test(detail)) {
    return {
      kind: "registry_unreachable",
      summary: `The npm registry is unreachable from this machine${registrySuffix}.`,
      route: "Check the configured proxy, network, and TLS policy with the owner of this environment, then run \"labora doctor\" again.",
    };
  }
  return {
    kind: "unknown",
    summary: "npm failed for an unrecognized reason.",
    route: "Review the npm output above. Labora did not guess at a workaround or try another registry.",
  };
}
