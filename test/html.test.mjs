import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SITE_URL = "https://www.getfacetoemoji.com/";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../app.js", import.meta.url), "utf8");

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

test("index.html preconnects to face-api CDN and model host", () => {
  assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/);
  assert.match(
    html,
    /<link rel="preconnect" href="https:\/\/justadudewhohacks\.github\.io"/,
  );
});

test("index.html exposes favicon and defers heavy scripts", () => {
  assert.match(html, /<link rel="icon" href="\.\/favicon\.svg"/);
  assert.doesNotMatch(html, /face-api\.min\.js/);
  assert.doesNotMatch(html, /_vercel\/insights\/script\.js/);
});

test("app.js lazy-loads face-api with Subresource Integrity", () => {
  assert.match(appJs, /FACE_API_SCRIPT_URL/);
  assert.match(appJs, /FACE_API_SCRIPT_INTEGRITY/);
  assert.match(appJs, /loadFaceApiScript/);
  assert.match(
    appJs,
    /sha384-gzn2n\+\+arkvyhdNLmUf1s6F5NZ8iAbZ7FhIt\+Zw7Jlf1n\/vNTmZ3\+cYr7S4ogyco=/,
  );
});
test("index.html targets face to emoji keywords in title and hero", () => {
  assert.match(html, /<title>Face to Emoji/i);
  assert.match(html, /name="description"[^>]*face to emoji/i);
  assert.match(html, /<h1>Face to Emoji/i);
  assert.match(html, /getfacetoemoji\.com/i);
});

test("index.html includes structured data for WebApplication and FAQ", () => {
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":\s*"WebApplication"/);
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /What is face to emoji\?/);
});

