# Changelog

Each source uses its own semantic `version` in `index.json`. Script changes
must update that source version, digest, and signature together.

## [Unreleased]

- Upgrade JMComic to 1.2.0: preserve all comment pages and native commenter
  metadata, make comment submission non-blocking, verify favorite/like/tracking
  mutations, aggregate series-wide official dates/views/comment totals, expose
  related editorials and short-video metadata, and add allowlisted native
  profile editing.
- Add the signed JMComic (禁漫天堂) 1.0.0 source with a ten-section ad-free
  editorial home, weekly picks, community/library/novel previews, search and
  rankings, comments, native encrypted login, favorites/history, chapter image
  restoration, online reading, and downloads.
- Upgrade E-Hentai to 1.5.1: parse only explicit official filtered-result
  sentences so total search counts cannot be reported as removed items.
- Upgrade E-Hentai to 1.5.0: read actual `Obtained` Hath perks, enforce My Tags
  hidden-tag filtering across home/popular/hero results with official bypass
  metadata, add all seven official ranking families and four periods, and
  verify real E-Hentai/ExHentai host switching.
- Upgrade E-Hentai to 1.4.0: move bounties below torrents with a compact
  localized preview, remove the low-value news surface, localize and redesign
  Hentai@Home, donation, and Hath perk summaries, and align E-Hentai discovery
  card corners with the other editorial sources.
- Upgrade E-Hentai to 1.3.0: fix the website's inverse `ct_*` category flags,
  harden My Settings save/readback, refresh comments after server-side sort
  changes, expose official filter counts and temporary bypass links, and add
  native read-only account statistics, Hentai@Home, donation, Hath Perks,
  news, and bounty data.
- Upgrade E-Hentai to 1.2.0 with typed My Settings read/write support,
  allowlisted full-form preservation, entitlement locks, per-field readback,
  account-filter result metadata, and all five official list layouts.
- Declare a signed, user-visible feature catalogue for the original four sources so the
  app can expose their complete capabilities during review and management.
- Rename Baozi and CopyManga to their Chinese display names.
- Allow E-Hentai's publisher-isolated login session to retain Cloudflare
  challenge state and navigate the signed challenge host.
- Add signed declarative account manifests for all four sources.
- Upgrade signatures to `ed25519-v2`, covering the complete security manifest.
- Keep CopyManga tokens out of JavaScript and rely on native host/path-bound
  authorization.
- Restore CopyManga shelf, history, favorite mutation, and on-demand account
  overview through the native login-state and token attachment boundary.
- Move the optional E-Hentai Chinese tag dictionaries into signed,
  hash-verified resources with their original per-resource license notice.

## [1.0.0] - 2026-08-04

- Publish the first signed repository index.
- Add Baozi, CopyManga, E-Hentai, and MangaBZ source plugins.
- Declare network hosts, permissions, content ratings, licenses, and source
  locations for every plugin.
- Add deterministic digest/signature validation and full-history secret scans.
