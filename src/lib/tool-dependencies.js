// Which declared dependencies a single tool actually needs.
//
// This module imports nothing outside Node's standard library, because
// bin/labora loads it precisely when no dependency is installed. Anything it
// required would be the thing it exists to report as missing.
//
// The set is derived by walking the tool's own import graph rather than read
// from a committed map. A map is a second source of truth that drifts silently:
// the day a tool gains an import, the map still says it needs nothing and the
// tool fails with a raw ERR_MODULE_NOT_FOUND instead of a named route.
import fs from "node:fs";
import path from "node:path";

// Matches static `import ... from "x"` / `export ... from "x"` and dynamic
// `import("x")`. Deliberately conservative: a specifier it fails to see is
// reported by the runtime instead, and callers keep the raw-failure fallback.
const SPECIFIER = /(?:^|[\s;}])(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

// Node resolves an extensionless relative specifier only for a real file, and
// labora's sources are all explicit ".js". Directory and extensionless forms are
// still tried so a future import style does not silently drop a subgraph.
function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

// "@scope/name/deep/path" -> "@scope/name"; "name/deep/path" -> "name".
function packageName(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function specifiers(file) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const found = [];
  SPECIFIER.lastIndex = 0;
  let match;
  while ((match = SPECIFIER.exec(source)) !== null) {
    found.push(match[1] || match[2]);
  }
  return found;
}

/**
 * Every package in `declared` reachable from `entryFile` through relative
 * imports, transitively.
 *
 * Only declared dependencies are returned. An optional dependency is excluded
 * on purpose: it gates a feature, not the tool, and reporting it as missing
 * would block a tool that runs fine without it.
 */
export function requiredDependencies(entryFile, declared) {
  const wanted = new Set(declared);
  const required = new Set();
  const visited = new Set();
  const queue = [path.resolve(entryFile)];

  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of specifiers(file)) {
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const target = resolveRelative(file, specifier);
        if (target) queue.push(target);
        continue;
      }
      const name = packageName(specifier);
      if (wanted.has(name)) required.add(name);
    }
  }

  return [...required].sort();
}
