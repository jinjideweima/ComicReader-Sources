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
const requestedURLs = [];

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
  html() { return String(html); },
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
  requestedURLs.push(String(url));
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
  requestedURLs.push(...requests.map((request) => String(request.url)));
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
  "globalThis.__smokeApiGet = apiGet; globalThis.__smokeInteractionCache = interactionCache; globalThis.__source = {",
);
vm.runInThisContext(instrumentedSourceCode, { filename: "sources/jmcomic/source.js" });
const source = globalThis.__source;
assert.ok(source, "source.js did not register globalThis.__source");

const timings = {};
function timed(label, operation) {
  const started = performance.now();
  const result = operation();
  timings[label] = Math.round(performance.now() - started);
  return result;
}

const home = timed("homeMs", () => source.getHome());
assert.ok(home.heroes.length >= 1, "homepage has no serialisation heroes");
const sectionIDs = new Set(home.hotCategories.map((section) => section.id));
for (const required of [
  "jm_translation", "korean", "c108", "uncensored_color",
  "community:dinner", "community:raiders", "community:sexytalk",
  "library", "novels", "single", "latest",
]) {
  assert.ok(sectionIDs.has(required), `homepage is missing ${required}`);
}
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

const editorialSections = home.hotCategories.filter((section) => section.id.startsWith("community:"));
assert.equal(editorialSections.length, 3, "homepage did not expose all editorial tabs");
assert.ok(editorialSections.every((section) => section.items.length >= 1), "an editorial tab is empty");
for (const section of editorialSections) {
  for (const item of section.items) {
    assert.equal(item.info?.contentKind, "article");
    assert.equal(source.getChapterList(item).length, 0);
  }
}
const articleItem = editorialSections[0].items[0];
const articleDetails = source.getMangaDetails(articleItem);
assert.equal(articleDetails.info?.contentKind, "article");
assert.ok(Array.isArray(articleDetails.articleBlocks) && articleDetails.articleBlocks.length >= 1,
  "article body blocks are missing");
assert.ok(articleDetails.articleBlocks.some((block) => block.kind === "image" && /^https:\/\//.test(block.url || "")),
  "article body images are missing");
const rawArticlePayload = globalThis.__smokeApiGet(`/blog?id=${String(articleItem.id).replace(/\D/g, "")}`) || {};
const raidersItem = editorialSections.find((section) => section.id === "community:raiders")?.items[0];
assert.ok(raidersItem, "game-library preview is empty");
const raidersDetails = source.getMangaDetails(raidersItem);
const raidersExternalLinks = (raidersDetails.articleBlocks || []).filter((block) =>
  block.kind === "link" && /^https?:\/\//i.test(block.url || "")
    && !/https?:\/\/([^.]+\.)?18comic\.vip(?:\/|$)/i.test(block.url || "")
);
assert.ok(raidersExternalLinks.length >= 1, "game-library external launch links are missing");

const libraryItem = home.hotCategories.find((section) => section.id === "library")?.items[0];
assert.ok(libraryItem, "library preview is empty");
assert.match(libraryItem.coverURL || "", /^https:\/\/cdn-msp[^/]*\.18comic\.vip\/media\/library\//);
const libraryDetails = source.getMangaDetails(libraryItem);
assert.equal(libraryDetails.info?.contentKind, "library");
assert.equal(source.getChapterList(libraryDetails).length, 0);
assert.ok((libraryDetails.articleBlocks || []).some((block) => block.kind === "image" && /^https:\/\//.test(block.url || "")),
  "library body images are missing");
const rawLibraryPayload = globalThis.__smokeApiGet("/creator_work?page=1&search_value=&lang=&source=") || {};
const rawLibraryItem = (rawLibraryPayload.data?.content || rawLibraryPayload.content || [])[0] || {};
const rawLibraryDetail = globalThis.__smokeApiGet(`/creator_work_info_detail?id=${rawLibraryItem.id}`) || {};

const novelItem = home.hotCategories.find((section) => section.id === "novels")?.items[0];
assert.ok(novelItem, "novel preview is empty");
const novelDetails = source.getMangaDetails(novelItem);
assert.equal(novelDetails.info?.contentKind, "novel");
assert.match(novelDetails.info?.readingNote || "", /文字内容/);
assert.equal(source.getChapterList(novelDetails).length, 0);

const first = home.heroes[0].manga;
const detailRequestOffset = requestedURLs.length;
const details = timed("detailMs", () => source.getMangaDetails(first));
const detailRequests = requestedURLs.slice(detailRequestOffset);
assert.deepEqual(
  [...new Set(detailRequests.map((url) => url.match(/\/album\?id=([^&]+)/)?.[1]).filter(Boolean))],
  [String(first.id)],
  "comic detail fetched albums outside the current work",
);
assert.equal(detailRequests.filter((url) => /random_recommend|\/album\/\d+/.test(url)).length, 0,
  "optional recommendations blocked the core detail path");
const rawAlbum = globalThis.__smokeApiGet(`/album?id=${details.id}`) || {};
if (Array.isArray(rawAlbum.series) && rawAlbum.series.length > 1) {
  assert.equal(details.info?.metricScope, "当前作品");
  assert.equal(Number(details.info?.views || 0), Number(rawAlbum.total_views || 0));
  assert.equal(Number(details.info?.comments || 0), Number(rawAlbum.comment_total || 0));
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
assert.equal(interaction.canLike, !interaction.isLiked);
assert.equal(interaction.canTrack, true);

// JM's official like endpoint is one-way. A caller asking to unlike an
// already-liked album must not issue a write or report a fake synchronized
// state.
globalThis.__smokeInteractionCache[String(details.id)] = {
  ...interaction,
  isSupported: true,
  canLike: false,
  isLiked: true,
};
let unlikeWriteCount = 0;
const fetchBeforeUnlike = globalThis.fetch;
try {
  globalThis.fetch = () => {
    unlikeWriteCount += 1;
    throw new Error("unlike must not perform a network write");
  };
  const unlike = source.setLiked(details, false);
  assert.equal(unlike.isSupported, false);
  assert.equal(unlike.canLike, false);
  assert.equal(unlike.isLiked, true);
  assert.match(unlike.message || "", /单向操作/);
} finally {
  globalThis.fetch = fetchBeforeUnlike;
}
assert.equal(unlikeWriteCount, 0);

const liveFetch = globalThis.fetch;
const commentRequests = [];
try {
  globalThis.fetch = (url, options = {}) => {
    commentRequests.push({ url: String(url), options });
    return { status: 200, body: JSON.stringify({ err: false, cid: String(9000 + commentRequests.length) }), headers: {} };
  };
  const rootSubmit = source.submitCommentAdvanced(details, "Smoke root comment", true, null);
  const replySubmit = source.submitCommentAdvanced(details, "Smoke reply", false, "12345");
  assert.equal(rootSubmit.didSubmit, true);
  assert.equal(replySubmit.didSubmit, true);
} finally {
  globalThis.fetch = liveFetch;
}
assert.equal(commentRequests.length, 2);
assert.equal(commentRequests[0].url, "https://18comic.vip/ajax/album_comment");
const rootCommentFields = Object.fromEntries(new URLSearchParams(commentRequests[0].options.body));
assert.deepEqual(rootCommentFields, {
  comment: "Smoke root comment",
  originator: "",
  status: "true",
  video_id: String(details.id),
});
const replyCommentFields = Object.fromEntries(new URLSearchParams(commentRequests[1].options.body));
assert.deepEqual(replyCommentFields, {
  comment: "Smoke reply",
  comment_id: "12345",
  forum_subject: "1",
  is_reply: "1",
  originator: "",
  video_id: String(details.id),
});
const firstCommentPage = source.getCommentsPage(details, 1);
assert.ok(Array.isArray(firstCommentPage.comments), "first comment page is not an array");
assert.ok(firstCommentPage.comments.length <= 30, "first comment page is unbounded");
const comments = firstCommentPage.comments;
assert.ok(Array.isArray(comments), "comments are not an array");
assert.ok(comments.every((comment) => typeof comment.isSpoiler === "boolean"), "comments lost spoiler state");
const secondCommentPage = firstCommentPage.hasNextPage
  ? source.getCommentsPage(details, 2)
  : { comments: [], hasNextPage: false };
assert.ok(Array.isArray(secondCommentPage.comments), "second comment page is not an array");
assert.ok(secondCommentPage.comments.length <= 30, "second comment page is unbounded");
assert.equal(
  new Set([...comments, ...secondCommentPage.comments].map((comment) => comment.id)).size,
  comments.length + secondCommentPage.comments.length,
  "incremental comment pages contain duplicate comments"
);
const chapterRequestOffset = requestedURLs.length;
const chapters = timed("chapterListMs", () => source.getChapterList(details));
assert.equal(requestedURLs.slice(chapterRequestOffset).filter((url) => /\/album\?id=/.test(url)).length, 0,
  "chapter list repeated the album detail request");
assert.ok(chapters.length >= 1, `JM${details.id} has no chapters`);
const pageRequestOffset = requestedURLs.length;
const pages = timed("pageListMs", () => source.getPageList(chapters[0]));
assert.equal(requestedURLs.slice(pageRequestOffset).filter((url) => /chapter_view_template/.test(url)).length, 0,
  "reader waited for the redundant chapter HTML template");
const rawFirstChapter = globalThis.__smokeApiGet(`/chapter?id=${chapters[0].id}`) || {};
const rawLastChapterAlbum = globalThis.__smokeApiGet(`/album?id=${chapters.at(-1).id}`) || {};
const lastChapterComments = globalThis.__smokeApiGet(`/forum?aid=${chapters.at(-1).id}&mode=manhua&page=1`) || {};
assert.ok(pages.length >= 1, `JM${details.id} has no pages`);
assert.ok(pages.every((page, index) => page.index === index && /^https:\/\//.test(page.imageURL)));
assert.ok(pages.every((page) => !page.imageTransform || page.imageTransform.segmentCount > 1));

const search = source.search(1, details.title, []);
assert.ok(Array.isArray(search.items));

console.log(JSON.stringify({
  timings,
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
    tags: rawAlbum.tags ?? null,
    works: rawAlbum.works ?? null,
    actors: rawAlbum.actors ?? null,
    author: rawAlbum.author ?? null,
  },
  detailMetrics: {
    listedAt: details.info?.listedAt ?? null,
    updatedAt: details.info?.updatedAt ?? null,
    views: details.info?.views ?? null,
    comments: details.info?.comments ?? null,
    metricScope: details.info?.metricScope ?? null,
    tagGroups: details.tagGroups ?? null,
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
  secondCommentCount: secondCommentPage.comments.length,
  rootCommentCount: comments.filter((comment) => comment.isReply !== true).length,
  searchCount: search.items.length,
  fullListCounts,
  communityCount: editorialSections.reduce((count, section) => count + section.items.length, 0),
  gameLibraryExternalLinkCount: raidersExternalLinks.length,
  gameLibraryAuthorAvatar: raidersDetails.info?.authorAvatarURL || null,
  rawArticleInfo: Object.fromEntries(Object.entries(rawArticlePayload.info || {}).filter(([key]) =>
    key !== "content" && !/token|secret|password/i.test(key)
  )),
  libraryKind: libraryDetails.info.contentKind,
  rawLibraryItem: Object.fromEntries(Object.entries(rawLibraryItem).filter(([key]) =>
    !/token|secret|password/i.test(key)
  )),
  rawLibraryDetail: Object.fromEntries(Object.entries(rawLibraryDetail.data || rawLibraryDetail).filter(([key]) =>
    key !== "content" && key !== "images" && !/token|secret|password/i.test(key)
  )),
  novelKind: novelDetails.info.contentKind,
}, null, 2));
