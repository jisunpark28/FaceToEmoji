import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("app.js parses without syntax errors", () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", "app.js"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "pipe",
    });
  });
});
