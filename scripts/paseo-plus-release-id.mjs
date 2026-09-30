import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const core = /^(\d+\.\d+\.\d+)/.exec(pkg.version)?.[1];
if (!core) throw new Error(`unsupported package version: ${pkg.version}`);

const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const epoch = Number(git("show", "-s", "--format=%ct", "HEAD"));
if (!Number.isSafeInteger(epoch)) throw new Error("Git returned an invalid commit time");
const date = new Date(epoch * 1000).toISOString().slice(0, 10).replaceAll("-", "");
const sha = git("rev-parse", "--short=9", "HEAD");
process.stdout.write(`${core}-plus.${date}-${sha}\n`);
