#!/usr/bin/env node

import assert from "node:assert/strict";
import cryptoModule from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

// Match the App bridge's synchronous contract while letting curl perform the
// underlying GET transfers concurrently. JMComic batch calls share headers.
globalThis.requestAll = (requests = []) => {
  if (!requests.length) return [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jmcomic-smoke-batch-"));
  try {
    const args = [
      "--silent", "--show-error", "--location", "--compressed",
      "--parallel", "--parallel-max", "16", "--max-time", "15",
    ];
    for (const [name, value] of Object.entries(requests[0]?.headers || {})) {
      args.push("--header", `${name}: ${value}`);
    }
    const files = requests.map((request, index) => {
      const output = path.join(directory, `${index}.response`);
      args.push("--output", output, "--url", String(request.url));
      return output;
    });
    try {
      execFileSync("/usr/bin/curl", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    } catch (_) {
      // Keep successful transfer files; the source will treat missing entries
      // as failures and exercise its normal host fallback.
    }
    return files.map((file) => fs.existsSync(file)
      ? { status: 200, body: fs.readFileSync(file, "utf8"), headers: {} }
      : { status: 0, body: "", headers: {}, error: "curl transfer failed" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const instrumentedSourceCode = sourceCode.replace(
  "globalThis.__source = {",
  "globalThis.__smokeApiGet = apiGet; globalThis.__source = {",
);
vm.runInThisContext(instrumentedSourceCode, { filename: "sources/jmcomic/source.js" });
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
const rawAlbum = globalThis.__smokeApiGet(`/album?id=${details.id}`) || {};
if (Array.isArray(rawAlbum.series) && rawAlbum.series.length > 1) {
  assert.equal(details.info?.metricScope, "全系列官网聚合");
  assert.ok(Number(details.info?.views || 0) >= Number(rawAlbum.total_views || 0));
  assert.ok(Number(details.info?.comments || 0) >= Number(rawAlbum.comment_total || 0));
}
const commentModes = {};
let firstCommentShape = null;
for (const mode of ["manhua", "all", "album", "photo", "omitted"]) {
  const modeQuery = mode === "omitted" ? "" : `&mode=${mode}`;
  const page = globalThis.__smokeApiGet(`/forum?aid=${details.id}${modeQuery}&page=1`) || {};
  const firstRoot = Array.isArray(page.list) ? page.list[0] : null;
  if (!firstCommentShape && firstRoot) {
    const firstReply = Array.isArray(firstRoot.replys) ? firstRoot.replys[0] : null;
    firstCommentShape = {
      rootKeys: Object.keys(firstRoot).sort(),
      root: Object.fromEntries(Object.entries(firstRoot).filter(([key]) =>
        !["content", "replys"].includes(key) && !/token|secret|password/i.test(key)
      )),
      replyKeys: firstReply ? Object.keys(firstReply).sort() : [],
      reply: firstReply ? Object.fromEntries(Object.entries(firstReply).filter(([key]) =>
        !["content", "replys"].includes(key) && !/token|secret|password/i.test(key)
      )) : null,
    };
  }
  commentModes[mode] = {
    keys: Object.keys(page).sort(),
    total: page.total ?? null,
    firstPageRoots: Array.isArray(page.list) ? page.list.length : null,
  };
}
assert.match(details.info?.jmID || "", /^JM\d+$/);
assert.ok(Number(details.info?.contentCount || 0) >= 1, "detail content count is missing");
assert.ok(Array.isArray(details.tagGroups), "detail tag groups are missing");
assert.ok(details.tagGroups.every((group) => group.values.length > 0), "detail contains an empty tag group");
assert.ok(Array.isArray(details.relatedMangas), "related manga are missing");
assert.ok(Array.isArray(details.recommendations), "random recommendations are missing");
const interaction = source.getInteractionState(details);
assert.equal(interaction.isSupported, true);
assert.equal(interaction.canLike, true);
assert.equal(interaction.canTrack, true);
const comments = source.getComments(details);
assert.ok(Array.isArray(comments), "comments are not an array");
assert.ok(comments.every((comment) => typeof comment.isSpoiler === "boolean"), "comments lost spoiler state");
const chapters = source.getChapterList(details);
assert.ok(chapters.length >= 1, `JM${details.id} has no chapters`);
const pages = source.getPageList(chapters[0]);
const rawFirstChapter = globalThis.__smokeApiGet(`/chapter?id=${chapters[0].id}`) || {};
const rawLastChapterAlbum = globalThis.__smokeApiGet(`/album?id=${chapters.at(-1).id}`) || {};
const lastChapterComments = globalThis.__smokeApiGet(`/forum?aid=${chapters.at(-1).id}&mode=manhua&page=1`) || {};
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
  firstPage: {
    imageURL: pages[0]?.imageURL || null,
    segmentCount: pages[0]?.imageTransform?.segmentCount || 0,
  },
  rawAlbumFields: {
    keys: Object.keys(rawAlbum).sort(),
    addtime: rawAlbum.addtime ?? null,
    update_at: rawAlbum.update_at ?? null,
    total_views: rawAlbum.total_views ?? null,
    likes: rawAlbum.likes ?? null,
    comment_total: rawAlbum.comment_total ?? null,
    firstSeries: Array.isArray(rawAlbum.series) ? rawAlbum.series[0] ?? null : null,
    lastSeries: Array.isArray(rawAlbum.series) ? rawAlbum.series.at(-1) ?? null : null,
  },
  detailMetrics: {
    listedAt: details.info?.listedAt ?? null,
    updatedAt: details.info?.updatedAt ?? null,
    views: details.info?.views ?? null,
    comments: details.info?.comments ?? null,
    metricScope: details.info?.metricScope ?? null,
  },
  rawFirstChapterFields: Object.fromEntries(Object.entries(rawFirstChapter).filter(([key]) =>
    key !== "images" && !/token|secret|password/i.test(key)
  )),
  rawLastChapterAlbum: Object.fromEntries(Object.entries(rawLastChapterAlbum).filter(([key]) =>
    ["id", "series_id", "name", "addtime", "update_at", "total_views", "likes", "comment_total"].includes(key)
  )),
  commentModes,
  lastChapterCommentPage: {
    chapterID: chapters.at(-1).id,
    total: lastChapterComments.total ?? null,
    firstPageRoots: Array.isArray(lastChapterComments.list) ? lastChapterComments.list.length : null,
  },
  firstCommentShape,
  commentCount: comments.length,
  rootCommentCount: comments.filter((comment) => comment.isReply !== true).length,
  searchCount: search.items.length,
  fullListCounts,
  communityCount: communityItems.length,
  libraryKind: libraryDetails.info.contentKind,
  novelKind: novelDetails.info.contentKind,
}, null, 2));
