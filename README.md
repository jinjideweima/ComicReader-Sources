# ComicReader Sources

这是一个与 ComicReader App 分离发布、由用户主动添加的可选图源插件仓库。
ComicReader 不会把该地址预置进安装包，也不会在首次启动时自动添加或安装插件。
用户应当先审查源码、网络域名、权限、内容分级和第三方服务条款，再自行决定是否使用。

在 **ComicReader → 设置 → 图源管理 → ＋** 中添加：

```text
https://raw.githubusercontent.com/jinjideweima/ComicReader-Sources/main/index.json
```

添加仓库只会读取签名索引；每个图源仍需单独点击“审查安装”。1.1 图源使用
ComicReader 的原生隔离账号框架恢复账号书架、收藏、历史等插件已实现功能。密码不会
保存或传给 JavaScript；Cookie/Token 只发送给签名清单声明的账号域名。

---

ComicReader Sources is an independent, optional repository of source plugins
for ComicReader. The ComicReader app does not bundle this repository, add it
automatically, or recommend it during onboarding. Users choose whether to add
the repository after reviewing its code, permissions, content ratings, and
third-party service terms.

## Repository URL

Add this URL in **ComicReader → Settings → Source Management → +**:

```text
https://raw.githubusercontent.com/jinjideweima/ComicReader-Sources/main/index.json
```

Adding the repository only loads its signed index. ComicReader shows every
plugin for review and requires a separate confirmation before installation.
Each signed source also declares its complete user-visible feature catalogue,
which ComicReader shows both during review and after installation.

## Included plugins

| Plugin | ID | Rating | Declared capabilities |
| --- | --- | --- | --- |
| 包子漫画 | `baozi` | Mature | Discovery/search, temporary or account shelf, favorites, reading/downloads |
| 拷贝漫画 | `copymanga` | Mature | Discovery/topics/rankings, search, cloud favorites/history, reading/downloads |
| E-Hentai | `ehentai` | Adult | Advanced search, favorites/watched, ratings, comments, tags, My Settings, account tools, news/bounties, archives/torrents |
| MangaBZ | `mangabz` | Mature | Editorial home/search/rankings, favorites/history, batch shelf management, reading/downloads |
| 禁漫天堂 | `jmcomic` | Adult | Ad-free editorial home, search/rankings, full comments/replies, verified account actions, profile editing, short-video preview metadata, image restoration, reading/downloads |

Account features require a ComicReader build that supports signed declarative
authentication manifests. Passwords are submitted by native code only for the
current HTTPS login request. JavaScript receives only a non-secret signed-in
status flag; it never receives cookie or token values.

JMComic uses its mobile API because the public web frontend may reject ordinary
app networking with an anti-bot challenge. Its timestamp signing and encrypted
login response are handled by ComicReader's native credential boundary; the
plugin script still never receives the account token. Maintainers can run the
read-only live contract check with `node tools/smoke-jmcomic.mjs`.

Signed `resources` are optional non-executable data files. ComicReader downloads
them from the repository origin, verifies each SHA-256, and stores them beside
the installed source. Every resource declares its own license. The E-Hentai
Chinese tag dictionaries are therefore optional plugin resources and are not
bundled with the Apache-2.0 app.

## Security model

- Every script and optional data resource is distributed over HTTPS and pinned by SHA-256.
- Every index entry uses an Ed25519 v2 signature covering the complete
  manifest, including permissions, host allow-lists, and account rules.
- Network requests are restricted to the hosts declared in `allowedHosts`.
- Credential-bearing image headers are forbidden.
- Anonymous plugins use cookie-free sessions. Account-capable plugins use a
  per-source ephemeral cookie jar backed by a ThisDeviceOnly Keychain record.
- Plugin-supplied Cookie/Authorization headers and credential response headers
  are filtered by the native bridge.
- CI validates hashes, signatures, metadata, host patterns, and secrets.

The signing public key is recorded in `SIGNING_PUBLIC_KEY.txt`. A signature
proves that an index entry was produced with this repository's key; it does not
prove that a third-party service is safe, lawful, available, or unchanged.

## Legal boundary

The Apache-2.0 license covers the plugin code in this repository only. Optional
resources retain the license declared in their manifest and notice file. It does
not grant rights to third-party names, services, APIs, site content, images, or
accounts. This project is not affiliated with or endorsed by the referenced
services. Read `DISCLAIMER.md` before use.
