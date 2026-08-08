import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <plugin-root>/src/lib/paths.js, so the plugin root is two
// levels up from its own directory. Deriving it from import.meta.url rather than
// process.cwd() is what makes the plugin's own files reachable no matter which
// directory the caller runs from, and unreachable by anything in that directory.
export const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

// The directory the user invoked labora from: their persona workspace. Persona
// evidence, applications and generated profiles are resolved against this.
export function workspaceRoot() {
  return process.cwd();
}

const ROOT_ORDER = ["application", "persona", "plugin"];

/**
 * Label a path by the root that contains it, most specific first.
 *
 * Fingerprints are built from these labels rather than from a path relative to a
 * single root. A single root cannot describe both plugin sources and workspace
 * files: whichever one it is not makes the other resolve to `../..` traversals
 * that change whenever the workspace moves relative to the plugin, or to nothing
 * at all.
 */
export function pathLabel(target, roots = {}) {
  for (const name of ROOT_ORDER) {
    const root = roots[name];
    if (!root) continue;
    const relative = path.relative(root, target);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return `${name}:${relative.split(path.sep).join("/")}`;
    }
  }
  return `absolute:${target.split(path.sep).join("/")}`;
}
