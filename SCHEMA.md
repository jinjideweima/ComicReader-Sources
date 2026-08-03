# Repository Index Contract

`index.json` contains a repository `name` and a `sources` array. ComicReader
1.0 requires every remote source entry to declare:

- stable `id`, display `name`, `language`, and semantic `version`;
- relative HTTPS-resolved `scriptURL` and lowercase SHA-256;
- human-readable `publisher`, HTTPS publisher URL, license, and HTTPS source
  code URL;
- non-empty `allowedHosts` using exact hosts or `*.example.com` patterns;
- explicit `network` permission and any persistent-preference use;
- `everyone`, `teen`, `mature`, or `adult` content rating;
- optional Ed25519 signature over `id + NUL + version + NUL + sha256`.

The initial repository signs every entry. ComicReader pins the signing key of
an installed signed source across updates.

