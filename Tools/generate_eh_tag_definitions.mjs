#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const namespaces = [
  "artist", "character", "cosplayer", "female", "group", "language",
  "location", "male", "mixed", "other", "parody", "reclass",
];
const sourceRoot = "https://raw.githubusercontent.com/EhTagTranslation/Database/master";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const output = resolve(scriptDirectory, "../sources/ehentai/resources/tag-definitions.zh-CN.json");

function splitMarkdownRow(row) {
  let content = row.trim();
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|")) content = content.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      current += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function cleanDescription(markdown) {
  return decodeEntities(markdown)
    .replace(/!\[[^\]]*\]\((?:#+\s+)?(?:"[^"]+"|[^)]+)\)/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "ComicReader definition generator" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const version = Number.parseInt((await loadText(`${sourceRoot}/version`)).trim(), 10) || 0;
const definitions = {};
for (const namespace of namespaces) {
  const markdown = await loadText(`${sourceRoot}/database/${namespace}.md`);
  const entries = {};
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = splitMarkdownRow(line);
    const key = (cells[0] ?? "").trim().toLowerCase();
    if (!key || key === "原始标签" || /^-+$/.test(key)) continue;
    const description = cleanDescription(cells[2] ?? "");
    if (description) entries[key] = description;
  }
  if (Object.keys(entries).length > 0) definitions[namespace] = entries;
}

const database = {
  version,
  source: "https://github.com/EhTagTranslation/Database",
  license: "CC BY-NC-SA 3.0 CN; individual definitions may retain upstream notices",
  definitions,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(database));

const entryCount = Object.values(definitions).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
process.stdout.write(`Wrote ${entryCount} definitions (version ${version}) to ${output}\n`);
