import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("app.js parses without syntax errors", () => {
  const appPath = join(rootDir, "app.js");
  const source = readFileSync(appPath, "utf8");

  assert.doesNotThrow(() => {
    // Avoid spawning node (breaks on Windows paths with spaces); compile-only check.
    new vm.Script(source, { filename: appPath });
  });
});
