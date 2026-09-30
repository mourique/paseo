import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve("scripts/paseo-plus-release-id.mjs");
const repo = mkdtempSync(path.join(tmpdir(), "paseo-plus-release-id-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

try {
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  writeFileSync(path.join(repo, "package.json"), '{"version":"0.10.0-beta.2"}\n');
  git("add", "package.json");
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-09-30T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-30T12:00:00Z",
    },
  });
  const sha = git("rev-parse", "--short=9", "HEAD");
  const value = execFileSync(process.execPath, [script, repo], { encoding: "utf8" }).trim();
  assert.equal(value, `0.10.0-plus.20260930-${sha}`);

  writeFileSync(path.join(repo, "package.json"), '{"version":"wrong"}\n');
  assert.throws(
    () => execFileSync(process.execPath, [script, repo], { stdio: "pipe" }),
    /unsupported package version: wrong/,
  );
} finally {
  rmSync(repo, { recursive: true, force: true });
}
