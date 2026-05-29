import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SITE_URL = "https://www.getfacetoemoji.com/";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("index.html has no stray markdown fences", () => {
  assert.doesNotMatch(html, /```/);
});

test("index.html declares canonical and OG URLs on production domain", () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE_URL}"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${SITE_URL}"`));
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/www\.getfacetoemoji\.com\/og-image\.webp"/,
  );
});

test("face-api.js is loaded with Subresource Integrity", () => {
  assert.match(html, /face-api\.min\.js/);
  assert.match(html, /integrity="sha384-[^"]+"/);
  assert.match(html, /crossorigin="anonymous"/);
});
