#!/usr/bin/env node
import fs from "node:fs";
import { resolvePersonaRoot } from "../../lib/workspace.js";
import { readApplicationWorkspace, readApplicationIndex } from "../../lib/application-workspace.js";

try {
  const [persona] = process.argv.slice(2);
  if (!persona) throw new Error("Usage: labora application inspect <persona>");
  const root = fs.existsSync(persona) ? persona : resolvePersonaRoot(persona);
  const workspace = readApplicationWorkspace(root);
  const index = workspace.layout === "native" ? null : readApplicationIndex(workspace);
  process.stdout.write(`${JSON.stringify({ ...workspace, index }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
