# Changelog

Each source uses its own semantic `version` in `index.json`. Script changes
must update that source version, digest, and signature together.

## [Unreleased]

- Upgrade E-Hentai to 1.2.0 with typed My Settings read/write support,
  allowlisted full-form preservation, entitlement locks, per-field readback,
  account-filter result metadata, and all five official list layouts.
- Declare a signed, user-visible feature catalogue for all four sources so the
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
