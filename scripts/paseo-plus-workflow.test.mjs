import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/paseo-plus-macos.yml", "utf8");
for (const text of [
  'branches: ["build/paseo-plus"]',
  "contents: read",
  "runs-on: macos-14",
  "repository: cleiter/desvio",
  "ref: 9b41261f55e50317060401a3a0c3e2c23d4af563",
  "node scripts/paseo-plus-release-id.mjs",
  'PASEO_PRODUCT_NAME="Paseo Plus"',
  "CSC_IDENTITY_AUTO_DISCOVERY=false",
  "codesign --verify --deep --strict",
  "retention-days: 14",
]) {
  assert.ok(workflow.includes(text), `missing workflow contract: ${text}`);
}
assert.ok(!workflow.includes("secrets."), "Paseo Plus workflow must not read repository secrets");
assert.ok(!workflow.includes("release create"), "Paseo Plus workflow must not create a release");
