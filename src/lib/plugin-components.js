import fs from "node:fs";
import path from "node:path";

function pluginManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function pluginComponentDirectories(pluginRoot, field, fallback) {
  const configured = pluginManifest(pluginRoot)[field] ?? fallback;
  const entries = Array.isArray(configured) ? configured : [configured];

  return entries.map((entry) => {
    const directory = path.resolve(pluginRoot, entry);
    const relative = path.relative(pluginRoot, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Plugin ${field} directory must stay inside the plugin root: ${entry}`);
    }
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`Plugin ${field} directory does not exist: ${entry}`);
    }
    return directory;
  });
}

export function pluginAgentFiles(pluginRoot) {
  return pluginComponentDirectories(pluginRoot, "agents", "agents/")
    .flatMap((directory) =>
      fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
        .map((entry) => path.join(directory, entry.name))
    )
    .sort();
}

export function pluginAgentLogicalPath(file) {
  return `agents/${path.basename(file)}`;
}

export function pluginAgentPromptLabel(file) {
  return path.join("agents", path.basename(file));
}

export function pluginAgentPath(pluginRoot, name) {
  const filename = `${name}.agent.md`;
  const matches = pluginAgentFiles(pluginRoot).filter(
    (file) => path.basename(file) === filename
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one plugin agent named "${name}", found ${matches.length}.`
    );
  }
  return matches[0];
}
