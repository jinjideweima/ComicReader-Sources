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
- optional declarative `authentication` configuration. Account-capable sources
  must request `accountAuthentication` and, when applicable, `accountCookies`;
  a web login may separately sign `webLoginHosts` for verification-page
  navigation and `persistentWebLogin` for a publisher-isolated WebKit store;
- optional `resources` entries with a safe `id`, repository-relative `url`,
  SHA-256, resource-specific license, and optional attribution notice;
- Ed25519 v2 signature over deterministic sorted-key JSON of the complete
  manifest (excluding the signature itself), prefixed with
  `ComicReader.SourceManifest.ed25519-v2 + NUL`.

The repository signs every entry. ComicReader pins the signing key of an
installed source across updates. Tokens and cookies are owned by the native app,
stored in a per-source ThisDeviceOnly Keychain record, and never exposed to the
source JavaScript storage bridge.

Resources are downloaded only from the same repository origin as `index.json`,
verified before installation, treated as non-executable data, and never exposed
through the JavaScript runtime.
