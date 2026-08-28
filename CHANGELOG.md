# Changelog

Each source uses its own semantic `version` in `index.json`. Script changes
must update that source version, digest, and signature together.

## [Unreleased]

- Upgrade JMComic to 1.4.20: expose the real account favorite-folder IDs,
  names, and counts with every cloud-shelf response so iOS and macOS can show
  the official folders instead of placeholder categories.
- Upgrade JMComic to 1.4.19: keep initial interaction reads on the authenticated
  mobile replica while iOS performs favorite and one-way rating through its
  isolated same-session WebKit broker, avoiding the website-cookie replay path.
- Upgrade JMComic to 1.4.18: require an independently verified official-site
  session for website favorite and rating writes, keep its same-named AVS
  separate from the mobile API token, and confirm tracking against both the
  fresh status endpoint and the synchronized tracking shelf before reporting
  success.
- Upgrade JMComic to 1.4.17: race signed login endpoints before submitting
  credentials, prioritize the current healthy API catalog, batch independent
  homepage sections on one proven replica, and keep partial homepage content
  visible when an optional section fails.
- Upgrade JMComic to 1.4.16: split mobile-API and official-website sessions;
  bind every authenticated API request to the host that issued its AVS;
  perform favorite and one-way rating through the official website endpoints
  with forced detail-page readback; verify tracking on the pinned mobile host;
  and return album state without waiting for the folder-list API.
- Upgrade JMComic to 1.4.15: follow the live 2.1.4 mobile signature and
  publisher-announced `www.cdnutc.me` API line; support bounded, signed login
  fallbacks; pin account state and mutations to one authenticated replica with
  cache-bypassing reads; and remove redundant tracking/write confirmations.
- Upgrade JMComic to 1.4.14: keep favorite, rating, and tracking controls
  available while background state refreshes; restore the current mobile
  client's version-signed POST mutations across inconsistent mirrors; and
  render an unrated heart as an unfilled icon until the server confirms it.
- Upgrade JMComic to 1.4.13: restore the official confirmation and folder
  picker before adding a favorite; use the mobile client's real GET-with-body
  protocol for favorite and rating mutations; verify writes on the same API
  mirror; expose a persistent website session for custom folders; and align
  the rating heart colors and success wording with the website.
- Upgrade JMComic to 1.4.12: move favorite, one-way like, and serial tracking
  back to the authenticated mobile API; confirm every mutation with a fresh
  server readback; prevent optimistic or ambiguous-timeout success; and cool
  unhealthy mirrors before the next account action.
- Upgrade JMComic to 1.4.2: replace Cloudflare-blocked community and library
  webpage scraping with the official blog and creator APIs, restore the three
  switchable editorial channels with rich article details, load current square
  library works and proxy-CDN covers, and reduce large comment-page latency.
- Upgrade JMComic to 1.4.1: reflect the website's one-way like behavior instead
  of exposing a fake unlike toggle, and confirm favorite/like mutations by
  reading the official album state back before reporting success.
- Upgrade JMComic to 1.4.0: use the verified website comment endpoint, make
  favorite/like/tracking updates independent and responsive, preserve complete
  work/character/tag/author groups and official random/article links, and
  expand the native account center with invitation, profile/avatar editing,
  charge/J-jar/combat metrics, novel shelves, tag blocking, and all history
  modules through isolated authenticated website tools.
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
