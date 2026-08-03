# ComicReader Sources

这是一个与 ComicReader App 分离发布、由用户主动添加的可选图源插件仓库。
ComicReader 不会把该地址预置进安装包，也不会在首次启动时自动添加或安装插件。
用户应当先审查源码、网络域名、权限、内容分级和第三方服务条款，再自行决定是否使用。

在 **ComicReader → 设置 → 图源管理 → ＋** 中添加：

```text
https://raw.githubusercontent.com/jinjideweima/ComicReader-Sources/main/index.json
```

添加仓库只会读取签名索引；每个图源仍需单独点击“审查安装”。初版只承诺匿名浏览、
搜索、详情和阅读，依赖 Cookie 或 Token 的账号功能暂不属于兼容性承诺。

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

## Included plugins

| Plugin | ID | Rating | Declared capabilities |
| --- | --- | --- | --- |
| Baozi | `baozi` | Mature | Anonymous browse, search, details, and reading |
| CopyManga | `copymanga` | Mature | Anonymous browse, search, details, and reading |
| E-Hentai | `ehentai` | Adult | Anonymous browse, search, details, and reading |
| MangaBZ | `mangabz` | Mature | Anonymous browse, search, details, and reading |

Account-backed features are not part of the initial public compatibility
promise. They may require site cookies or tokens that ComicReader 1.0 does not
grant to third-party plugin sessions.

## Security model

- Every script is distributed over HTTPS and pinned by SHA-256.
- Every index entry is signed with the repository Ed25519 key.
- Network requests are restricted to the hosts declared in `allowedHosts`.
- Credential-bearing image headers are forbidden.
- Plugins use isolated, cookie-free sessions in ComicReader 1.0.
- CI validates hashes, signatures, metadata, host patterns, and secrets.

The signing public key is recorded in `SIGNING_PUBLIC_KEY.txt`. A signature
proves that an index entry was produced with this repository's key; it does not
prove that a third-party service is safe, lawful, available, or unchanged.

## Legal boundary

The Apache-2.0 license covers the plugin code in this repository only. It does
not grant rights to third-party names, services, APIs, site content, images, or
accounts. This project is not affiliated with or endorsed by the referenced
services. Read `DISCLAIMER.md` before use.
