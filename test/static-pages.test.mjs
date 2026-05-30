import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const faqHtml = readFileSync(new URL("../faq/index.html", import.meta.url), "utf8");
const howHtml = readFileSync(
  new URL("../how-it-works/index.html", import.meta.url),
  "utf8",
);
const sitemap = readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");

test("index.html footer links to FAQ and How it works", () => {
  assert.match(indexHtml, /class="site-footer"/);
  assert.match(indexHtml, /href="\/faq\/"/);
  assert.match(indexHtml, /href="\/how-it-works\/"/);
});

test("faq page exists with FAQ content and footer", () => {
  assert.match(faqHtml, /<h1>Frequently asked questions<\/h1>/);
  assert.match(faqHtml, /"@type":\s*"FAQPage"/);
  assert.match(faqHtml, /href="\/how-it-works\/"/);
  assert.match(faqHtml, /rel="canonical" href="https:\/\/www\.getfacetoemoji\.com\/faq\/"/);
});

test("how-it-works page exists with steps and HowTo schema", () => {
  assert.match(howHtml, /How to convert face to emoji/);
  assert.match(howHtml, /"@type":\s*"HowTo"/);
  assert.match(howHtml, /href="\/faq\/"/);
  assert.match(
    howHtml,
    /rel="canonical" href="https:\/\/www\.getfacetoemoji\.com\/how-it-works\/"/,
  );
});

test("sitemap lists home, faq, and how-it-works URLs", () => {
  assert.match(sitemap, /<loc>https:\/\/www\.getfacetoemoji\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.getfacetoemoji\.com\/faq\/<\/loc>/);
  assert.match(
    sitemap,
    /<loc>https:\/\/www\.getfacetoemoji\.com\/how-it-works\/<\/loc>/,
  );
});
