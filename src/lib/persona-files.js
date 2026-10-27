import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function personaPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error("Declare a nonempty persona-relative path.");
  }
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relative);
  const within = (value) => {
    const part = path.relative(base, value);
    return part !== ".." && !part.startsWith(`..${path.sep}`) && !path.isAbsolute(part);
  };
  if (!within(target)) throw new Error("The declared path leaves this persona; correct its reference.");
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("The declared path cannot be resolved.");
    ancestor = parent;
  }
  if (!within(fs.realpathSync(ancestor))) {
    throw new Error("The declared path follows a link outside this persona; correct its reference.");
  }
  return target;
}
