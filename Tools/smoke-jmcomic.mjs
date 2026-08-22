#!/usr/bin/env node

import assert from "node:assert/strict";
import cryptoModule from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";

const repositoryRoot = new URL("../", import.meta.url);
const sourceCode = fs.readFileSync(new URL("sources/jmcomic/source.js", repositoryRoot), "utf8");
const values = new Map();

Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
  md5(value) {
    return cryptoModule.createHash("md5").update(String(value)).digest("hex");
  },
  aes256ECBDecryptBase64(encoded, key) {
    const decipher = cryptoModule.createDecipheriv("aes-256-ecb", Buffer.from(key, "utf8"), null);
    decipher.setAutoPadding(true);
    return Buffer.concat([
      decipher.update(Buffer.from(encoded, "base64")),
      decipher.final(),
    ]).toString("utf8");
  },
} });

globalThis.storage = {
  get(key) { return values.get(key) ?? null; },
  set(key, value) { values.set(key, String(value)); },
  remove(key) { values.delete(key); },
};

globalThis.sleep = (milliseconds) => {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(pause, 0, 0, Math.max(0, Math.min(Number(milliseconds) || 0, 2_000)));
};

globalThis.parseHTML = (html) => ({
  text() {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
});

globalThis.fetch = (url, options = {}) => {
  const marker = "\n__COMICREADER_HTTP_STATUS__";
  const args = ["--silent", "--show-error", "--location", "--compressed", "--max-time", String(options.timeout || 15)];
  for (const [name, value] of Object.entries(options.headers || {})) {
    args.push("--header", `${name}: ${value}`);
  }
  if (String(options.method || "GET").toUpperCase() === "POST") {
    args.push("--request", "POST", "--data", String(options.body || ""));
  }
  args.push("--write-out", `${marker}%{http_code}`, String(url));
  const output = execFileSync("/usr/bin/curl", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const splitAt = output.lastIndexOf(marker);
  assert.notEqual(splitAt, -1, `curl did not return an HTTP status for ${url}`);
  return {
    status: Number(output.slice(splitAt + marker.length)),
    body: output.slice(0, splitAt),
    headers: {},
  };
};

vm.runInThisContext(sourceCode, { filename: "sources/jmcomic/source.js" });
const source = globalThis.__source;
assert.ok(source, "source.js did not register globalThis.__source");

const home = source.getHome();
assert.ok(home.heroes.length >= 1, "homepage has no serialisation heroes");
const sectionIDs = new Set(home.hotCategories.map((section) => section.id));
for (const required of [
  "jm_translation", "korean", "c108", "uncensored_color", "community",
  "library", "novels", "single", "latest",
]) {
  assert.ok(sectionIDs.has(required), `homepage is missing ${required}`);
}
assert.equal(home.hotCategories.find((section) => section.id === "community")?.items.length, 3);
assert.ok(home.hotCategories.every((section) => section.items.length <= 10));

const homepageItems = [
  ...home.heroes.map((hero) => hero.manga),
  ...home.hotCategories.flatMap((section) => section.items),
];
assert.ok(homepageItems.every((item) => {
  const url = String(item.url || "");
  return url.startsWith("/") || /^https:\/\/([^.]+\.)?18comic\.vip(?:\/|$)/i.test(url);
}), "homepage contains an off-site content link");

const fullListCounts = {};
for (const sectionID of [
  "serialization", "jm_translation", "korean", "c108", "uncensored_color", "single", "latest",
]) {
  const result = source.search(1, "", [{ key: "home_section", value: sectionID }]);
  assert.ok(result.items.length >= 1, `${sectionID} full-list route is empty`);
  fullListCounts[sectionID] = result.items.length;
}
const weeklySection = home.hotCategories.find((section) => section.id.startsWith("week:"));
if (weeklySection) {
  const result = source.search(1, "", [{ key: "home_section", value: weeklySection.id }]);
  assert.ok(result.items.length >= 1, `${weeklySection.id} full-list route is empty`);
  fullListCounts.week = result.items.length;
}

const communityItems = home.hotCategories.find((section) => section.id === "community").items;
for (const item of communityItems) {
  const communityDetails = source.getMangaDetails(item);
  assert.equal(communityDetails.info?.contentKind, "community");
  assert.equal(source.getChapterList(communityDetails).length, 0);
}

const libraryItem = home.hotCategories.find((section) => section.id === "library")?.items[0];
assert.ok(libraryItem, "library preview is empty");
const libraryDetails = source.getMangaDetails(libraryItem);
assert.equal(libraryDetails.info?.contentKind, "library");
assert.equal(source.getChapterList(libraryDetails).length, 0);

const novelItem = home.hotCategories.find((section) => section.id === "novels")?.items[0];
assert.ok(novelItem, "novel preview is empty");
const novelDetails = source.getMangaDetails(novelItem);
assert.equal(novelDetails.info?.contentKind, "novel");
assert.match(novelDetails.info?.readingNote || "", /文字内容/);
assert.equal(source.getChapterList(novelDetails).length, 0);

const first = home.heroes[0].manga;
const details = source.getMangaDetails(first);
const chapters = source.getChapterList(details);
assert.ok(chapters.length >= 1, `JM${details.id} has no chapters`);
const pages = source.getPageList(chapters[0]);
assert.ok(pages.length >= 1, `JM${details.id} has no pages`);
assert.ok(pages.every((page, index) => page.index === index && /^https:\/\//.test(page.imageURL)));
assert.ok(pages.every((page) => !page.imageTransform || page.imageTransform.segmentCount > 1));

const search = source.search(1, details.title, []);
assert.ok(Array.isArray(search.items));

console.log(JSON.stringify({
  heroCount: home.heroes.length,
  sectionCount: home.hotCategories.length,
  testedAlbum: `JM${details.id}`,
  chapterCount: chapters.length,
  pageCount: pages.length,
  transformedPageCount: pages.filter((page) => page.imageTransform).length,
  searchCount: search.items.length,
  fullListCounts,
  communityCount: communityItems.length,
  libraryKind: libraryDetails.info.contentKind,
  novelKind: novelDetails.info.contentKind,
}, null, 2));
