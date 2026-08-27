#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const repositoryRoot = new URL("../", import.meta.url);
let sourceCode = fs.readFileSync(new URL("sources/jmcomic/source.js", repositoryRoot), "utf8");
sourceCode = sourceCode.replace(
  "function apiGet(path) {",
  "function apiGet(path) { if (typeof globalThis.__testAPIGet === 'function') return globalThis.__testAPIGet(path);",
);

const album = {
  id: "427413",
  name: "Search fixture",
  author: ["Fixture Author"],
  tags: ["Fixture Tag"],
  actors: ["Fixture Actor"],
};
const requestedPaths = [];
globalThis.__testAPIGet = (path) => {
  requestedPaths.push(String(path));
  if (String(path).startsWith("/album?id=")) return album;
  if (String(path).startsWith("/search?")) {
    if (String(path).includes("search_query=redirect-me")) {
      return { redirect_aid: album.id, content: [], total: 1 };
    }
    return { content: [album], total: 1 };
  }
  return {};
};
globalThis.storage = { get() { return null; }, set() {}, remove() {} };
Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
  md5() { return ""; },
  aes256ECBDecryptBase64() { return "{}"; },
} });
globalThis.fetch = () => { throw new Error("offline search test made an unexpected web request"); };
globalThis.parseHTML = () => ({ select() { return []; } });
globalThis.sleep = () => {};

vm.runInThisContext(sourceCode, { filename: "sources/jmcomic/source.js" });
const source = globalThis.__source;
assert.ok(source, "source.js did not register globalThis.__source");

for (const query of ["427413", "JM427413", "ＪＭ４２７４１３"]) {
  const requestStart = requestedPaths.length;
  const result = source.search(1, query, []);
  assert.equal(result.items.length, 1, `vehicle search failed for ${query}`);
  assert.equal(result.items[0].id, album.id);
  assert.equal(result.hasNextPage, false);
  assert.ok(
    requestedPaths.slice(requestStart).some((path) => path.startsWith("/album?id=")),
    `vehicle search did not use the direct album endpoint for ${query}`,
  );
}

const gmRequestStart = requestedPaths.length;
source.search(1, "GM427413", []);
assert.ok(
  requestedPaths.slice(gmRequestStart).every((path) => !path.startsWith("/album?id=")),
  "GM must not be treated as a JMComic vehicle prefix",
);

const redirected = source.search(1, "redirect-me", []);
assert.equal(redirected.items.length, 1);
assert.equal(redirected.items[0].id, album.id);

const expectedScopes = [
  ["0", "站内全部"],
  ["1", "作品名称"],
  ["2", "作者"],
  ["3", "分类标签"],
  ["4", "登场人物"],
];
for (const [value, title] of expectedScopes) {
  const result = source.search(1, "+fixture +keyword", [{ key: "search_type", value }]);
  assert.equal(result.items.length, 1, `${title} search returned no results`);
  assert.ok(
    requestedPaths.some((path) => path.includes(`main_tag=${value}`)
      && path.includes("search_query=%2Bfixture%20%2Bkeyword")),
    `${title} search did not preserve its official main_tag or multi-keyword query`,
  );
}

const filters = source.getFilterList();
assert.deepEqual(
  filters.find((filter) => filter.key === "search_type")?.values,
  expectedScopes.map(([, title]) => title),
);
assert.equal(filters.find((filter) => filter.key === "category")?.scope, "all");
assert.ok(filters.some((filter) => filter.key === "sub_category"));

console.log("JMComic search tests passed");
