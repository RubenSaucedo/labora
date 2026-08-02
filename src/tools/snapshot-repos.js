#!/usr/bin/env node
// Snapshot GitHub repository facts into the persona evidence corpus.
//
// Repository facts are a stronger evidence tier than a scanned document: they
// are machine-retrievable, so a later run can re-fetch and diff them. This tool
// records only what the GitHub API reports. It never infers impact, never
// summarises achievements, and never writes to profile/generated/.
//
// Visibility is recorded per repository because it decides what a reader can
// verify: a public repository is self-verifying evidence, a private one is
// self-reported and must be treated as such downstream.
//
// Usage:
//   node src/tools/snapshot-repos.js --persona <name> [--owner <login>]
//                                    [--include-forks] [--since <YYYY-MM-DD>]

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { personaRootPath } from "../lib/storage.js";

function parseArgs(argv) {
  const args = { includeForks: false, since: "", verifyUrls: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--persona") args.persona = argv[++i];
    else if (flag === "--owner") args.owner = argv[++i];
    else if (flag === "--since") args.since = argv[++i];
    else if (flag === "--include-forks") args.includeForks = true;
    else if (flag === "--verify-urls") args.verifyUrls = true;
    else if (flag === "--date") args.date = argv[++i];
  }
  return args;
}

// A reachable product URL is the strongest evidence a repository can carry: it
// shows the work actually ships, and any reader can open it -- even when the
// source stays private. Recorded as a point-in-time observation, never as a
// standing guarantee.
async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    return { status: response.status, finalUrl: response.url || url };
  } catch {
    return { status: 0, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function gh(endpoint, jqFilter) {
  const argv = ["api", endpoint];
  if (jqFilter) argv.push("--jq", jqFilter);
  return execFileSync("gh", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function ghJson(endpoint) {
  const raw = execFileSync("gh", ["api", endpoint], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(raw);
}

function safeJson(endpoint, fallback) {
  try {
    return ghJson(endpoint);
  } catch {
    return fallback;
  }
}

// README text is untrusted input: it is stored as inert prose, never executed
// and never treated as instructions. Strip markup that could read as directives
// and keep a short factual excerpt.
function readmeExcerpt(owner, repo) {
  const payload = safeJson(`repos/${owner}/${repo}/readme`, null);
  if (!payload?.content) return "";
  let text;
  try {
    text = Buffer.from(payload.content, "base64").toString("utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const prose = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (prose.length) break;
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("```")) break;
    if (/^\[!\[/.test(trimmed) || /^!\[/.test(trimmed)) continue;
    prose.push(trimmed.replace(/^>\s*/, ""));
    if (prose.join(" ").length > 320) break;
  }
  return prose
    .join(" ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 320)
    .trim();
}

function collectRepos(owner, { includeForks, since, authenticatedUser }) {
  // `/user/repos` is the only listing that returns private repositories, and it
  // exists only for the authenticated account. Fall back to the public listing
  // when snapshotting somebody else.
  const endpoint = authenticatedUser && owner.toLowerCase() === authenticatedUser.toLowerCase()
    ? "user/repos?per_page=100&affiliation=owner&sort=pushed"
    : `users/${owner}/repos?per_page=100&type=owner&sort=pushed`;
  const listed = ghJson(endpoint);
  const repos = [];
  for (const repo of listed) {
    if (repo.fork && !includeForks) continue;
    if (since && repo.pushed_at < since) continue;

    const languages = safeJson(`repos/${owner}/${repo.name}/languages`, {});
    const contributors = safeJson(
      `repos/${owner}/${repo.name}/contributors?per_page=100`,
      []
    );
    const own = Array.isArray(contributors)
      ? contributors.find((entry) => entry?.login?.toLowerCase() === owner.toLowerCase())
      : null;

    repos.push({
      name: repo.name,
      visibility: repo.private ? "private" : "public",
      isFork: Boolean(repo.fork),
      description: repo.description || "",
      homepage: repo.homepage || "",
      license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
        ? repo.license.spdx_id
        : "",
      topics: Array.isArray(repo.topics) ? [...repo.topics].sort() : [],
      languages: Object.entries(languages)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([language]) => language),
      defaultBranchCommitsByOwner: own?.contributions ?? 0,
      createdAt: (repo.created_at || "").slice(0, 10),
      lastPushedAt: (repo.pushed_at || "").slice(0, 10),
      readmeExcerpt: readmeExcerpt(owner, repo.name),
    });
  }
  repos.sort(
    (a, b) => b.lastPushedAt.localeCompare(a.lastPushedAt) || a.name.localeCompare(b.name)
  );
  return repos;
}

function renderMarkdown(owner, repos, retrievedAt) {
  const lines = [
    "# Repository Evidence",
    "",
    `Owner: ${owner}`,
    `Retrieved: ${retrievedAt}`,
    "",
    "Every fact below is reported by the GitHub API and can be re-fetched with",
    "`node src/tools/snapshot-repos.js`. Commit counts are commits attributed to",
    "the owner on each repository's default branch; they measure sustained",
    "activity, not impact. A public repository is verifiable by any reader; a",
    "private one is self-reported and must be presented as such.",
    "",
  ];
  for (const repo of repos) {
    lines.push(`## ${repo.name}`);
    lines.push(`Visibility: ${repo.visibility}`);
    if (repo.description) lines.push(`Description: ${repo.description}`);
    if (repo.languages.length) lines.push(`Languages: ${repo.languages.join(", ")}`);
    lines.push(
      `Commits attributed to ${owner} on the default branch: ${repo.defaultBranchCommitsByOwner}`
    );
    lines.push(`Created: ${repo.createdAt}`);
    lines.push(`Last pushed: ${repo.lastPushedAt}`);
    if (repo.license) lines.push(`License: ${repo.license}`);
    if (repo.homepage) lines.push(`Homepage: ${repo.homepage}`);
    if (repo.homepageCheck) {
      lines.push(
        repo.homepageCheck.status
          ? `Homepage reachable: HTTP ${repo.homepageCheck.status} on ${repo.homepageCheck.checkedAt}`
          : `Homepage reachable: no response on ${repo.homepageCheck.checkedAt}`
      );
    }
    if (repo.topics.length) lines.push(`Topics: ${repo.topics.join(", ")}`);
    if (repo.readmeExcerpt) lines.push(`README excerpt: ${repo.readmeExcerpt}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.persona) {
    process.stderr.write(
      "Usage: node src/tools/snapshot-repos.js --persona <name> [--owner <login>] [--include-forks] [--since YYYY-MM-DD] [--verify-urls]\n"
    );
    process.exit(1);
  }

  const authenticatedUser = gh("user", ".login").trim();
  const owner = args.owner || authenticatedUser;
  const retrievedAt = args.date || new Date().toISOString().slice(0, 10);
  const repos = collectRepos(owner, { ...args, authenticatedUser });

  return { args, owner, retrievedAt, repos };
}

async function run() {
  const { args, owner, retrievedAt, repos } = main();

  if (args.verifyUrls) {
    for (const repo of repos) {
      if (!repo.homepage) continue;
      const result = await checkUrl(repo.homepage);
      repo.homepageCheck = { ...result, checkedAt: retrievedAt };
    }
  }

  const outputDir = path.join(
    personaRootPath(args.persona),
    "evidence",
    "repositories",
    retrievedAt
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const record = { schemaVersion: "1.0", owner, retrievedAt, repositories: repos };
  fs.writeFileSync(
    path.join(outputDir, "repositories.json"),
    `${JSON.stringify(record, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(outputDir, "repositories.md"),
    renderMarkdown(owner, repos, retrievedAt)
  );

  const publicCount = repos.filter((repo) => repo.visibility === "public").length;
  process.stdout.write(
    `${repos.length} repositories (${publicCount} public, ${repos.length - publicCount} private) -> ${outputDir}\n`
  );
}

run();
