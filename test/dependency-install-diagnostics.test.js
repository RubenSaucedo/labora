import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyNpmFailure,
  sanitizeNpmOutput,
  sanitizeRegistryUrl,
} from "../src/lib/dependency-install-diagnostics.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeDispatcherFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-dispatcher-"));
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "tools"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "bin", "labora"), path.join(root, "bin", "labora"));
  for (const name of ["tool-dependencies.js", "dependency-install-diagnostics.js"]) {
    fs.copyFileSync(
      path.join(repoRoot, "src", "lib", name),
      path.join(root, "src", "lib", name),
    );
  }
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "labora-test-fixture",
      version: "0.0.0",
      type: "module",
      dependencies: { zod: "^4.0.0" },
    }),
  );
  fs.writeFileSync(path.join(root, "src", "tools", "free.js"), 'process.stdout.write("free\\n");\n');
  fs.writeFileSync(
    path.join(root, "src", "tools", "gated.js"),
    'import { z } from "zod";\nvoid z;\n',
  );
  return root;
}

function makeFakeNpm() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labora-npm-"));
  const script = path.join(root, "npm-script.js");
  fs.writeFileSync(
    script,
    [
      'const args = process.argv.slice(2).join(" ");',
      'const mode = process.env.FAKE_NPM_MODE || "healthy";',
      'if (args === "--version") { process.stdout.write("10.9.0\\n"); process.exit(0); }',
      'if (args === "config get registry") {',
      '  process.stdout.write("https://" + "person" + ":" + "placeholder" + "@registry.example.test/private?token=abc#fragment\\n");',
      '  process.exit(0);',
      '}',
      'if (args === "view zod version --json") {',
      '  if (mode === "healthy") { process.stdout.write("{}\\n"); process.exit(0); }',
      '  process.stderr.write("npm ERR! code E401\\nnpm ERR! 401 Unauthorized\\n");',
      '  process.exit(1);',
      '}',
      'if (mode === "auth") {',
      '  process.stderr.write("npm ERR! code E401\\nnpm ERR! 401 Unauthorized\\n");',
      '  process.exit(1);',
      '}',
      'process.stderr.write("npm ERR! code EBOGUS\\nnpm ERR! original diagnostic stays visible\\n");',
      'process.exit(7);',
      "",
    ].join("\n"),
  );

  const unix = path.join(root, "npm");
  fs.writeFileSync(
    unix,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(root, "npm.cmd"),
    `@"${process.execPath}" "${script}" %*\r\n`,
  );
  return root;
}

function runFixture(root, args, env = {}) {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.toLowerCase() === "path") delete childEnv[key];
  }
  return spawnSync(process.execPath, [path.join(root, "bin", "labora"), ...args], {
    encoding: "utf8",
    env: { ...childEnv, ...env },
  });
}

test("registry diagnostics redact credentials and request-specific data", () => {
  const credentialedRegistry =
    "https://" + "person" + ":" + "placeholder" +
    "@registry.example.test/private?token=abc#fragment";
  assert.equal(
    sanitizeRegistryUrl(credentialedRegistry),
    "https://registry.example.test/private",
  );
  assert.equal(
    sanitizeNpmOutput(`request ${credentialedRegistry} token=plain`),
    "request https://registry.example.test/private token=[redacted]",
  );
});

test("npm failures have distinct repair routes", () => {
  assert.equal(classifyNpmFailure({ error: { code: "ENOENT" } }).kind, "npm_missing");
  assert.equal(classifyNpmFailure({ stderr: "npm ERR! code E401" }).kind, "registry_authentication");
  assert.equal(classifyNpmFailure({ stderr: "npm ERR! code E403" }).kind, "registry_forbidden");
  assert.equal(
    classifyNpmFailure({ stderr: "npm ERR! code E404" }).kind,
    "registry_package_unavailable",
  );
  assert.equal(classifyNpmFailure({ stderr: "npm ERR! code ETIMEDOUT" }).kind, "registry_unreachable");
  assert.equal(classifyNpmFailure({ stderr: "npm ERR! code EBOGUS" }).kind, "unknown");
});

test("a dependency-backed tool refuses only its own stage", () => {
  const root = makeDispatcherFixture();
  try {
    const result = runFixture(root, ["gated"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /degraded advisory mode/);
    assert.match(result.stderr, /agents,\s*\n?skills, and dependency-free tools remain available/);
    assert.match(result.stderr, /labora doctor/);
    assert.match(result.stderr, /Do not approximate/);

    const free = runFixture(root, ["free"]);
    assert.equal(free.status, 0);
    assert.equal(free.stdout, "free\n");

    const announce = runFixture(root, ["announce"]);
    assert.equal(announce.status, 0);
    const context = JSON.parse(announce.stdout).additionalContext;
    assert.match(context, /agents and skills remain available/);
    assert.match(context, /Stop only the stage/);
    assert.match(context, /doctor/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "doctor recommends setup only when npm and the registry are healthy",
  { skip: process.platform === "win32" },
  () => {
    const root = makeDispatcherFixture();
    const fakeNpm = makeFakeNpm();
    try {
      const healthy = runFixture(root, ["doctor"], {
        PATH: fakeNpm,
        FAKE_NPM_MODE: "healthy",
      });
      assert.equal(healthy.status, 1);
      assert.match(
        healthy.stdout,
        /registry\s+https:\/\/registry\.example\.test\/private \(reachable\)/,
      );
      assert.match(healthy.stdout, /Run "labora setup"/);
      assert.doesNotMatch(healthy.stdout, /person|placeholder|token=abc|fragment/);

      const blocked = runFixture(root, ["doctor"], {
        PATH: fakeNpm,
        FAKE_NPM_MODE: "auth",
      });
      assert.equal(blocked.status, 1);
      assert.match(blocked.stdout, /rejected authentication/);
      assert.doesNotMatch(blocked.stdout, /Run "labora setup"/);
      assert.doesNotMatch(blocked.stdout, /person|placeholder|token=abc|fragment/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(fakeNpm, { recursive: true, force: true });
    }
  },
);

test("setup preserves unknown npm output instead of guessing", { skip: process.platform === "win32" }, () => {
  const root = makeDispatcherFixture();
  const fakeNpm = makeFakeNpm();
  try {
    const result = runFixture(root, ["setup"], {
      PATH: fakeNpm,
      FAKE_NPM_MODE: "unknown",
    });
    assert.equal(result.status, 7);
    assert.match(result.stderr, /original diagnostic stays visible/);
    assert.match(result.stderr, /failed for an unrecognized reason/);
    assert.match(result.stderr, /did not guess at a workaround or try another registry/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeNpm, { recursive: true, force: true });
  }
});

test("setup diagnoses authentication without exposing registry credentials", {
  skip: process.platform === "win32",
}, () => {
  const root = makeDispatcherFixture();
  const fakeNpm = makeFakeNpm();
  try {
    const result = runFixture(root, ["setup"], {
      PATH: fakeNpm,
      FAKE_NPM_MODE: "auth",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rejected authentication/);
    assert.match(result.stderr, /https:\/\/registry\.example\.test\/private/);
    assert.doesNotMatch(result.stderr, /person|placeholder|token=abc|fragment/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeNpm, { recursive: true, force: true });
  }
});

test("doctor can invoke npm from a standard Windows Node installation", {
  skip: process.platform !== "win32" ||
    !fs.existsSync(path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")),
}, () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "labora"), "doctor"], {
    encoding: "utf8",
  });
  assert.match(result.stdout, /npm\s+\d+\./);
  assert.doesNotMatch(result.stdout, /npm\s+unavailable/);
});
