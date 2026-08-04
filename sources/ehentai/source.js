// E-Hentai 图源插件（外站 / 匿名，v1）。
// 引擎契约：把图源对象赋给 globalThis.__source；可用全局：
//   fetch / fetchAll / parseHTML / storage / btoa / atob / console。
// 选择器语义同 Jsoup（SwiftSoup）。
//
// 站点模型映射：
//   manga   = 一个画廊 /g/<gid>/<token>/
//   chapter = 整本（画廊只有一“话”）
//   page    = 画廊内一张图（两步取图：缩略页 → /s/ 查看页 → #img 真图直链）
//
// e-hentai 的两个怪癖，本插件已就地接住：
//   1) 列表是游标分页（?next=<gid>），不是页码。用站点自带的 a#unext 链接，
//      按 (上下文 + 页码) 存进 storage，下一页直接取出来用。
//   2) 取图分三步：画廊「缩略页」(?p=k) → /s/ 查看页 → 真图 <img id="img">。
//      getPageList **惰性**：只抓画廊首页拿总页数，立刻返回 N 页（每页 url=它所属的缩略页
//      ?p=k 地址），阅读器秒开；读到第 i 页时缓冲再抓那张缩略页解析出 /s/，再走 /s/→#img。
//      省掉「进章节先抓 ceil(total/perPage) 张缩略页」的等待（首屏只需 base 一张）。
//      某图 509 时用查看页的 nl 令牌换 H@H 节点重取（getImageURL 的 retry 分支）。
//
// 外站 + 里站(exhentai)：里站经 host 选项切换（'ex'），登录 cookie 由 App 侧 EHentaiAccount
// 注入会话；插件不碰 cookie、只按 host 选 site()。nl 故障转移 / 509 限速由 Swift 侧承担。
(function () {
  // 站点基址按 host 选项动态切换：'ex' = 里站 exhentai（需登录 cookie，由 App 侧 EHentaiAccount
  // 注入会话）。普通态走外站 e-hentai。App 经 storage('host') 下发，切换即时生效、无需重载插件。
  function site() {
    return storage.get('host') === 'ex' ? 'https://exhentai.org' : 'https://e-hentai.org';
  }
  function sessionScope() {
    return site() + ':' + (storage.get('account_epoch') || '0');
  }
  function transientKey(name) {
    return name + ':' + sessionScope();
  }
  // E-Hentai 的 toplist.php 只在主站可用；里站模式下 exhentai.org/toplist.php 会 404。
  function toplistSite() {
    return 'https://e-hentai.org';
  }
  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

  // nw=1（跳成人警告插页）与登录 cookie 现统一由 App 侧注入 HTTPCookieStorage，会话自动带上，
  // 这里不再手写 Cookie 头——手写会把会话里的鉴权 cookie 顶掉，里站就登不进。
  function headerFields() {
    return { 'User-Agent': UA, 'Referer': site() + '/' };
  }
  function headers() {
    return { headers: headerFields() };
  }
  // HTML list pages are small and category correctness matters more than URLCache
  // reuse. Revalidate them so a cold-start warning/login document cannot become a
  // sticky home-page response. Cover and reader image caching are unaffected.
  function listHeaders() {
    var fields = headerFields();
    fields['Cache-Control'] = 'no-cache';
    return { headers: fields, cachePolicy: 'reloadIgnoringLocalCacheData' };
  }
  function galleryHeaders() {
    var fields = headerFields();
    fields['Cache-Control'] = 'no-cache';
    return { headers: fields, cachePolicy: 'reloadIgnoringLocalCacheData' };
  }
  // api.php 是 POST JSON。
  function apiHeaders() {
    var h = headerFields();
    h['Content-Type'] = 'application/json';
    return h;
  }

  function formHeaders() {
    var h = headerFields();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    return h;
  }

  function htmlHeaders() {
    var h = headerFields();
    h['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    return h;
  }

  function archiveHeaders() {
    var h = htmlHeaders();
    h['Referer'] = site() + '/';
    return h;
  }

  // 从 /s/<imgkey>/<gid>-<page> 查看页地址抠出 imgkey / gid / 页号（1 起）。
  function viewerKey(href) {
    var m = (href || '').match(/\/s\/([0-9a-f]+)\/(\d+)-(\d+)/);
    return m ? { imgkey: m[1], gid: m[2], page: parseInt(m[3], 10) } : null;
  }

  // 从一张查看页 HTML 里取 showkey（api.php showpage 的必备凭据，整本画廊通用）。
  function extractShowkey(body) {
    var m = (body || '').match(/var\s+showkey\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  }

  // 解析 #img 真图直链（查看页 HTML 或 api.php 的 i3 片段都含 <img id="img" src=...>）。
  function extractImg(htmlOrDoc) {
    if (typeof htmlOrDoc === 'string') {
      var m = htmlOrDoc.match(/<img[^>]+id="img"[^>]+src="([^"]+)"/);
      if (m) return m[1];
      m = htmlOrDoc.match(/id="img"[^>]+src="([^"]+)"/);
      return m ? m[1] : null;
    }
    var el = htmlOrDoc.selectFirst('#img');
    return el ? (el.attr('abs:src') || el.attr('src')) : null;
  }

  // api.php showpage 响应里 i6 段的 nl 令牌（失败转移换 H@H 节点用）。
  function extractNL(body) {
    var m = (body || '').match(/nl\('([^']+)'\)/);
    return m ? m[1] : null;
  }

  // 取一张查看页拿 showkey 存起来（getImageURLs 批量解析的前置；整本通用，只需一次）。
  function ensureShowkey(gid, viewerURL) {
    var saved = storage.get(transientKey('showkey:' + gid));
    if (saved) return saved;
    var res = fetch(abs(viewerURL), headers());
    var key = extractShowkey(res.body);
    if (key) storage.set(transientKey('showkey:' + gid), key);
    var nl = extractNL(res.body);
    if (nl) storage.set(transientKey('nl:' + viewerURL), nl);
    return key;
  }

  // 构造一条 api.php showpage 请求体；retry 时带上本页存下的 nl 令牌换节点。
  function showpageBody(gid, page, imgkey, showkey, nlToken) {
    var payload = { method: 'showpage', gid: parseInt(gid, 10), page: page, imgkey: imgkey, showkey: showkey };
    if (nlToken) payload.nl = nlToken;
    return JSON.stringify(payload);
  }

  function abs(path) {
    if (!path) return '';
    if (path.indexOf('http') === 0) return path;
    if (path.indexOf('//') === 0) return 'https:' + path;
    if (path.indexOf('/') === 0) return site() + path;
    return site() + '/' + path;
  }

  function cssURL(style) {
    var m = (style || '').match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    return m && m[2] ? abs(m[2]) : null;
  }

  function textOf(scope, sel) {
    if (!scope) return '';
    var e = scope.selectFirst(sel);
    return e ? e.text().trim() : '';
  }

  // 解码评论 HTML 里的常见实体（含数字实体），其余原样。换行不在这里处理。
  var NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"
  };
  function decodeEntities(s) {
    if (!s || s.indexOf('&') < 0) return s || '';
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (whole, ent) {
      if (ent.charAt(0) === '#') {
        var code = ent.charAt(1) === 'x' || ent.charAt(1) === 'X'
          ? parseInt(ent.substring(2), 16)
          : parseInt(ent.substring(1), 10);
        return isNaN(code) ? whole : String.fromCharCode(code);
      }
      var v = NAMED_ENTITIES[ent.toLowerCase()];
      return v != null ? v : whole;
    });
  }

  function stripTags(s) {
    return (s || '').replace(/<[^>]*>/g, '');
  }

  // 把评论正文内 HTML 解析成富文本切片：`<br>`/`</p>`/`</div>` → 换行，`<a href>` → 链接段，
  // 其余标签剥除、实体解码。多余空白收敛但保留换行（空格/制表收成单空格、行首空白去掉、
  // 连续空行最多两行）。无内容返回 null（展示层回退纯文本）。
  function parseCommentSpans(html) {
    if (!html) return null;
    // 先把源码/SwiftSoup pretty-print 引入的所有空白（含换行）收成单空格——HTML 本就折叠空白，
    // 真正的换行只来自 `<br>` 与块级标签收尾，下一步再据此造换行，避免把排版换行误当内容换行。
    var s = html
      .replace(/\s+/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<(p|div|li)\b[^>]*>/gi, '');

    var spans = [];
    function pushText(t) {
      t = decodeEntities(stripTags(t));
      if (t) spans.push({ text: t });
    }
    var re = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var last = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      pushText(s.substring(last, m.index));
      var href = decodeEntities(m[1]);
      var label = decodeEntities(stripTags(m[2])).trim() || href;
      if (href) spans.push({ text: label, href: href });
      else pushText(m[2]);
      last = re.lastIndex;
    }
    pushText(s.substring(last));
    if (!spans.length) return null;

    // 空白收敛：制表/空格成单空格、行首尾空白去掉、超过两行的空行压成两行；
    // 再修掉首段前导、末段尾随的空白。
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].href) continue;
      spans[i].text = spans[i].text
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    }
    if (!spans[0].href) spans[0].text = spans[0].text.replace(/^\s+/, '');
    var lastIdx = spans.length - 1;
    if (!spans[lastIdx].href) spans[lastIdx].text = spans[lastIdx].text.replace(/\s+$/, '');
    spans = spans.filter(function (sp) { return sp.href || sp.text.length; });
    return spans.length ? spans : null;
  }

  // 画廊页单条内存缓存：详情/评论/页表都打同一张画廊页，避免重复整页请求。
  // 仅留最近一条（一次详情会话只看一本画廊），关 App 即随 JSContext 销毁。
  var _galleryCache = { id: null, body: null };
  function responseStatus(res) {
    return parseInt(res && res.status, 10) || 0;
  }

  function responseTitle(doc) {
    var title = doc && doc.selectFirst ? doc.selectFirst('title') : null;
    return title ? (title.text() || '').replace(/\s+/g, ' ').trim() : '';
  }

  function safeResponseLocation(res) {
    var value = String((res && res.url) || '');
    var match = value.match(/^https?:\/\/([^\/?#]+)(\/[^?#]*)?/i);
    if (!match) return '未知地址';
    var path = match[2] || '/';
    // Gallery/viewer path components contain access tokens. They are useful to
    // the site but not to diagnostics, so never surface them in an error.
    path = path.replace(/\/g\/\d+\/[0-9a-f]+\/?/ig, '/g/<gallery>/');
    path = path.replace(/\/s\/[0-9a-f]+\/\d+-\d+/ig, '/s/<page>');
    return match[1].toLowerCase() + path;
  }

  function classifyHTMLResponse(res, doc, expectedKind) {
    var status = responseStatus(res);
    var title = responseTitle(doc).toLowerCase();
    var body = String((res && res.body) || '');
    var lower = body.toLowerCase();
    if (status < 200 || status >= 400) return 'http';
    if (expectedKind === '列表' && doc &&
        (doc.select('table.itg').length > 0 || doc.select('.itg').length > 0)) {
      return 'gallery-list';
    }
    if (expectedKind === '画廊' && isGalleryDocument(doc, body)) return 'gallery';
    if (/no hits found|no galleries found|there are no galleries matching|nothing found/i.test(body)) {
      return 'empty-list';
    }
    if (title.indexOf('temporarily banned') >= 0 ||
        lower.indexOf('temporarily banned') >= 0 ||
        lower.indexOf('your ip address has been temporarily banned') >= 0 ||
        lower.indexOf('too many requests') >= 0) {
      return 'rate-limit';
    }
    if (lower.indexOf('cf-chl-') >= 0 || lower.indexOf('cloudflare') >= 0 ||
        title.indexOf('just a moment') >= 0 || title.indexOf('attention required') >= 0) {
      return 'network-challenge';
    }
    if (/bounce_login|requires? (?:you )?to (?:log on|log in)|must be logged|please log in|sign in/i.test(lower)) {
      return 'login';
    }
    if (/content warning|cookies? (?:are |must be )?enabled|redirecting/i.test(lower)) {
      return 'navigation';
    }
    if (/509\.gif|sad panda/i.test(lower)) return 'access-denied';
    return 'unknown';
  }

  function responseKindLabel(kind) {
    switch (kind) {
      case 'empty-list': return '合法空列表';
      case 'rate-limit': return '访问频率限制';
      case 'network-challenge': return '网络验证页';
      case 'login': return '登录跳转页';
      case 'navigation': return '站点提示或跳转页';
      case 'access-denied': return '访问权限页';
      case 'http': return 'HTTP 错误';
      default: return '未知网页结构';
    }
  }

  function invalidHTMLMessage(kind, res, doc) {
    var status = responseStatus(res);
    var classification = classifyHTMLResponse(res, doc, kind);
    var diagnostic = 'HTTP ' + status + '；' + responseKindLabel(classification) +
      '；' + safeResponseLocation(res);
    if (status < 200 || status >= 400) {
      return 'E-Hentai ' + kind + '请求失败（' + diagnostic + '）';
    }
    if (classification === 'rate-limit') {
      return 'E-Hentai 暂时限制了当前网络的访问，请稍后重试（' + diagnostic + '）';
    }
    if (classification === 'network-challenge') {
      return 'E-Hentai 返回了网络验证页面，请切换网络或稍后重试（' + diagnostic + '）';
    }
    if (classification === 'login') {
      return 'E-Hentai 登录状态失效或页面发生登录跳转（' + diagnostic + '）';
    }
    if (classification === 'navigation') {
      return 'E-Hentai 返回了站点提示或跳转页面（' + diagnostic + '）';
    }
    if (site().indexOf('exhentai.org') >= 0) {
      return 'ExHentai 返回的不是有效' + kind + '页面，请确认里站 Cookie 完整或稍后重试（' + diagnostic + '）';
    }
    return 'E-Hentai 公共' + kind + '返回了异常页面，请稍后重试（' + diagnostic + '）';
  }

  function isGalleryDocument(doc, body) {
    if (!doc) return false;
    return doc.select('#gdd, #gd1, #gdt').length > 0 ||
      /Length[\s\S]{0,40}?\d+\s*pages/i.test(body || '') ||
      doc.select('a[href*="/s/"]').length > 0;
  }

  function galleryBody(manga, force) {
    var id = sessionScope() + ':' + (manga.id || manga.url);
    if (!force && id && _galleryCache.id === id && _galleryCache.body != null) {
      return _galleryCache.body;
    }
    var lastRes = null;
    var lastDoc = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      var res = fetch(abs(manga.url), galleryHeaders());
      var doc = parseHTML(res.body || '', site());
      lastRes = res;
      lastDoc = doc;
      if (responseStatus(res) >= 200 && responseStatus(res) < 400 &&
          isGalleryDocument(doc, res.body)) {
        // Only a verified gallery document may enter the in-memory cache. A
        // warning/login/rate-limit page must not poison detail and page parsing.
        _galleryCache = { id: id, body: res.body };
        return res.body;
      }
    }
    throw new Error(invalidHTMLMessage('画廊', lastRes, lastDoc));
  }

  // 从 /g/<gid>/<token>/ 抠出稳定标识。
  function galleryKey(href) {
    var m = (href || '').match(/\/g\/(\d+)\/([0-9a-f]+)/);
    return m ? { gid: m[1], token: m[2], id: m[1] + '/' + m[2], url: '/g/' + m[1] + '/' + m[2] + '/' } : null;
  }

  function galleryPopupURL(manga) {
    var key = galleryKey((manga && (manga.url || manga.id)) || '');
    if (!key && manga && manga.id) key = galleryKey('/g/' + manga.id + '/');
    return key ? site() + '/gallerypopups.php?gid=' + key.gid + '&t=' + key.token + '&act=addfav' : null;
  }

  function archiverURL(manga) {
    var key = galleryKey((manga && (manga.url || manga.id)) || '');
    if (!key && manga && manga.id) key = galleryKey('/g/' + manga.id + '/');
    return key ? site() + '/archiver.php?gid=' + key.gid + '&token=' + key.token : null;
  }

  function normalizeFavoriteName(text, id) {
    var value = decodeEntities(stripTags(text || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) return '收藏夹 ' + id;
    if (/^\d+\s*favorites?$/i.test(value)) return '收藏夹 ' + id;
    if (/^<[^>]+/.test(value) || value.indexOf('style=') >= 0) return '收藏夹 ' + id;
    if (/^收藏夹\s*[0-9]$/i.test(value) || /^favorite\s*[0-9]$/i.test(value)) return '收藏夹 ' + id;
    value = value
      .replace(/^\d+\s*[.:：-]\s*/, '')
      .replace(/^\d+(?=\D)/, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/^(?!收藏夹\s*)\s*(.+?)\s+\d+\s*$/, '$1')
      .replace(/\s*favorites?$/i, '')
      .trim();
    return value || ('收藏夹 ' + id);
  }

  function parseFavoriteCategories(doc) {
    var byID = {};
    function parseCount(text) {
      var m = (text || '').replace(/,/g, '').match(/^\s*(\d+)\b|\((\d+)\)/);
      return m ? parseInt(m[1] || m[2], 10) : null;
    }
    function favoritePanelInfo(fp) {
      var spans = [];
      fp.children().forEach(function (child) {
        var text = decodeEntities(stripTags(child.text() || '')).replace(/\s+/g, ' ').trim();
        var cls = child.attr('class') || '';
        var title = decodeEntities(child.attr('title') || '').replace(/\s+/g, ' ').trim();
        if (!text && title && /\bi\b/.test(cls)) text = title;
        if (text) spans.push(text);
      });
      if (!spans.length) {
        fp.select('span').forEach(function (span) {
          var text = decodeEntities(stripTags(span.text() || '')).replace(/\s+/g, ' ').trim();
          if (text) spans.push(text);
        });
      }
      var count = null;
      var name = null;
      spans.forEach(function (part) {
        var numeric = part.replace(/,/g, '');
        if (count == null && /^\d+$/.test(numeric)) {
          count = parseInt(numeric, 10);
        } else if (!name && !/^(color|colour|\s*)$/i.test(part)) {
          name = part;
        }
      });
      if (!name && spans.length > 1) {
        name = spans[spans.length - 1];
      }
      return { name: name || fp.text(), count: count == null ? parseCount(fp.text()) : count };
    }
    function add(id, name, count) {
      id = parseInt(id, 10);
      if (isNaN(id) || id < 0 || id > 9) return;
      byID[id] = {
        name: normalizeFavoriteName(name, id),
        count: count == null || isNaN(count) ? null : count
      };
    }
    doc.select('input[name="favcat"]').forEach(function (input) {
      var raw = input.attr('value') || '';
      if (!/^\d+$/.test(raw)) return;
      var id = parseInt(raw, 10);
      var label = '';
      var inputID = input.attr('id') || '';
      if (inputID) {
        var escaped = inputID.replace(/(["\\])/g, '\\$1');
        var lab = doc.selectFirst('label[for="' + escaped + '"]');
        if (lab) label = lab.text();
      }
      if (!label) {
        var html = doc.outerHtml ? doc.outerHtml() : '';
        var needle = input.outerHtml ? input.outerHtml() : '';
        var at = needle ? html.indexOf(needle) : -1;
        if (at >= 0) {
          var after = html.substring(at + needle.length, at + needle.length + 160);
          label = decodeEntities(stripTags(after.replace(/<input[\s\S]*$/i, '').replace(/<\/label>[\s\S]*$/i, ''))).trim();
        }
      }
      add(id, label, null);
    });
    doc.select('select[name="favcat"] option').forEach(function (opt) {
      var raw = opt.attr('value') || '';
      if (/^\d+$/.test(raw)) add(raw, opt.text(), null);
    });
    doc.select('.fp:not(.fps)').forEach(function (fp) {
      var text = fp.text();
      var id = null;
      var onclick = fp.attr('onclick') || '';
      var href = fp.attr('href') || '';
      var cls = fp.attr('class') || '';
      var m = (onclick + ' ' + href + ' ' + cls).match(/favcat[=:_-]?(\d)|fav(\d)|\b(\d)\b/i);
      if (m) id = m[1] || m[2] || m[3];
      if (id != null) {
        var info = favoritePanelInfo(fp);
        add(id, info.name, info.count);
      }
    });
    var out = [];
    for (var i = 0; i <= 9; i++) {
      out.push({ id: i, name: byID[i] ? byID[i].name : ('收藏夹 ' + i), count: byID[i] ? byID[i].count : null });
    }
    return out;
  }

  function favoriteCategoriesMetadata(doc) {
    var categories = parseFavoriteCategories(doc);
    var metadata = {};
    categories.forEach(function (category) {
      metadata['favoriteCategoryName' + category.id] = category.name;
      if (category.count != null) metadata['favoriteCategoryCount' + category.id] = String(category.count);
    });
    return metadata;
  }

  function parseFavoriteStateFromDoc(doc) {
    var categories = parseFavoriteCategories(doc);
    var selected = null;
    doc.select('input[name="favcat"]').forEach(function (input) {
      if (selected != null) return;
      var raw = input.attr('value') || '';
      if (!/^\d+$/.test(raw)) return;
      if (input.hasAttr('checked') || input.attr('checked')) selected = parseInt(raw, 10);
    });
    if (selected == null) {
      var opt = doc.selectFirst('select[name="favcat"] option[selected]');
      if (opt && /^\d+$/.test(opt.attr('value') || '')) selected = parseInt(opt.attr('value'), 10);
    }
    var noteEl = doc.selectFirst('textarea[name="favnote"]') || doc.selectFirst('input[name="favnote"]');
    var note = noteEl ? ((noteEl.attr('value') || noteEl.text() || '').trim()) : null;
    var text = doc.text() || '';
    var lower = text.toLowerCase();
    var hasFavoriteControls = doc.select('input[name="favcat"], select[name="favcat"]').length > 0;
    var hasFavoriteResult = lower.indexOf('favorite') >= 0
      && (lower.indexOf('updated') >= 0
        || lower.indexOf('added') >= 0
        || lower.indexOf('removed') >= 0
        || lower.indexOf('deleted') >= 0)
      || lower.indexOf('requested action has been performed') >= 0;
    var hasFavoritedSignal = lower.indexOf('modify favorite') >= 0
      || lower.indexOf('remove from favorites') >= 0
      || lower.indexOf('already in favorites') >= 0
      || doc.select('input[value="favdel"], option[value="favdel"]').length > 0;
    var looksLikeFavoritePage = hasFavoriteControls
      || hasFavoriteResult
      || lower.indexOf('add to favorites') >= 0
      || lower.indexOf('modify favorite') >= 0
      || lower.indexOf('remove from favorites') >= 0;
    var isFavorited = hasFavoritedSignal;
    return {
      isSupported: looksLikeFavoritePage,
      isFavorited: isFavorited,
      category: isFavorited ? selected : null,
      categories: categories,
      note: note || null,
      message: text || null
    };
  }

  function favoriteStateFromPopup(manga) {
    var url = galleryPopupURL(manga);
    if (!url) return { isSupported: false, isFavorited: false, category: null, categories: [], note: null, message: '无法识别画廊地址' };
    var res = fetch(url, headers());
    var doc = parseHTML(res.body, site());
    return parseFavoriteStateFromDoc(doc);
  }

  function formEncode(fields) {
    var parts = [];
    for (var key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      var value = fields[key];
      if (value == null) continue;
      if (Array.isArray(value)) {
        value.forEach(function (item) {
          if (item != null) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(item)));
        });
      } else {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      }
    }
    return parts.join('&');
  }

  var EH_ALL_CATEGORY_MASK = 1023;
  var EH_CATEGORIES = [
    { id: 2, en: 'Doujinshi', zh: '同人志' },
    { id: 4, en: 'Manga', zh: '漫画' },
    { id: 8, en: 'Artist CG', zh: '画师CG' },
    { id: 16, en: 'Game CG', zh: '游戏CG' },
    { id: 512, en: 'Western', zh: '西方' },
    { id: 256, en: 'Non-H', zh: '无H' },
    { id: 32, en: 'Image Set', zh: '图集' },
    { id: 64, en: 'Cosplay', zh: 'Cosplay' },
    { id: 128, en: 'Asian Porn', zh: '亚洲色情' },
    { id: 1, en: 'Misc', zh: '杂项' }
  ];

  function normalizeTag(raw) {
    raw = (raw || '').replace(/\+/g, ' ').trim();
    if (!raw) return '';
    raw = raw.replace(/^(f|m):/i, function (_, ns) {
      return ns.toLowerCase() === 'f' ? 'female:' : 'male:';
    });
    return raw;
  }

  function tagSearchValue(raw) {
    raw = normalizeTag(raw);
    if (!raw) return '';
    var parts = raw.split(':');
    if (parts.length < 2) return raw;
    var ns = parts.shift().trim();
    var key = parts.join(':').trim().replace(/\s+/g, '+');
    return ns + ':' + key;
  }

  function canonicalTag(raw) {
    return tagSearchValue(raw).replace(/\+/g, ' ').toLowerCase();
  }

  function myTagsURL(tagSetID) {
    var id = parseInt(tagSetID, 10);
    return site() + '/mytags' + (isNaN(id) ? '' : '?tagset=' + id);
  }

  var MY_TAGS_TTL_MS = 30000;
  var _myTagsCache = { scope: null, body: null, savedAt: 0 };

  function invalidateMyTagsCache() {
    _myTagsCache = { scope: null, body: null, savedAt: 0 };
  }

  function extractFormFields(form) {
    var fields = {};
    if (!form) return fields;
    form.select('input, textarea, select').forEach(function (el) {
      var name = el.attr('name') || '';
      if (!name) return;
      var outer = el.outerHtml ? el.outerHtml() : '';
      var tagM = outer.match(/^<\s*([a-z0-9]+)/i);
      var tag = tagM ? tagM[1].toLowerCase() : '';
      var type = (el.attr('type') || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !el.hasAttr('checked')) return;
      if (tag === 'select') {
        var opt = el.selectFirst('option[selected]') || el.selectFirst('option');
        fields[name] = opt ? opt.attr('value') : '';
      } else {
        fields[name] = el.attr('value') || el.text() || '';
      }
    });
    return fields;
  }

  function hasMyTagsControls(doc) {
    return !!(doc && (
      doc.selectFirst('form#usertag_form') ||
      doc.selectFirst('input[name="tagname_new"]') ||
      doc.selectFirst('input[name="usertag_action"]')
    ));
  }

  function selectedTagSetID(doc) {
    var opt = doc.selectFirst('form#tagset_form select option[selected]') || doc.selectFirst('form#tagset_form select option');
    var id = opt ? parseInt(opt.attr('value') || '', 10) : 1;
    return isNaN(id) ? 1 : id;
  }

  function parseTagSets(doc) {
    var selected = selectedTagSetID(doc);
    var enabled = !!doc.selectFirst('input[name="tagset_enable"][checked], input#tagset_enable[checked]');
    var options = doc.select('form#tagset_form select option');
    var sets = [];
    options.forEach(function (opt) {
      var id = parseInt(opt.attr('value') || '', 10);
      if (isNaN(id)) return;
      var text = cleanSnippetText(opt.text() || ('Tagset #' + id));
      var count = null;
      var m = text.match(/\((\d+)\)\s*$/);
      if (m) count = parseInt(m[1], 10);
      sets.push({
        id: id,
        name: text,
        count: isNaN(count) ? null : count,
        isEnabled: id === selected ? enabled : true,
        canRename: true
      });
    });
    if (!sets.length) {
      sets.push({ id: selected, name: 'Tagset #' + selected, count: null, isEnabled: enabled, canRename: true });
    }
    return sets;
  }

  function parseUserTagNode(node, tagSetID) {
    var idAttr = node.attr('id') || '';
    var m = idAttr.match(/usertag_(\d+)/);
    if (!m || m[1] === '0') return null;
    var id = m[1];
    var preview = node.selectFirst('#tagpreview_' + id) || node.selectFirst('[title][ehs-tag]') || node.selectFirst('[title]');
    var raw = preview ? (preview.attr('title') || preview.attr('ehs-tag') || preview.text()) : '';
    raw = normalizeTag(raw);
    if (!raw) return null;
    var watch = !!node.selectFirst('#tagwatch_' + id + '[checked]');
    var hidden = !!node.selectFirst('#taghide_' + id + '[checked]');
    var weightInput = node.selectFirst('#tagweight_' + id);
    var colorInput = node.selectFirst('#tagcolor_' + id);
    return {
      id: id,
      rawTag: raw,
      isWatched: watch,
      isHidden: hidden,
      weight: weightInput ? (weightInput.attr('value') || null) : null,
      color: colorInput ? (colorInput.attr('value') || null) : null,
      tagSetID: tagSetID
    };
  }

  function parseUserTagsState(doc, message) {
    if (!hasMyTagsControls(doc)) {
      return {
        isSupported: false,
        tagSets: [],
        selectedTagSetID: null,
        tags: [],
        message: message || '请先登录 E-Hentai 账号后再管理标签。'
      };
    }
    var selected = selectedTagSetID(doc);
    var tags = [];
    doc.select('form#usertag_form [id^="usertag_"]').forEach(function (node) {
      var tag = parseUserTagNode(node, selected);
      if (tag) tags.push(tag);
    });
    return {
      isSupported: true,
      tagSets: parseTagSets(doc),
      selectedTagSetID: selected,
      tags: tags,
      message: message || null
    };
  }

  function fetchUserTagsState(message, force) {
    var scope = sessionScope();
    var now = Date.now();
    var body = null;
    if (!force && _myTagsCache.scope === scope && _myTagsCache.body != null
      && now - _myTagsCache.savedAt < MY_TAGS_TTL_MS) {
      body = _myTagsCache.body;
    } else {
      var res = fetch(myTagsURL(), myTagsGETOptions());
      body = res.body;
      _myTagsCache = { scope: scope, body: body, savedAt: now };
    }
    var doc = parseHTML(body, site());
    return parseUserTagsState(doc, message);
  }

  function findUserTag(state, rawTag) {
    var target = canonicalTag(rawTag);
    for (var i = 0; i < (state.tags || []).length; i++) {
      if (canonicalTag(state.tags[i].rawTag) === target) return state.tags[i];
    }
    return null;
  }

  function buildAddUserTagFields(rawTag, mode) {
    return {
      usertag_action: 'add',
      usertag_target: '0',
      // My Tags 的文本框提交的是可读标签名（空格保留到表单编码阶段）。
      // tagSearchValue() 是给 /tag/ 与搜索 URL 用的，会先把空格改成 "+"；
      // 再经过 encodeURIComponent 后会变成 "%2B"，官网收到的是字面量加号而不是空格。
      tagname_new: normalizeTag(rawTag),
      tagwatch_new: mode === 'hidden' ? null : 'on',
      taghide_new: mode === 'hidden' ? 'on' : null,
      tagcolor_new: '',
      tagweight_new: '10'
    };
  }

  function buildDeleteUserTagsFields(ids) {
    var fields = { usertag_action: 'delete', usertag_target: '0', 'modify_usertags[]': [] };
    (ids || []).forEach(function (id) {
      if (id != null && String(id).trim()) fields['modify_usertags[]'].push(String(id).trim());
    });
    return fields;
  }

  function buildUpdateUserTagFields(id, isWatched, isHidden, weight, color) {
    id = String(id || '').trim();
    var fields = {
      usertag_action: 'update',
      usertag_target: '0',
      'modify_usertags[]': [id]
    };
    if (isWatched) fields['tagwatch_' + id] = 'on';
    if (isHidden) fields['taghide_' + id] = 'on';
    fields['tagweight_' + id] = weight == null ? '10' : String(weight);
    fields['tagcolor_' + id] = color == null ? '' : String(color);
    return fields;
  }

  function myTagsGETOptions(tagSetID) {
    var h = htmlHeaders();
    h['Cache-Control'] = 'no-cache';
    h['Pragma'] = 'no-cache';
    h['Referer'] = myTagsURL(tagSetID);
    return { headers: h, cachePolicy: 'reloadIgnoringLocalCacheData' };
  }

  function myTagsPOSTHeaders(tagSetID) {
    var h = formHeaders();
    h['Cache-Control'] = 'no-cache';
    h['Origin'] = site();
    h['Referer'] = myTagsURL(tagSetID);
    return h;
  }

  function postMyTags(fields, tagSetID) {
    var url = myTagsURL(tagSetID);
    var result = fetch(url, {
      headers: myTagsPOSTHeaders(tagSetID),
      method: 'POST',
      body: formEncode(fields),
      cachePolicy: 'reloadIgnoringLocalCacheData'
    });
    invalidateMyTagsCache();
    return result;
  }

  function addFormField(fields, name, value) {
    if (!name) return;
    value = value == null ? '' : String(value);
    if (fields[name] == null) fields[name] = value;
    else if (Array.isArray(fields[name])) fields[name].push(value);
    else fields[name] = [fields[name], value];
  }

  function extractSuccessfulFormFields(form) {
    var fields = {};
    if (!form) return fields;
    form.select('input, textarea, select').forEach(function (el) {
      var name = el.attr('name') || '';
      if (!name || el.hasAttr('disabled')) return;
      var outer = el.outerHtml ? el.outerHtml() : '';
      var tagM = outer.match(/^<\s*([a-z0-9]+)/i);
      var tag = tagM ? tagM[1].toLowerCase() : '';
      var type = (el.attr('type') || '').toLowerCase();
      if (/^(submit|button|image|reset|file)$/.test(type)) return;
      if ((type === 'checkbox' || type === 'radio') && !el.hasAttr('checked')) return;
      if (tag === 'select') {
        var selected = el.select('option[selected]');
        if (!selected.length && !el.hasAttr('multiple')) {
          var first = el.selectFirst('option');
          if (first) selected = [first];
        }
        selected.forEach(function (opt) { addFormField(fields, name, opt.attr('value') || opt.text() || ''); });
      } else if (tag === 'textarea') {
        addFormField(fields, name, el.text() || '');
      } else {
        addFormField(fields, name, el.attr('value') || (type === 'checkbox' ? 'on' : ''));
      }
    });
    return fields;
  }

  function htmlHeadingSection(body, english, chinese) {
    var html = String(body || '');
    var headings = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi;
    var title = new RegExp('(?:' + english + '|' + chinese + ')', 'i');
    var match;
    while ((match = headings.exec(html))) {
      var headingText = cleanSnippetText(parseHTML(match[0], site()).text() || '');
      if (!title.test(headingText)) continue;
      var next = headings.exec(html);
      return html.slice(match.index, next ? next.index : html.length);
    }
    return '';
  }

  function accountFilterOptionID(name, value) {
    return encodeURIComponent(String(name || '')) + '|' + encodeURIComponent(String(value == null ? 'on' : value));
  }

  function findAccountSettingsForm(doc) {
    if (!doc) return null;
    var forms = doc.select('form');
    for (var index = 0; index < forms.length; index += 1) {
      var form = forms[index];
      if (form.selectFirst('#xlasel, textarea[name="xu"]')) return form;
    }
    return doc.selectFirst('form[action*="uconfig"], form#uconfig');
  }

  function parseAccountFiltersBody(body, message) {
    var doc = parseHTML(body || '', site());
    var form = findAccountSettingsForm(doc);
    var languageHTML = htmlHeadingSection(body, 'Excluded\\s+Languages', '排除语言');
    var uploaderHTML = htmlHeadingSection(body, 'Excluded\\s+Uploaders', '排除上传者');
    if (!form || (!languageHTML && !uploaderHTML)) {
      return {
        isSupported: false,
        languageOptions: [],
        excludedUploaders: [],
        uploaderCapacityUsed: null,
        uploaderCapacityMaximum: null,
        message: message || '无法读取官网过滤设置，请确认账号已登录。'
      };
    }

    var options = [];
    if (languageHTML) {
      var languageDoc = parseHTML(languageHTML, site());
      var headerTitles = [];
      var headerRow = languageDoc.selectFirst('tr');
      if (headerRow) {
        headerRow.select('th, td').forEach(function (cell) {
          headerTitles.push(cleanSnippetText(cell.text() || ''));
        });
      }
      languageDoc.select('tr').forEach(function (row) {
        var cells = row.select('th, td');
        if (!cells.length) return;
        var language = cleanSnippetText(cells[0].text() || '');
        if (!language) return;
        for (var cellIndex = 1; cellIndex < cells.length; cellIndex += 1) {
          var inputs = cells[cellIndex].select('input[type="checkbox"][name], input[type="radio"][name]');
          inputs.forEach(function (input) {
            var name = input.attr('name') || '';
            var value = input.attr('value') || 'on';
            var variant = headerTitles[cellIndex] || cleanSnippetText(input.attr('title') || input.attr('aria-label') || '') || ('选项 ' + cellIndex);
            options.push({
              id: accountFilterOptionID(name, value),
              language: language,
              variant: variant,
              isExcluded: input.hasAttr('checked')
            });
          });
        }
      });
    }

    var uploaders = [];
    var used = null;
    var maximum = null;
    if (uploaderHTML) {
      var uploaderDoc = parseHTML(uploaderHTML, site());
      var textarea = uploaderDoc.selectFirst('textarea[name], textarea');
      var value = textarea ? (textarea.text() || textarea.attr('value') || '') : '';
      value.split(/[\r\n,]+/).forEach(function (item) {
        item = String(item || '').trim();
        if (item && uploaders.indexOf(item) < 0) uploaders.push(item);
      });
      var capacity = cleanSnippetText(uploaderDoc.text() || '').match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
      if (capacity) {
        used = parseInt(capacity[1], 10);
        maximum = parseInt(capacity[2], 10);
      }
    }
    return {
      isSupported: true,
      languageOptions: options,
      excludedUploaders: uploaders,
      uploaderCapacityUsed: isNaN(used) ? null : used,
      uploaderCapacityMaximum: isNaN(maximum) ? null : maximum,
      message: message || null
    };
  }

  function fetchAccountFilters(message) {
    var fields = htmlHeaders();
    fields['Cache-Control'] = 'no-cache';
    var res = fetch(site() + '/uconfig.php', {
      headers: fields,
      cachePolicy: 'reloadIgnoringLocalCacheData'
    });
    return { body: res.body || '', state: parseAccountFiltersBody(res.body || '', message) };
  }

  function normalizedUploaderList(items) {
    var result = [];
    (Array.isArray(items) ? items : []).forEach(function (item) {
      String(item || '').split(/[\r\n,]+/).forEach(function (part) {
        part = part.trim();
        if (part && result.indexOf(part) < 0) result.push(part);
      });
    });
    return result;
  }

  function parseArchiveCost(text) {
    var raw = cleanSnippetText(text || '');
    var specific = raw.match(/(?:download\s*cost|下载费用)\s*[:：]?\s*([^\n\r]+)/i);
    if (specific) raw = specific[1];
    if (/\b(free!?|no\s+charge|0\s*(?:GP|credits?|points?))\b|免费/i.test(raw)) return '免费';
    var m = raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:GP|credits?|points?))/i);
    return m ? m[1].trim() : null;
  }

  function parseArchiveSize(text) {
    var raw = cleanSnippetText(text || '');
    var specific = raw.match(/(?:estimated\s*size|archive\s*size|file\s*size|download\s*size|size|预计大小|文件大小|档案大小)\s*[:：]?\s*([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:KiB|MiB|GiB|KB|MB|GB))/i);
    if (specific) return specific[1].trim();
    var m = raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:KiB|MiB|GiB|KB|MB|GB))/i);
    return m ? m[1].trim() : null;
  }

  function parseArchiveAccountFunds(doc) {
    return parseArchiveAccountFundsFromHTML(doc && doc.outerHtml ? doc.outerHtml() : '')
      || parseArchiveAccountFundsFromDocCandidates(doc);
  }

  function htmlToSnippetText(value) {
    return decodeEntities(String(value || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|form|table)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '))
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeArchiveFundsText(value) {
    return htmlToSnippetText(value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\[\s*\?\s*\]/g, '[?]')
      .replace(/\s*:\s*/g, ': ')
      .trim();
  }

  function normalizeArchiveMoneyText(value) {
    return normalizeArchiveFundsText(value)
      .replace(/\s+(?=(?:GP|Credits?|points?)\b)/ig, ' ')
      .trim();
  }

  function archiveMoneyUnit(value) {
    if (/credits?/i.test(value || '')) return 'Credits';
    if (/\b(?:GP|Gallery\s*Points|points?)\b/i.test(value || '')) return 'GP';
    return '';
  }

  function parseArchiveAccountFundsFromText(text, allowBareMoney) {
    var normalized = normalizeArchiveFundsText(text);
    if (!normalized) return null;
    var pairs = [];
    var units = {};
    function pushMoney(value) {
      value = normalizeArchiveMoneyText(value);
      var unit = archiveMoneyUnit(value);
      if (!value || !unit || units[unit]) return;
      units[unit] = true;
      pairs.push(value);
    }
    var re = /([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:Gallery\s*Points|GP|Credits?|points?)\b(?!\s*[:：])(?:\s*\[\?\])?)/ig;
    var m;
    if (allowBareMoney !== false) {
      while ((m = re.exec(normalized)) !== null) {
        pushMoney(m[1]);
        if (pairs.length >= 2) break;
      }
    }
    var unitFirst = /\b(Gallery\s*Points|GP|Credits?)\b(?:\s*\[\?\])?\s*[:：]?\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*\[\?\])?/ig;
    while (pairs.length < 2 && (m = unitFirst.exec(normalized)) !== null) {
      var unit = /credit/i.test(m[1]) ? 'Credits' : 'GP';
      pushMoney(m[2] + ' ' + unit);
      if (pairs.length >= 2) break;
    }
    var wordsFirst = /\b(?:You\s+(?:currently\s+)?have|Available|Current|Balance)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(Gallery\s*Points|GP|Credits?|points?)\b(?:[\s,;，、]+(?:and\s+)?)?/ig;
    while (pairs.length < 2 && (m = wordsFirst.exec(normalized)) !== null) {
      var wordsUnit = /credit/i.test(m[2]) ? 'Credits' : 'GP';
      pushMoney(m[1] + ' ' + wordsUnit);
      if (pairs.length >= 2) break;
    }
    return pairs.length ? pairs.join(' ') : null;
  }

  function archiveOptionBoundaryIndex(text) {
    var m = String(text || '').search(/(?:Download\s*Cost|下载费用|Download\s+(?:Original|Resample)\s+Archive|下载(?:原始|重采样)(?:档案|归档)?|Estimated\s*Size|Archive\s*Size|File\s*Size|Download\s*Size|预计大小|文件大小|档案大小|H@H|Hentai@Home|Downloader|下载器|dltype|dlcheck)/i);
    return m >= 0 ? m : -1;
  }

  function archiveTopFundsRegion(text) {
    text = cleanSnippetText(text || '');
    if (!text) return '';
    var boundary = archiveOptionBoundaryIndex(text);
    if (boundary < 0) return '';
    var top = text.substring(0, boundary).trim();
    if (!top) return '';
    return top.substring(Math.max(0, top.length - 900)).trim();
  }

  function parseArchiveTopFundsFromText(text) {
    var top = archiveTopFundsRegion(text);
    if (!top) return null;
    var hasGP = /[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:Gallery\s*Points|GP|points?)\b/i.test(top)
      || /\b(?:Gallery\s*Points|GP|points?)\b(?:\s*\[\?\])?\s*[:：]?\s*[0-9][0-9,]*(?:\.[0-9]+)?/i.test(top);
    var hasCredits = /[0-9][0-9,]*(?:\.[0-9]+)?\s*Credits?\b/i.test(top)
      || /\bCredits?\b(?:\s*\[\?\])?\s*[:：]?\s*[0-9][0-9,]*(?:\.[0-9]+)?/i.test(top);
    if (!hasGP || !hasCredits) return null;
    return parseArchiveAccountFundsFromText(top, true);
  }

  function parseArchiveAccountFundsFromHTML(html) {
    if (!html) return null;
    var decoded = decodeEntities(String(html))
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ');
    var plain = htmlToSnippetText(decoded);
    var labeled = archiveFundsRegion(plain) || archiveFundsRegion(decoded);
    if (labeled) {
      var labeledFunds = parseArchiveAccountFundsFromText(labeled, true);
      if (labeledFunds) return labeledFunds;
    }
    var patterns = [
      /(?:现有资金|Current\s*Funds|Available\s*Funds|You\s+(?:currently\s+)?have|余额|账户资金|可用资金|\bFunds\b\s*[:：]?(?=\s*(?:[0-9]|Gallery\s*Points|GP|Credits?)))[\s\S]{0,320}?((?:[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:GP|Credits?|points?)(?:[\s\S]{0,80}?\[\s*\?\s*\])?[\s\S]{0,120}?){1,2})/i,
      /(?:Account\s*Overview|Account\s*Information|账户概览|账号概览)[\s\S]{0,900}?((?:Gallery\s*Points|GP|Credits?)[\s\S]{0,160}?(?:Gallery\s*Points|GP|Credits?)[\s\S]{0,160})/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = plain.match(patterns[i]) || decoded.match(patterns[i]);
      if (!m) continue;
      var funds = parseArchiveAccountFundsFromText(m[1], i === 0);
      if (funds) return funds;
    }
    var topFunds = parseArchiveTopFundsFromText(plain) || parseArchiveTopFundsFromText(decoded);
    if (topFunds) return topFunds;
    return null;
  }

  function archiveFundsRegion(text) {
    text = cleanSnippetText(text || '');
    var re = /(?:现有资金|Current\s*Funds|Available\s*Funds|You\s+(?:currently\s+)?have|余额|账户资金|可用资金|\bFunds\b\s*[:：]?(?=\s*(?:[0-9]|Gallery\s*Points|GP|Credits?)))/ig;
    var m;
    var fallback = '';
    while ((m = re.exec(text)) !== null) {
      var start = m.index + m[0].length;
      var tail = text.substring(start, Math.min(text.length, start + 700));
      var boundary = tail.search(/(?:Download\s*Cost|Estimated\s*Size|Archive\s*Size|Download\s+(?:Original|Resample)|H@H|Hentai@Home|Downloader|下载费用|预计大小|档案大小|下载(?:原始|重采样)|下载器)/i);
      if (boundary >= 0) tail = tail.substring(0, boundary);
      if (!fallback) fallback = tail;
      if (parseArchiveAccountFundsFromText(tail, true)) return tail;
    }
    return fallback;
  }

  function parseArchiveAccountFundsFromDocCandidates(doc) {
    var candidates = [];
    function pushText(value) {
      value = cleanSnippetText(value || '');
      if (value) candidates.push(value);
    }

    doc.select('#db, body, p, div').forEach(function (el) {
      pushText(el.text && el.text());
      pushText(el.outerHtml && el.outerHtml());
    });
    pushText(archivePlainText(doc));

    for (var i = 0; i < candidates.length; i++) {
      var text = candidates[i]
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!/(现有资金|Current\s*Funds|Available\s*Funds|You\s+(?:currently\s+)?have|余额|账户资金|可用资金|\bFunds\b\s*[:：]?(?=\s*(?:[0-9]|Gallery\s*Points|GP|Credits?)))/i.test(text)
        && !/(Account\s*Overview|Account\s*Information|账户概览|账号概览|Gallery\s*Points|Credits?)/i.test(text)) {
        continue;
      }
      var region = archiveFundsRegion(text);
      var funds = parseArchiveAccountFundsFromText(region || text, !!region);
      if (funds) return funds;
    }
    return null;
  }

  function directText(node) {
    if (!node) return '';
    return cleanSnippetText(node.ownText ? node.ownText() : node.text());
  }

  function nearestArchiveOptionBlock(pageHTML, needle, mode) {
    if (!pageHTML || !needle) return '';
    var at = pageHTML.indexOf(needle);
    if (at < 0) return '';
    var lower = pageHTML.toLowerCase();
    var start = lower.lastIndexOf('<div', at);
    var end = lower.indexOf('</div>', at);
    while (start >= 0 && end >= 0) {
      var html = pageHTML.substring(start, end + 6);
      var text = cleanSnippetText(html);
      var otherMode = mode === 'original' ? 'resample' : 'original';
      if (archiveTextHasMetric(text) && !archiveTextHasMode(text, otherMode)) {
        return text;
      }
      var previousStart = lower.lastIndexOf('<div', Math.max(0, start - 1));
      if (previousStart < 0) break;
      start = previousStart;
      end = lower.indexOf('</div>', at);
    }
    return '';
  }

  function lastIndexOfArchiveMetric(html, before) {
    var start = Math.max(0, before - 1200);
    var head = String(html || '').substring(start, before).toLowerCase();
    var keys = ['download cost', '下载费用'];
    var found = -1;
    keys.forEach(function (key) {
      var at = head.lastIndexOf(key);
      if (at > found) found = at;
    });
    return found >= 0 ? start + found : -1;
  }

  function nextArchiveFormBoundary(html, after) {
    var tail = String(html || '').substring(after, Math.min(String(html || '').length, after + 1400));
    var m = tail.search(/(?:Download\s*Cost|下载费用|H@H|Hentai@Home|Downloader|下载器)/i);
    return m >= 0 ? after + m : Math.min(String(html || '').length, after + 900);
  }

  function archiveMetricValues(text, kind) {
    text = cleanSnippetText(text || '');
    var out = [];
    var re = kind === 'size'
      ? /(?:Estimated\s*Size|Archive\s*Size|File\s*Size|Download\s*Size|预计大小|文件大小|档案大小)\s*[:：]?\s*(N\/A|[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:KiB|MiB|GiB|KB|MB|GB))/ig
      : /(?:Download\s*Cost|下载费用)\s*[:：]?\s*(N\/A|Free!?|免费|[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:GP|Credits?|points?))/ig;
    var m;
    while ((m = re.exec(text)) !== null) {
      out.push(m[1].trim());
    }
    return out;
  }

  function archiveOptionWindowByMode(pageHTML, mode) {
    var html = String(pageHTML || '');
    if (!html) return '';
    var top = html.split(/H@H|Hentai@Home|Downloader|下载器/i)[0] || html;
    var forms = [];
    var re = /<form\b[\s\S]*?<\/form>/ig;
    var m;
    while ((m = re.exec(top)) !== null) {
      var formHTML = m[0];
      var formText = cleanSnippetText(formHTML);
      var formMode = normalizeArchiveMode(formHTML, formText);
      if (formMode === 'original' || formMode === 'resample') {
        forms.push({ mode: formMode, index: m.index, end: re.lastIndex, html: formHTML });
      }
    }
    var targetIndex = -1;
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].mode === mode) { targetIndex = i; break; }
    }
    if (targetIndex < 0) return '';
    var sectionStart = Math.max(0, forms[0].index - 900);
    var sectionEnd = Math.min(top.length, forms[forms.length - 1].end + 900);
    var section = top.substring(sectionStart, sectionEnd);
    var costs = archiveMetricValues(section, 'cost');
    var sizes = archiveMetricValues(section, 'size');
    var formLabel = mode === 'original' ? 'Download Original Archive' : 'Download Resample Archive';
    var parts = [formLabel];
    if (costs[targetIndex] && !/^N\/A$/i.test(costs[targetIndex])) {
      parts.unshift('Download Cost: ' + costs[targetIndex]);
    }
    if (sizes[targetIndex] && !/^N\/A$/i.test(sizes[targetIndex])) {
      parts.push('Estimated Size: ' + sizes[targetIndex]);
    }
    return parts.join(' ');
  }

  function archiveFormWindow(pageHTML, formHTML, mode) {
    if (!pageHTML || !formHTML) return '';
    var formAt = pageHTML.indexOf(formHTML);
    if (formAt < 0) return '';
    var formEnd = formAt + formHTML.length;
    var start = lastIndexOfArchiveMetric(pageHTML, formAt);
    if (start < 0) start = Math.max(0, formAt - 500);
    var end = nextArchiveFormBoundary(pageHTML, formEnd);
    var block = pageHTML.substring(start, end);
    var modeBlock = archiveOptionWindowByMode(pageHTML, mode);
    return modeBlock ? (modeBlock + ' ' + block) : block;
  }

  function formArchiveOptionText(form, pageHTML, mode) {
    if (!form) return '';
    var parts = [];
    var formHTML = form.outerHtml ? form.outerHtml() : '';
    var formAt = pageHTML.indexOf(formHTML);
    if (formAt >= 0) {
      var windowHTML = archiveFormWindow(pageHTML, formHTML, mode);
      if (windowHTML) parts.push(windowHTML);
      var block = nearestArchiveOptionBlock(pageHTML, formHTML, mode) || containingTagHTML(pageHTML, formHTML, 'div');
      if (block) parts.push(block);
      if (!block || !archiveTextHasMetric(cleanSnippetText(block))) {
        var before = pageHTML.substring(Math.max(0, formAt - 500), formAt);
        var after = pageHTML.substring(formAt + formHTML.length, Math.min(pageHTML.length, formAt + formHTML.length + 700));
        parts.push(before);
        parts.push(formHTML);
        parts.push(after);
      }
    } else {
      parts.push(formHTML || form.text());
    }

    form.select('button, input[type="submit"]').forEach(function (button) {
      var buttonHTML = button.outerHtml ? button.outerHtml() : '';
      var block = nearestArchiveOptionBlock(pageHTML, buttonHTML, mode);
      if (block) parts.push(block);
    });

    return cleanSnippetText(parts.join(' '));
  }

  function labelTextForInput(doc, input, pageHTML) {
    var id = input.attr('id') || '';
    if (id) {
      var escaped = id.replace(/(["\\])/g, '\\$1');
      var label = doc.selectFirst('label[for="' + escaped + '"]');
      if (label) return cleanSnippetText(label.outerHtml ? label.outerHtml() : label.text());
    }
    var inputHTML = input.outerHtml ? input.outerHtml() : '';
    var labelHTML = containingTagHTML(pageHTML, inputHTML, 'label');
    return cleanSnippetText(labelHTML || input.text() || input.attr('value') || '');
  }

  function archiveDiagnostic(doc, accountFunds, fallbackDiagnostic) {
    if (accountFunds) return null;
    if (fallbackDiagnostic) return fallbackDiagnostic;
    var text = archivePlainText(doc);
    if (/log\s*in|login|sign\s*in|登录/i.test(text)) return 'Archiver 页面未登录或登录态失效';
    if (/现有资金|Current\s*Funds|Available\s*Funds|余额|账户资金|可用资金|\bFunds\b\s*[:：]?(?=\s*(?:[0-9]|Gallery\s*Points|GP|Credits?))/i.test(text)) return 'Archiver 页面存在资金区域，但未解析到账户资金';
    if (/下载原始档案|Download Original Archive|下载重采样档案|Download Resample Archive/i.test(text)) {
      return null;
    }
    return null;
  }

  function archiveDiagnosticURLLabel(url) {
    var m = String(url || '').match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    return m ? (m[1] + m[2]) : String(url || '');
  }

  function formatThousandsGroup(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // 精确个位的资金条：「<GP> GP [?] <Credits> Credits」（GP、Credits 相邻成对，
  // 中间可有 [?] 提示/分隔），避免误抓「重置配额需 N GP」那种单独 GP 数。
  function parseAdjacentFunds(text) {
    var m = String(text || '').match(
      /([0-9][0-9,]*)\s*GP\b\s*(?:\[\s*\?\s*\])?\s*(?:and\s+|[,，·、]\s*)?([0-9][0-9,]*)\s*Credits\b/i);
    if (!m) return null;
    return m[1].trim() + ' GP · ' + m[2].trim() + ' Credits';
  }

  // exchange.php?t=gp 页：顶部资金条是精确个位 GP；兑换表单里的「Available: Y kGP」只到千。
  // 先取精确条，取不到再退 kGP（×1000）。依据真机抓取：home.php 无余额，余额都在 exchange 页。
  function parseExchangeFunds(html) {
    var text = htmlToSnippetText(html || '');
    if (!text) return null;
    var exact = parseAdjacentFunds(text);
    if (exact) return exact;
    var creditsM = text.match(/Available:\s*([0-9][0-9,]*)\s*Credits/i);
    var gpM = text.match(/Available:\s*([0-9][0-9,]*)\s*kGP/i);
    var gpPlainM = gpM ? null : text.match(/Available:\s*([0-9][0-9,]*)\s*GP\b/i);
    var parts = [];
    if (gpM) {
      // kGP 仅到千、向下取整，加「+」表示"至少这么多"，不暗示精确个位。
      var kgp = parseInt(gpM[1].replace(/,/g, ''), 10);
      if (!isNaN(kgp)) parts.push(formatThousandsGroup(kgp * 1000) + '+ GP');
    } else if (gpPlainM) {
      parts.push(gpPlainM[1].trim() + ' GP');
    }
    if (creditsM) parts.push(creditsM[1].trim() + ' Credits');
    return parts.length ? parts.join(' · ') : null;
  }

  // 余额只在 exchange.php?t=gp（先主站 e-hentai.org，里站再兜底；GP/Credits 账号级、cookie 通用）。
  function archiveFundsSources() {
    var out = [{ url: 'https://e-hentai.org/exchange.php?t=gp', parse: parseExchangeFunds }];
    var current = site();
    if (current !== 'https://e-hentai.org') {
      out.push({ url: current + '/exchange.php?t=gp', parse: parseExchangeFunds });
    }
    return out;
  }

  function archiveAccountFundsFallbackResult() {
    var sources = archiveFundsSources();
    var sawLogin = false;
    var sawFundsText = false;
    var sawResponse = false;
    var diagnostics = [];
    for (var i = 0; i < sources.length; i++) {
      var label = archiveDiagnosticURLLabel(sources[i].url);
      try {
        var res = fetch(sources[i].url, { headers: archiveHeaders(), timeout: 20 });
        var status = res.status || 0;
        sawResponse = true;
        var funds = sources[i].parse(res.body)
          || parseArchiveAccountFundsFromHTML(res.body)
          || parseArchiveAccountFundsFromText(res.body, false);
        if (funds) return { funds: funds, diagnostic: null };
        var text = cleanSnippetText(res.body || '');
        var looksLoggedOut = /log\s*in|login|sign\s*in|requires\s+you\s+to\s+log\s+on|登录/i.test(text);
        if (looksLoggedOut) sawLogin = true;
        if (/(Available\s*:|kGP|Current\s*Funds|Available\s*Funds|Gallery\s*Points|Credits|现有资金|账户资金|可用资金|余额)/i.test(text)) {
          sawFundsText = true;
        }
        var detail = label + ' status=' + status;
        if (looksLoggedOut) detail += ' loggedOut';
        else if (/(Available\s*:|kGP|Current\s*Funds|Available\s*Funds|Gallery\s*Points|Credits|现有资金|账户资金|可用资金|余额)/i.test(text)) detail += ' hasFundsText';
        else detail += ' noFundsText';
        diagnostics.push(detail);
      } catch (e) {
        diagnostics.push(label + ' fetchFailed=' + String(e && e.message ? e.message : e));
      }
    }
    if (sawLogin) {
      return { funds: null, diagnostic: '账号页需要登录，当前请求没有带到 E-Hentai 登录态' };
    }
    if (sawFundsText) {
      return { funds: null, diagnostic: '账号页存在资金相关文本，但未解析到账户资金' };
    }
    if (sawResponse) {
      return { funds: null, diagnostic: '账号页未返回资金字段' };
    }
    if (diagnostics.length) {
      return { funds: null, diagnostic: '账号页请求失败，无法读取账户资金' };
    }
    return { funds: null, diagnostic: null };
  }

  function archiveRequiresConfirmation(cost) {
    if (!cost) return true;
    return !/^(免费|free|0\s*(?:GP|credits?|points?)?)$/i.test(String(cost).trim());
  }

  function archiveBestSubtitle(current, next) {
    current = cleanSnippetText(current || '');
    next = cleanSnippetText(next || '');
    if (!current) return next;
    if (!next) return current;
    var currentScore = (parseArchiveSize(current) ? 2 : 0) + (parseArchiveCost(current) ? 2 : 0) + Math.min(current.length, 240) / 1000;
    var nextScore = (parseArchiveSize(next) ? 2 : 0) + (parseArchiveCost(next) ? 2 : 0) + Math.min(next.length, 240) / 1000;
    return nextScore > currentScore ? next : current;
  }

  function archiveOptionTitle(raw) {
    raw = (raw || '').toLowerCase();
    if (raw.indexOf('org') >= 0 || raw.indexOf('original') >= 0 || raw.indexOf('原始') >= 0 || raw.indexOf('原档') >= 0) return '原始档案';
    if (raw.indexOf('resample') >= 0 || raw.indexOf('重采样') >= 0 || raw.indexOf('780') >= 0 || raw.indexOf('1280') >= 0) return '重采样档案';
    return '官方档案';
  }

  function normalizeArchiveMode(value, text) {
    var rawValue = String(value || '').trim().toLowerCase();
    var hay = (rawValue + ' ' + (text || '')).toLowerCase();
    if (/^(org|original)$/.test(rawValue) || hay.indexOf('original') >= 0 || hay.indexOf('原始') >= 0 || hay.indexOf('原档') >= 0) return 'original';
    if (/^(res|resample)$/.test(rawValue) || hay.indexOf('resample') >= 0 || hay.indexOf('重采样') >= 0 || hay.indexOf('780') >= 0 || hay.indexOf('1280') >= 0) return 'resample';
    return (value || text || 'archive').replace(/\s+/g, '_').toLowerCase();
  }

  function contextAroundNeedle(html, needle) {
    if (!html || !needle) return '';
    var at = html.indexOf(needle);
    if (at < 0) return '';
    return html.substring(Math.max(0, at - 160), Math.min(html.length, at + needle.length + 240));
  }

  function cleanSnippetText(html) {
    return htmlToSnippetText(html || '');
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containingTagHTML(html, needle, tagName) {
    if (!html || !needle) return '';
    var at = html.indexOf(needle);
    if (at < 0) return '';
    var lower = html.toLowerCase();
    var tag = String(tagName || '').toLowerCase();
    var start = lower.lastIndexOf('<' + tag, at);
    var end = lower.indexOf('</' + tag + '>', at);
    if (start < 0 || end < 0) return '';
    var previousClose = lower.lastIndexOf('</' + tag + '>', at);
    if (previousClose > start) return '';
    return html.substring(start, end + tag.length + 3);
  }

  function archiveTextHasMode(text, mode) {
    return !!firstArchiveAnchor(text || '', mode);
  }

  function archiveTextHasMetric(text) {
    return !!(parseArchiveSize(text) || parseArchiveCost(text));
  }

  function archiveLooksLikeHathText(text) {
    text = cleanSnippetText(text || '');
    return /H@H|Hentai@Home|Downloader|Download\s*Original\s*Images|Original\s+[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:KiB|MiB|GiB|KB|MB|GB)\s+(?:Free|[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:GP|Credits?|points?))/i.test(text);
  }

  function archiveLooksLikeOfficialOption(text) {
    text = cleanSnippetText(text || '');
    if (!/(Download\s+(?:Original|Resample)\s+Archive|下载(?:原始|重采样)(?:档案|归档)?|dltype|dlcheck|Archive\s*Size|Estimated\s*Size|Download\s*Cost|预计大小|下载费用)/i.test(text)) return false;
    return !archiveLooksLikeHathText(text);
  }

  function archiveContextCandidates(doc, input, pageHTML) {
    var out = [];
    var id = input.attr('id') || '';
    if (id) {
      var escaped = id.replace(/(["\\])/g, '\\$1');
      var label = doc.selectFirst('label[for="' + escaped + '"]');
      if (label) {
        out.push(label.outerHtml ? label.outerHtml() : label.text());
      }
    }

    var inputHTML = input.outerHtml ? input.outerHtml() : '';
    var labelHTML = containingTagHTML(pageHTML, inputHTML, 'label');
    if (labelHTML) out.push(labelHTML);

    ['tr', 'td', 'li', 'fieldset', 'section', 'div', 'p'].forEach(function (tag) {
      var html = containingTagHTML(pageHTML, inputHTML, tag);
      if (html) out.push(html);
    });

    var snippet = contextAroundNeedle(pageHTML, inputHTML);
    if (snippet) out.push(snippet);
    out.push(input.text() || input.attr('value') || input.attr('name') || '');
    return out.map(cleanSnippetText).filter(function (text, index, arr) {
      return text && arr.indexOf(text) === index;
    });
  }

  function optionTextForInput(doc, input, pageHTML, mode) {
    var otherMode = mode === 'original' ? 'resample' : 'original';
    var candidates = archiveContextCandidates(doc, input, pageHTML);

    for (var i = 0; i < candidates.length; i++) {
      if (!archiveLooksLikeOfficialOption(candidates[i])) continue;
      if (!archiveTextHasMode(candidates[i], mode)) continue;
      if (archiveTextHasMode(candidates[i], otherMode)) continue;
      if (archiveTextHasMetric(candidates[i])) return candidates[i];
    }
    for (var j = 0; j < candidates.length; j++) {
      if (!archiveLooksLikeOfficialOption(candidates[j])) continue;
      if (!archiveTextHasMode(candidates[j], mode)) continue;
      if (archiveTextHasMode(candidates[j], otherMode)) continue;
      return candidates[j];
    }
    return candidates[0] || '';
  }

  function archivePlainText(doc) {
    return htmlToSnippetText(doc.outerHtml ? doc.outerHtml() : (doc.text() || ''))
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function archiveAnchorRegex(mode) {
    return mode === 'original'
      ? /(?:download\s*)?(?:original|org|原始|原档)(?:\s*archive|\s*档案)?/ig
      : /(?:download\s*)?(?:resample|重采样|1280x?)(?:\s*archive|\s*档案)?/ig;
  }

  function firstArchiveAnchor(text, mode) {
    var re = archiveAnchorRegex(mode);
    var match;
    while ((match = re.exec(text)) !== null) {
      var value = match[0].toLowerCase();
      if (mode === 'original' && value.indexOf('original') < 0 && value.indexOf('org') < 0 && value.indexOf('原始') < 0 && value.indexOf('原档') < 0) continue;
      if (mode === 'resample' && value.indexOf('resample') < 0 && value.indexOf('重采样') < 0 && value.indexOf('1280') < 0) continue;
      return { index: match.index, end: match.index + match[0].length };
    }
    return null;
  }

  function lastMetricStartBefore(text, index) {
    var head = text.substring(0, Math.max(0, index));
    var keys = ['Download Cost', 'download cost', '下载费用', 'Estimated Size', 'estimated size', '预计大小'];
    var start = -1;
    keys.forEach(function (key) {
      var at = head.lastIndexOf(key);
      if (at > start) start = at;
    });
    if (start >= 0) return start;
    return Math.max(0, index - 180);
  }

  function nextArchiveBoundary(text, index, otherMode) {
    var other = firstArchiveAnchor(text.substring(index), otherMode);
    if (other) {
      var beforeOther = text.substring(0, index + other.index);
      var cost = Math.max(beforeOther.lastIndexOf('Download Cost'), beforeOther.lastIndexOf('download cost'), beforeOther.lastIndexOf('下载费用'));
      if (cost > index) return cost;
      return index + other.index;
    }
    var hah = text.substring(index).search(/H@H|Limits|限制|下载器/i);
    return hah >= 0 ? index + hah : Math.min(text.length, index + 360);
  }

  function archiveTextSegment(text, mode) {
    var anchor = firstArchiveAnchor(text, mode);
    if (!anchor) return '';
    var otherMode = mode === 'original' ? 'resample' : 'original';
    var start = lastMetricStartBefore(text, anchor.index);
    var end = nextArchiveBoundary(text, anchor.end, otherMode);
    if (end <= start) end = Math.min(text.length, anchor.end + 260);
    return text.substring(start, end).trim();
  }

  function parseArchiveOptionsFromDoc(doc) {
    var byMode = {};
    function add(mode, title, subtitle, size, cost, trusted) {
      if (!mode) return;
      var existing = byMode[mode];
      var option = existing || {
        mode: mode,
        title: archiveOptionTitle(mode),
        subtitle: null,
        size: null,
        cost: null,
        requiresGPConfirmation: true,
        _trusted: false
      };
      option.title = title || option.title || archiveOptionTitle(mode);
      if (trusted || !option._trusted) {
        option.subtitle = archiveBestSubtitle(option.subtitle, subtitle) || null;
        option.size = option.size || size || null;
        option.cost = option.cost || cost || null;
        option._trusted = !!trusted || option._trusted;
      } else {
        option.subtitle = archiveBestSubtitle(option.subtitle, subtitle) || null;
        option.size = option.size || size || null;
        option.cost = option.cost || cost || null;
      }
      option.requiresGPConfirmation = archiveRequiresConfirmation(option.cost);
      byMode[mode] = option;
    }

    var pageHTML = doc.outerHtml ? doc.outerHtml() : '';
    doc.select('form').forEach(function (form) {
      var mode = formArchiveMode(form);
      if (mode !== 'original' && mode !== 'resample') return;
      var precise = archiveOptionWindowByMode(pageHTML, mode);
      if (precise && archiveLooksLikeOfficialOption(precise)) {
        add(mode, archiveOptionTitle(mode), precise, parseArchiveSize(precise), parseArchiveCost(precise), true);
      }
      var block = formArchiveOptionText(form, pageHTML, mode);
      if (!archiveLooksLikeOfficialOption(block)) return;
      add(mode, archiveOptionTitle(mode), block, parseArchiveSize(block), parseArchiveCost(block), true);
    });

    doc.select('label').forEach(function (label) {
      var input = label.selectFirst('input[type="radio"]');
      if (!input) return;
      var labelText = cleanSnippetText(label.outerHtml ? label.outerHtml() : label.text());
      if (archiveLooksLikeHathText(labelText)) return;
      var mode = normalizeArchiveMode(input.attr('value') || input.attr('name'), labelText);
      if (mode !== 'original' && mode !== 'resample') return;
      add(mode, archiveOptionTitle(mode), labelText, parseArchiveSize(labelText), parseArchiveCost(labelText), true);
    });

    doc.select('input[type="radio"], input[type="submit"], button, a').forEach(function (el) {
      var type = (el.attr('type') || '').toLowerCase();
      var name = el.attr('name') || '';
      var value = el.attr('value') || el.text() || '';
      var text = el.text() || value || name;
      var mode = normalizeArchiveMode(value || name, text);
      var parent = optionTextForInput(doc, el, pageHTML, mode) || text;
      if (archiveLooksLikeHathText(parent)) return;
      var hay = (name + ' ' + value + ' ' + text + ' ' + parent).toLowerCase();
      if (hay.indexOf('download') < 0
        && hay.indexOf('archive') < 0
        && hay.indexOf('original') < 0
        && hay.indexOf('resample') < 0
        && hay.indexOf('dltype') < 0
        && hay.indexOf(' org') < 0
        && hay.indexOf(' res') < 0
        && hay.indexOf('原始') < 0
        && hay.indexOf('原档') < 0
        && hay.indexOf('重采样') < 0) return;
      if (type && type !== 'radio' && type !== 'submit') return;
      mode = normalizeArchiveMode(value || name, parent || text);
      if (mode !== 'original' && mode !== 'resample') return;
      add(mode, archiveOptionTitle(parent || value || name), parent, parseArchiveSize(parent), parseArchiveCost(parent), false);
    });

    var text = archivePlainText(doc);
    ['original', 'resample'].forEach(function (mode) {
      var segment = archiveTextSegment(text, mode);
      if (segment && archiveLooksLikeOfficialOption(segment)) add(mode, archiveOptionTitle(mode), segment, parseArchiveSize(segment), parseArchiveCost(segment), false);
    });
    if (!byMode.original && /original|原始|原档/i.test(text)) add('original', '原始档案', null, null, null, false);
    if (!byMode.resample && /resample|重采样|1280/i.test(text)) add('resample', '重采样档案', null, null, null, false);
    var out = [];
    ['original', 'resample'].forEach(function (mode) {
      if (byMode[mode]) {
        delete byMode[mode]._trusted;
        out.push(byMode[mode]);
      }
    });
    Object.keys(byMode).forEach(function (mode) {
      if (mode !== 'original' && mode !== 'resample') {
        delete byMode[mode]._trusted;
        out.push(byMode[mode]);
      }
    });
    return out;
  }

  function parseArchiveDownloadURL(doc) {
    var link = null;
    doc.select('a').forEach(function (a) {
      if (link) return;
      var href = a.attr('abs:href') || a.attr('href') || '';
      var text = (a.text() || '').toLowerCase();
      var hay = (href + ' ' + text).toLowerCase();
      if (hay.indexOf('archiver.php') >= 0 && (hay.indexOf('dl=') >= 0 || hay.indexOf('download') >= 0)) {
        link = href;
      } else if (/\.(zip|cbz)(?:[?#]|$)/i.test(href)) {
        link = href;
      }
    });
    return link;
  }

  function absolutizeArchiveURL(url) {
    if (!url) return null;
    url = decodeEntities(String(url)).replace(/&amp;/g, '&').trim();
    if (!url || url === '#') return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.charAt(0) === '/') return site() + url;
    return site() + '/' + url.replace(/^\.?\//, '');
  }

  function parseArchiveNextURL(doc) {
    var html = doc.outerHtml ? doc.outerHtml() : '';
    var m = html.match(/(?:document|window)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i)
      || html.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i)
      || html.match(/location\.assign\(\s*["']([^"']+)["']\s*\)/i);
    if (m) return absolutizeArchiveURL(m[1]);

    var meta = doc.selectFirst('meta[http-equiv=refresh], meta[http-equiv=Refresh]');
    if (meta) {
      var content = meta.attr('content') || '';
      var mm = content.match(/url\s*=\s*([^;]+)/i);
      if (mm) return absolutizeArchiveURL(mm[1].replace(/^["']|["']$/g, ''));
    }

    var clicked = null;
    doc.select('a').forEach(function (a) {
      if (clicked) return;
      var text = (a.text() || '').toLowerCase();
      var href = a.attr('abs:href') || a.attr('href') || '';
      if (!href) return;
      if (text.indexOf('click here') >= 0
        || text.indexOf('continue') >= 0
        || text.indexOf('download') >= 0
        || text.indexOf('start') >= 0
        || href.indexOf('start=1') >= 0) {
        clicked = absolutizeArchiveURL(href);
      }
    });
    return clicked;
  }

  function archiveIsPreparing(doc) {
    var text = archivePlainText(doc);
    return /Locating archive server|preparing file for download|browser does not continue automatically|正在准备|准备下载/i.test(text);
  }

  function formArchiveModes(form) {
    var modes = [];
    if (!form) return null;
    form.select('input, button').forEach(function (el) {
      var name = el.attr('name') || '';
      var value = el.attr('value') || el.text() || '';
      var text = el.text() || value || name;
      var normalized = normalizeArchiveMode(value || name, text);
      if ((normalized === 'original' || normalized === 'resample') && modes.indexOf(normalized) < 0) {
        modes.push(normalized);
      }
    });
    return modes;
  }

  function formArchiveMode(form) {
    var modes = formArchiveModes(form);
    return modes && modes.length === 1 ? modes[0] : null;
  }

  function findArchiveForm(doc, mode) {
    var target = String(mode || '').toLowerCase();
    var matched = null;
    doc.select('form').forEach(function (form) {
      if (matched) return;
      if (formArchiveMode(form) === target) matched = form;
    });
    return matched;
  }

  function buildArchivePostFields(doc, mode) {
    var form = findArchiveForm(doc, mode) || doc.selectFirst('form') || doc;
    var fields = extractFormFields(form);
    var target = String(mode || '').toLowerCase();
    var pickedSubmitName = null;
    var pickedSubmitValue = null;

    var formHTML = form.outerHtml ? form.outerHtml() : '';
    form.select('input[type="radio"], button[type="submit"], input[type="submit"], button:not([type])').forEach(function (el) {
      if (pickedSubmitName) return;
      var name = el.attr('name') || '';
      var value = el.attr('value') || el.text() || '';
      var snippet = contextAroundNeedle(formHTML, el.outerHtml ? el.outerHtml() : '');
      var text = cleanSnippetText(snippet) || el.text() || value || name;
      var normalized = normalizeArchiveMode(value || name, text);
      if (normalized !== target) return;
      var type = (el.attr('type') || '').toLowerCase();
      if (type === 'radio') {
        fields[name] = value || mode;
      } else if (name) {
        pickedSubmitName = name;
        pickedSubmitValue = value || el.text() || mode;
      }
    });

    fields.dltype = target === 'original' ? 'org' : 'res';
    if (pickedSubmitName) {
      fields[pickedSubmitName] = pickedSubmitValue;
    } else if (target === 'original') {
      fields.dlcheck = 'Download Original Archive';
    } else if (target === 'resample') {
      fields.dlcheck = 'Download Resample Archive';
    }
    return fields;
  }

  function scriptVar(body, name) {
    var re = new RegExp('var\\s+' + name + '\\s*=\\s*([^;]+);', 'i');
    var m = (body || '').match(re);
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, '').replace(/\\\//g, '/');
  }

  function ratingFromSpriteStyle(style) {
    var m = (style || '').match(/background-position\s*:\s*(-?\d+)px\s+(-?\d+)px/i);
    if (!m) return null;
    var x = parseInt(m[1], 10);
    var y = parseInt(m[2], 10);
    if (isNaN(x) || isNaN(y)) return null;
    var score = 2 * Math.round((x + 80) / 16);
    if (y <= -11) score -= 1;
    if (score < 1 || score > 10) return null;
    return score / 2;
  }

  function parseCurrentUserRating(body) {
    var explicitVars = ['rating_usr', 'user_rating', 'rating_user'];
    for (var i = 0; i < explicitVars.length; i++) {
      var raw = scriptVar(body, explicitVars[i]);
      if (raw == null) continue;
      var parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    var display = scriptVar(body, 'display_rating');
    var average = scriptVar(body, 'average_rating');
    var displayRating = display == null ? NaN : parseFloat(display);
    var averageRating = average == null ? NaN : parseFloat(average);
    if (!isNaN(displayRating) && displayRating > 0) {
      if (isNaN(averageRating) || Math.abs(displayRating - averageRating) > 0.001) return displayRating;
      var imageM = (body || '').match(/id=["']rating_image["'][^>]*class=["']([^"']*)["'][^>]*style=["']([^"']*)["']/i)
        || (body || '').match(/id=["']rating_image["'][^>]*style=["']([^"']*)["'][^>]*class=["']([^"']*)["']/i);
      if (imageM) {
        var first = imageM[1] || '';
        var second = imageM[2] || '';
        var cls = (first + ' ' + second).trim();
        if (/\bir[rbgy]\b/.test(cls)) return displayRating;
      }
    }
    var ratedImageM = (body || '').match(/id=["']rating_image["'][^>]*class=["']([^"']*)["'][^>]*style=["']([^"']*)["']/i)
      || (body || '').match(/id=["']rating_image["'][^>]*style=["']([^"']*)["'][^>]*class=["']([^"']*)["']/i);
    if (ratedImageM) {
      var ratedFirst = ratedImageM[1] || '';
      var ratedSecond = ratedImageM[2] || '';
      if (/\bir[rbgy]\b/.test((ratedFirst + ' ' + ratedSecond).trim())) {
        var spriteRating = ratingFromSpriteStyle(ratedFirst) || ratingFromSpriteStyle(ratedSecond);
        if (spriteRating != null && spriteRating > 0) return spriteRating;
      }
    }
    var labelM = (body || '').match(/id=["']rating_label["'][^>]*>\s*(?:You(?:r)?\s+(?:rated|rating)|Rated):\s*([0-9.]+)/i);
    if (labelM) {
      var labelRating = parseFloat(labelM[1]);
      if (!isNaN(labelRating) && labelRating > 0) return labelRating;
    }
    return null;
  }

  function parseRatingAverage(body) {
    var average = scriptVar(body, 'average_rating');
    if (!average) {
      var avgM = (body || '').match(/Average:\s*([0-9.]+)/i);
      if (avgM) average = avgM[1];
    }
    if (average == null || average === '') return null;
    var parsed = parseFloat(average);
    return isNaN(parsed) ? String(average) : parsed.toFixed(2);
  }

  function ratingStateFromBody(body, userRating, message) {
    var apiuidRaw = scriptVar(body, 'apiuid');
    var apiuid = apiuidRaw == null ? -1 : parseInt(apiuidRaw, 10);
    var apikey = scriptVar(body, 'apikey') || '';
    var average = parseRatingAverage(body);
    var count = null;
    var cntM = (body || '').match(/id=["']rating_count["'][^>]*>\s*([^<]+)/i);
    if (cntM) count = cntM[1].trim();
    var loggedIn = !isNaN(apiuid) && apiuid > 0 && !!apikey;
    var parsedUserRating = userRating == null ? parseCurrentUserRating(body) : userRating;
    return {
      isSupported: loggedIn,
      average: average || null,
      count: count || null,
      userRating: parsedUserRating == null ? null : parsedUserRating,
      message: message || (loggedIn ? null : '请先登录 E-Hentai 账号后再打分。')
    };
  }

  function ratingAPIInfo(manga) {
    var body = galleryBody(manga, false);
    var key = galleryKey((manga && (manga.url || manga.id)) || '');
    var gid = scriptVar(body, 'gid') || (key ? key.gid : null);
    var token = scriptVar(body, 'token') || (key ? key.token : null);
    var apiuid = scriptVar(body, 'apiuid');
    var apikey = scriptVar(body, 'apikey');
    var apiURL = scriptVar(body, 'api_url') || (site() + '/api.php');
    return {
      body: body,
      gid: gid,
      token: token,
      apiuid: apiuid,
      apikey: apikey,
      apiURL: apiURL
    };
  }

  // E-Hentai 收藏分类在列表里常用边框颜色标记。颜色来自站点固定 10 色；
  // 解析不到时不填，不影响普通列表展示。
  var FAVORITE_BORDER_COLORS = ['000', 'f00', 'fa0', 'dd0', '080', '9f4', '4bf', '00f', '508', 'e8e'];
  function parseFavoriteCategory(row) {
    var html = row.outerHtml ? row.outerHtml() : '';
    var m = html.match(/border(?:-color)?:\s*#?([0-9a-f]{3,6})/i);
    if (!m) return null;
    var hex = m[1].toLowerCase();
    if (hex.length === 6 && hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) {
      hex = hex[0] + hex[2] + hex[4];
    }
    var idx = FAVORITE_BORDER_COLORS.indexOf(hex.substring(0, 3));
    return idx >= 0 ? idx : null;
  }

  // 从列表行的 .ir 评分条抠星级：站点用精灵图背景位编码评分——
  // x∈{0,-16,…,-80} 每 16px 少一星(满 5 星)，y=-21 再减半星（红星/半星）。返回如 "4.5"。
  function parseListRating(row) {
    var ir = row.selectFirst('.ir');
    if (!ir) return null;
    var style = ir.attr('style') || '';
    var m = style.match(/background-position:\s*(-?\d+)px\s+(-?\d+)px/i);
    if (!m) return null;
    var x = Math.abs(parseInt(m[1], 10));
    var y = parseInt(m[2], 10);
    var stars = 5 - x / 16;
    if (y === -21) stars -= 0.5;
    if (stars < 0) stars = 0;
    return stars.toFixed(1);
  }

  function parseToplistRank(row) {
    var cells = row.select('td');
    var rankCell = row.selectFirst('td.pso') || (cells.length ? cells[0] : null);
    if (!rankCell) return null;
    var m = (rankCell.text() || '').match(/#\s*\d+/);
    return m ? m[0].replace(/\s+/g, '') : null;
  }

  function parseToplistScore(row) {
    var cells = row.select('td');
    var rankCell = row.selectFirst('td.pso') || (cells.length ? cells[0] : null);
    if (!rankCell) return null;
    var text = (rankCell.text() || '').replace(/\s+/g, ' ').trim();
    var m = text.match(/#\s*\d+\s+([0-9][0-9,]*)/);
    return m ? m[1] : null;
  }

  // 解析一页列表（兼容默认的 Compact 表格布局，及 Thumbnail 卡片布局兜底）。
  function parseList(doc) {
    var rows = doc.select('table.itg tr');
    if (rows.length === 0) rows = doc.select('.itg .gl1t');
    var out = [];
    var seen = {};
    rows.forEach(function (row) {
      // 用 select('a')+正则挑画廊链接，避开 CSS 属性选择器对带 "/" 取值的解析歧义。
      var a = null;
      var anchors = row.select('a');
      for (var ai = 0; ai < anchors.length; ai++) {
        if (/\/g\/\d+\/[0-9a-f]+/.test(anchors[ai].attr('href') || '')) { a = anchors[ai]; break; }
      }
      if (!a) return;
      var key = galleryKey(a.attr('href'));
      if (!key || seen[key.id]) return;
      seen[key.id] = true;
      var title = textOf(row, '.glink') || a.text().trim();
      var img = row.selectFirst('.glthumb img') || row.selectFirst('img');
      var cover = img ? (img.attr('data-src') || img.attr('abs:src') || img.attr('src')) : null;
      var cat = textOf(row, '.gl1c .cn') || textOf(row, '.cn');

      // 列表态（P2 紧凑视图）要的轻量元数据，列表 HTML 里就有，无需逐本拉详情：
      // 评分(.ir 背景位推星级) / 页数 / 上传者 / 发布时间。缺啥省啥，塞进 info 弹性袋。
      var info = {};
      if (cat) info.category = cat;
      var rating = parseListRating(row);
      if (rating) info.rating = rating;
      var rowText = row.text() || '';
      var pagesM = rowText.match(/(\d+)\s*pages/i);
      if (pagesM) info.pages = pagesM[1];
      var sizeM = rowText.match(/([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:KiB|MiB|GiB|KB|MB|GB))/i);
      if (sizeM) info.fileSize = sizeM[1];
      var upA = null;
      var as2 = row.select('a');
      for (var ui = 0; ui < as2.length; ui++) {
        if (/\/uploader\//.test(as2[ui].attr('href') || '')) { upA = as2[ui]; break; }
      }
      if (upA) { var up = upA.text().trim(); if (up) info.uploader = up; }
      var postedEl = row.selectFirst('[id^="posted_"]') || row.selectFirst('.glstats .gl_posted');
      if (postedEl) { var pd = postedEl.text().trim(); if (pd) info.posted = pd; }
      var favcat = parseFavoriteCategory(row);
      if (favcat != null) info.favcat = String(favcat);
      var rank = parseToplistRank(row);
      if (rank) info.rank = rank;
      var score = parseToplistScore(row);
      if (score) info.score = score;
      var tags = parseListTags(row);
      var watchedTags = parseListWatchedTags(row);
      if (watchedTags.length) info.watchedTags = watchedTags.join('\u001f');
      var language = null;
      for (var ti = 0; ti < tags.length; ti++) {
        var lm = tags[ti].match(/^language:(.+)$/i);
        if (lm) { language = lm[1]; break; }
      }
      if (language) info.language = language;

      out.push({
        id: key.id,
        url: key.url,
        title: title,
        coverURL: cover || null,
        genres: cat ? [cat] : [],
        status: 'completed',
        tags: tags.length ? tags : null,
        info: Object.keys(info).length ? info : null
      });
    });
    return out;
  }

  function normalizeListTag(raw) {
    raw = (raw || '').replace(/\+/g, ' ').trim();
    if (!raw) return '';
    raw = raw.replace(/^(f|m):/i, function (_, ns) {
      return ns.toLowerCase() === 'f' ? 'female:' : 'male:';
    });
    return raw;
  }

  function parseListTags(row) {
    var out = [];
    var seen = {};
    row.select('.gt, .gtl, .gtw').forEach(function (tagEl) {
      var raw = normalizeListTag(tagEl.attr('title') || tagEl.text());
      if (!raw) return;
      if (raw.indexOf(':') < 0) raw = 'other:' + raw;
      if (!seen[raw]) {
        seen[raw] = true;
        out.push(raw);
      }
    });
    return out;
  }

  function parseListWatchedTags(row) {
    var out = [];
    var seen = {};
    row.select('.gtw').forEach(function (tagEl) {
      var raw = normalizeListTag(tagEl.attr('title') || tagEl.text());
      if (!raw) return;
      if (raw.indexOf(':') < 0) raw = 'other:' + raw;
      if (!seen[raw]) {
        seen[raw] = true;
        out.push(raw);
      }
    });
    return out;
  }

  function toplistLabel(period) {
    switch (String(period || '11')) {
      case '12': return '年榜';
      case '13': return '月榜';
      case '15': return '昨日榜';
      case '11':
      default: return '总榜';
    }
  }

  function normalizeToplistPeriod(period) {
    period = String(period || '11');
    return /^(11|12|13|15)$/.test(period) ? period : '11';
  }

  function filterValueMap(filters) {
    var out = {};
    (filters || []).forEach(function (filter) {
      if (!filter || !filter.key) return;
      var value = filter.value;
      if (value == null) return;
      value = String(value).trim();
      if (!value) return;
      out[String(filter.key)] = value;
    });
    return out;
  }

  function truthyFilter(value) {
    value = String(value || '').toLowerCase();
    return value === '1' || value === 'true' || value === 'on' || value === 'yes';
  }

  function appendParam(parts, key, value) {
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }

  function appendPositiveIntParam(parts, filters, key) {
    var n = parseInt(filters[key], 10);
    if (!isNaN(n) && n > 0) {
      appendParam(parts, key, Math.min(n, 9999));
      return true;
    }
    return false;
  }

  function buildSearchURL(query, filters) {
    query = (query || '').trim();
    filters = filterValueMap(filters);
    var parts = [];
    var usesAdvancedSearch = false;

    if (query) appendParam(parts, 'f_search', query);

    var cats = parseInt(filters.f_cats, 10);
    if (!isNaN(cats) && cats > 0) appendParam(parts, 'f_cats', cats & 1023);

    ['f_sh', 'f_sto', 'f_sfl', 'f_sfu', 'f_sft'].forEach(function (key) {
      if (!truthyFilter(filters[key])) return;
      appendParam(parts, key, 'on');
      usesAdvancedSearch = true;
    });

    if (appendPositiveIntParam(parts, filters, 'f_spf')) usesAdvancedSearch = true;
    if (appendPositiveIntParam(parts, filters, 'f_spt')) usesAdvancedSearch = true;

    var rating = parseInt(filters.f_srdd, 10);
    if (!isNaN(rating) && rating >= 2 && rating <= 5) {
      appendParam(parts, 'f_srdd', rating);
      usesAdvancedSearch = true;
    }

    if (usesAdvancedSearch) parts.unshift('advsearch=1');
    return parts.length ? site() + '/?' + parts.join('&') : null;
  }

  function buildFavoritesURL(page, category, query, sort) {
    var parts = [];
    var cat = parseInt(category, 10);
    if (!isNaN(cat) && cat >= 0) appendParam(parts, 'favcat', cat);
    var q = (query || '').trim();
    if (q) appendParam(parts, 'f_search', q);
    var inlineSet = String(sort || '').trim();
    if (inlineSet) appendParam(parts, 'inline_set', inlineSet);
    if (page > 1) appendParam(parts, 'page', page);
    return parts.length ? site() + '/favorites.php?' + parts.join('&') : site() + '/favorites.php';
  }

  function watchedCategoryMask(category) {
    category = String(category || '').trim();
    if (!category || category === 'all') return null;
    var found = null;
    EH_CATEGORIES.forEach(function (cat) {
      if (found != null) return;
      if (String(cat.id) === category || cat.en.toLowerCase() === category.toLowerCase() || cat.zh === category) {
        found = EH_ALL_CATEGORY_MASK ^ cat.id;
      }
    });
    return found;
  }

  function buildWatchedURL(query, category) {
    var parts = [];
    var q = (query || '').trim();
    if (q) appendParam(parts, 'f_search', q);
    var cats = watchedCategoryMask(category);
    if (cats != null) appendParam(parts, 'f_cats', cats & EH_ALL_CATEGORY_MASK);
    return parts.length ? site() + '/watched?' + parts.join('&') : site() + '/watched';
  }

  function fetchListDocument(url) {
    var lastRes = null;
    var lastDoc = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      // The public root and /?page=0 are equivalent canonical first pages. If
      // the root is intercepted by a transient site-navigation document, retry
      // the explicit page URL once without changing the authenticated session.
      var requestURL = attempt === 1 && url === site() + '/'
        ? site() + '/?page=0'
        : url;
      var res = fetch(requestURL, listHeaders());
      var doc = parseHTML(res.body || '', site());
      lastRes = res;
      lastDoc = doc;
      var classification = classifyHTMLResponse(res, doc, '列表');
      if (classification === 'gallery-list' || classification === 'empty-list') {
        return doc;
      }
    }
    throw new Error(invalidHTMLMessage('列表', lastRes, lastDoc));
  }

  // 游标分页：page 1 取 baseURL；page>1 取上一页存下的 a#unext 链接。
  // 站点自带 a#unext 的 href 即“下一页”完整地址（含 ?next=<gid>），直接复用最稳。
  function listPage(ctx, baseURL, page) {
    var url = baseURL;
    if (page > 1) {
      var saved = storage.get(transientKey('next:' + ctx + ':' + page));
      if (!saved) return { items: [], hasNextPage: false };
      url = saved;
    }
    var doc = fetchListDocument(url);
    var items = parseList(doc);
    var nextA = doc.selectFirst('a#unext') || doc.selectFirst('a#dnext');
    var nextHref = nextA ? (nextA.attr('href') || '') : '';
    var hasNext = !!(nextHref && items.length > 0);
    if (hasNext) storage.set(transientKey('next:' + ctx + ':' + (page + 1)), nextHref);
    var result = { items: items, hasNextPage: hasNext };
    if (ctx.indexOf('favorites:') === 0) result.metadata = favoriteCategoriesMetadata(doc);
    if (page === 1 && ctx.indexOf('watched:') === 0) {
      var watchedState = fetchUserTagsState(null);
      if (watchedState.isSupported) {
        var watchedCount = watchedState.tags.filter(function (tag) { return tag.isWatched; }).length;
        result.metadata = { watchedTagCount: String(watchedCount) };
      }
    }
    return result;
  }

  function toplistPage(page, period) {
    period = normalizeToplistPeriod(period);
    var p = Math.max(1, parseInt(page, 10) || 1);
    var url = toplistSite() + '/toplist.php?tl=' + encodeURIComponent(period);
    if (p > 1) url += '&p=' + (p - 1);
    var res = fetch(url, headers());
    var doc = parseHTML(res.body, toplistSite());
    var items = parseList(doc);
    var label = toplistLabel(period);
    items.forEach(function (item) {
      var info = item.info || {};
      info.toplist = label;
      item.info = info;
    });
    var nextHref = '';
    doc.select('table.ptt a, table.ptb a').forEach(function (a) {
      if (nextHref) return;
      if ((a.text() || '').trim() !== '>') return;
      nextHref = a.attr('href') || '';
    });
    return { items: items, hasNextPage: !!(nextHref && items.length > 0) };
  }

  // 画廊页/查看页里所有 /s/<key>/<gid>-<n> 查看页链接。
  function appendViewerLink(out, seen, href) {
    href = href || '';
    if (!/\/s\/[0-9a-f]+\/\d+-\d+/.test(href) || seen[href]) return;
    seen[href] = true;
    out.push(href);
  }

  function collectViewerLinks(doc) {
    var out = [];
    var seen = {};
    doc.select('a').forEach(function (a) {
      var href = a.attr('abs:href') || a.attr('href') || '';
      appendViewerLink(out, seen, href);
    });
    return out;
  }

  // 只数真正的缩略图项。画廊页上还可能有其它 /s/ 链接；如果把那些也算进 perPage，
  // 惰性页表会把后面的页分到错误的 ?p=k，进而把缩略页 HTML 当成查看页解析。
  function collectThumbnailViewerLinks(doc) {
    var out = [];
    var seen = {};
    ['#gdt .gdtm a', '#gdt .gdtl a', '.gdtm a', '.gdtl a', '#gdt a'].forEach(function (selector) {
      doc.select(selector).forEach(function (a) {
        var href = a.attr('abs:href') || a.attr('href') || '';
        appendViewerLink(out, seen, href);
      });
    });
    return out.length ? out : collectViewerLinks(doc);
  }

  function thumbnailPreview(a) {
    var img = a.selectFirst('img');
    var imageURL = img ? (img.attr('data-src') || img.attr('abs:src') || img.attr('src') || '') : '';
    imageURL = abs(imageURL);
    if (imageURL && !/blank\.(?:gif|png|webp)(?:$|[?#])/i.test(imageURL)) {
      return { url: imageURL, crop: null };
    }

    var result = null;
    a.select('[style]').forEach(function (element) {
      if (result) return;
      var style = element.attr('style') || '';
      var urlM = style.match(/\bbackground\s*:[^;]*?url\((?:['"]?)(https?:\/\/[^)'"]+)(?:['"]?)\)/i);
      var widthM = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px\b/i);
      var heightM = style.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\b/i);
      var positionM = style.match(/\)\s*(-?\d+(?:\.\d+)?)(?:px)?\s+(-?\d+(?:\.\d+)?)(?:px)?\b/i);
      if (!urlM || !widthM || !heightM || !positionM) return;
      var width = Math.round(parseFloat(widthM[1]));
      var height = Math.round(parseFloat(heightM[1]));
      var x = Math.max(0, Math.round(-parseFloat(positionM[1])));
      var y = Math.max(0, Math.round(-parseFloat(positionM[2])));
      if (!width || !height) return;
      result = {
        url: abs(urlM[1]),
        crop: { x: x, y: y, width: width, height: height }
      };
    });
    return result;
  }

  // 首张画廊页已经含有 /s/ 与对应缩略图。现代 E-Hentai 把约 20 页横向打包在一张
  // CSS sprite 中，因此同时下发每页的 background-position 裁剪区域。
  function collectThumbnailPages(doc) {
    var out = {};
    var seen = {};
    ['#gdt .gdtm a', '#gdt .gdtl a', '.gdtm a', '.gdtl a', '#gdt a'].forEach(function (selector) {
      doc.select(selector).forEach(function (a) {
        var href = a.attr('abs:href') || a.attr('href') || '';
        var key = viewerKey(href);
        if (!key || seen[key.page]) return;
        seen[key.page] = true;
        var preview = thumbnailPreview(a);
        out[key.page - 1] = {
          viewerURL: abs(href),
          previewURL: preview ? preview.url : null,
          previewCrop: preview ? preview.crop : null
        };
      });
    });
    return out;
  }

  function galleryPerPage(body, fallbackCount) {
    var m = (body || '').match(/Showing\s+(\d+)\s*[-–—]\s*(\d+)\s+of\b/i);
    if (m) {
      var start = parseInt(m[1], 10);
      var end = parseInt(m[2], 10);
      var count = end - start + 1;
      if (count > 0) return count;
    }
    return fallbackCount || 20;
  }

  function isViewerURL(u) {
    return /\/s\/[0-9a-f]+\/\d+-\d+/.test(u || '');
  }

  // 惰性页表下，getImageURL(s)（下载路径）拿到的页 url 是「缩略页」(?p=k) 地址，不是 /s/。
  // 这里把一批页的 url 批量解析成各页的 /s/ 查看页地址：已是 /s/ 的直接用；其余按缩略页去重
  // 并发抓，从中抠出 /s/ 链接按页号(1 起)归位到 index(0 起)。返回 {index: sURL}。
  function resolveViewerURLs(pages) {
    var out = {};
    var thumbs = {};
    pages.forEach(function (p) {
      if (isViewerURL(p.url)) out[p.index] = p.url;
      else if (p.url) thumbs[p.url] = true;
    });
    var turls = Object.keys(thumbs);
    if (turls.length) {
      var ress = fetchAll(turls, headers());
      for (var i = 0; i < ress.length; i++) {
        if (ress[i] && !ress[i].error && ress[i].body) {
          collectThumbnailViewerLinks(parseHTML(ress[i].body, site())).forEach(function (s) {
            var m = s.match(/\/s\/[0-9a-f]+\/\d+-(\d+)/);
            if (m) out[parseInt(m[1], 10) - 1] = s;
          });
        }
      }
    }
    return out;
  }

  function parseGalleryComments(doc) {
    var blocks = doc.select('#cdiv .c1');
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var c3 = b.selectFirst('.c3');
      var c6 = b.selectFirst('.c6');
      if (!c6) continue;
      var spans = parseCommentSpans(c6.html());
      var body = spans
        ? spans.map(function (sp) { return sp.text; }).join('')
        : c6.text().trim();
      if (!body) continue;
      var authorEl = c3 ? c3.selectFirst('a') : null;
      var author = authorEl ? authorEl.text().trim() : (c3 ? c3.text().trim() : '匿名');
      var dateText = c3 ? c3.text().trim() : null;
      var c5 = b.selectFirst('.c5');
      var score = c5 ? (c5.text().trim() || null) : null;
      var id = b.attr('id') || ('c' + i);
      out.push({
        id: id,
        author: author,
        dateText: dateText,
        body: body,
        spans: spans,
        score: score,
        isUploader: !score && i === 0
      });
    }
    return out;
  }

  function findCommentForm(doc) {
    var forms = doc.select('form');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var html = form.outerHtml ? form.outerHtml() : '';
      var text = form.text() || '';
      var area = form.selectFirst('textarea[name*="comment"], textarea#commenttext_new, textarea[name], textarea');
      if (area && /comment|评论/i.test(html + ' ' + text)) return form;
    }
    return null;
  }

  function submitCommentForm(manga, text) {
    var body = galleryBody(manga, false);
    var doc = parseHTML(body, site());
    var comments = parseGalleryComments(doc);
    var trimmed = (text || '').replace(/^\s+|\s+$/g, '');
    if (!trimmed) {
      return { isSupported: true, didSubmit: false, message: '评论不能为空', comments: comments };
    }

    var form = findCommentForm(doc);
    if (!form) {
      var needsLogin = /login|log\s*in|sign\s*in|must\s+be\s+logged/i.test(body || '');
      return {
        isSupported: false,
        didSubmit: false,
        message: needsLogin ? '请先登录 E-Hentai 账号后再发表评论。' : '没有找到评论提交入口，可能站点页面结构已变更。',
        comments: comments
      };
    }

    var fields = extractSuccessfulFormFields(form);
    // 官网的新评论接口不是 API JSON，也不应跟随 form 的 `action="#cnew"`。
    // 画廊 HTML 的解析基址是站点首页，若把该 fragment 做 abs 解析，会错误 POST 到首页。
    // 官方客户端同样把 `commenttext_new` 直接表单 POST 回当前画廊 URL。
    fields.commenttext_new = trimmed;
    var url = abs(manga.url).replace(/#.*$/, '');
    var res = fetch(url, { headers: formHeaders(), method: 'POST', body: formEncode(fields) });
    _galleryCache = { id: null, body: null };
    var nextDoc = parseHTML(res.body || '', site());
    var nextComments = parseGalleryComments(nextDoc);
    var accepted = nextComments.some(function (comment) {
      return String(comment.body || '').replace(/^\s+|\s+$/g, '') === trimmed;
    });
    var responseText = cleanSnippetText(res.body || '');
    var explicitSuccess = /comment\s+(?:has\s+been\s+)?(?:posted|added)|successfully\s+(?:posted|added)|评论.{0,8}(?:成功|已发布)/i.test(responseText);
    if (!accepted && !explicitSuccess) {
      var error = null;
      var errorNode = nextDoc.selectFirst('#chd + p, .d, .error, .messagebox');
      if (errorNode) error = cleanSnippetText(errorNode.text() || '');
      return {
        isSupported: true,
        didSubmit: false,
        message: error || '评论未被站点接受，请稍后重试。',
        comments: nextComments.length ? nextComments : comments
      };
    }
    return {
      isSupported: true,
      didSubmit: true,
      message: '已发送评论',
      comments: nextComments.length ? nextComments : null
    };
  }

  function globalTorrentsURL(page, query, status, mineOnly) {
    var parts = [];
    var sitePage = Math.max(0, (parseInt(page, 10) || 1) - 1);
    if (sitePage > 0) appendParam(parts, 'page', sitePage);
    query = String(query || '').trim();
    if (query) appendParam(parts, 'search', query);
    if (status === 'seeded' || status === 'unseeded') appendParam(parts, 's', status);
    if (mineOnly) appendParam(parts, 'u', storage.get(transientKey('torrent_user_filter')) || 'on');
    return 'https://e-hentai.org/torrents.php' + (parts.length ? '?' + parts.join('&') : '');
  }

  function parseGlobalTorrents(body, page) {
    var doc = parseHTML(body || '', 'https://e-hentai.org');
    var userFilter = doc.selectFirst('#torrentform input#u, #torrentform input[name="u"]');
    if (userFilter) {
      var userFilterValue = (userFilter.attr('value') || '').trim();
      if (userFilterValue) storage.set(transientKey('torrent_user_filter'), userFilterValue);
    }
    var items = [];
    var seen = {};
    doc.select('table.itg tr').forEach(function (row) {
      var cells = row.select('td');
      if (cells.length < 8) return;
      var torrentAnchor = cells[1].selectFirst('a[href*="gallerytorrents.php"]');
      if (!torrentAnchor) return;
      var detailsURL = torrentAnchor.attr('abs:href') || torrentAnchor.attr('href') || '';
      if (!detailsURL || seen[detailsURL]) return;
      seen[detailsURL] = true;
      var galleryAnchor = cells[2].selectFirst('a[href*="/g/"]');
      var galleryURL = galleryAnchor ? (galleryAnchor.attr('abs:href') || galleryAnchor.attr('href') || '') : '';
      var galleryID = galleryAnchor ? (galleryAnchor.text() || '').trim() : '';
      var seeds = (cells[4].text() || '').trim();
      var seedCount = parseInt(seeds, 10);
      items.push({
        id: detailsURL,
        name: (torrentAnchor.text() || '').trim() || '种子',
        galleryID: galleryID || null,
        galleryURL: galleryURL || null,
        detailsURL: detailsURL,
        size: (cells[3].text() || '').trim() || null,
        seeds: seeds || null,
        peers: (cells[5].text() || '').trim() || null,
        downloads: (cells[6].text() || '').trim() || null,
        dateText: (cells[0].text() || '').trim() || null,
        uploader: (cells[7].text() || '').trim() || null,
        isStale: !isNaN(seedCount) && seedCount <= 0
      });
    });

    var total = null;
    var summary = textOf(doc, 'p.ip');
    var totalMatch = summary.match(/(?:of|共)\s*([0-9,]+)/i);
    if (totalMatch) total = totalMatch[1];
    var currentPage = parseInt(page, 10) || 1;
    var hasNextPage = false;
    doc.select('a[href*="torrents.php?page="]').forEach(function (anchor) {
      var href = anchor.attr('href') || '';
      var match = href.match(/[?&]page=(\d+)/);
      if (match && parseInt(match[1], 10) >= currentPage) hasNextPage = true;
    });
    return {
      items: items,
      hasNextPage: hasNextPage,
      metadata: total ? { total: total } : null
    };
  }

  function accountMetric(id, title, value) {
    value = cleanSnippetText(value || '');
    return value ? { id: id, title: title, value: value } : null;
  }

  function firstMatch(text, pattern, group) {
    var match = String(text || '').match(pattern);
    return match ? cleanSnippetText(match[group || 1] || '') : null;
  }

  function parseAccountOverview(body) {
    var doc = parseHTML(body || '', 'https://e-hentai.org');
    var plain = cleanSnippetText(body || '');
    if (!body || /name=["']ipb_login_submit|Login!|You must be logged/i.test(body)) {
      return { isSupported: false, sections: [], message: '请先登录 E-Hentai 账号。' };
    }

    var sections = [];
    var quotaMetrics = [];
    var homebox = doc.selectFirst('div.homebox');
    var strong = homebox ? homebox.select('p > strong') : [];
    if (strong.length >= 3) {
      quotaMetrics.push(accountMetric('quota_current', '当前使用', strong[0].text()));
      quotaMetrics.push(accountMetric('quota_limit', '账户上限', strong[1].text()));
      quotaMetrics.push(accountMetric('quota_reset', '重置费用', strong[2].text() + ' GP'));
    } else {
      quotaMetrics.push(accountMetric('quota_current', '当前使用', firstMatch(plain, /Current\s*:\s*([0-9,]+)/i)));
      quotaMetrics.push(accountMetric('quota_limit', '账户上限', firstMatch(plain, /(?:account\s+limit\s+is|Limit\s*:)\s*([0-9,]+)/i)));
      quotaMetrics.push(accountMetric('quota_reset', '重置费用', firstMatch(plain, /Reset[^0-9]{0,40}([0-9,]+\s*GP)/i)));
    }
    quotaMetrics = quotaMetrics.filter(function (metric) { return !!metric; });
    if (quotaMetrics.length) sections.push({ id: 'image_quota', title: '图像配额', metrics: quotaMetrics });

    var fundsResult = archiveAccountFundsFallbackResult();
    if (fundsResult && fundsResult.funds) {
      var money = String(fundsResult.funds).split(/\s*[·|]\s*/);
      var fundsMetrics = money.map(function (value, index) {
        return accountMetric('funds_' + index, /Credits/i.test(value) ? 'Credits' : 'GP', value);
      }).filter(function (metric) { return !!metric; });
      if (fundsMetrics.length) sections.push({ id: 'funds', title: '账户资金', metrics: fundsMetrics });
    }

    var torrentMetrics = [
      accountMetric('torrent_uploaded', '上传量', firstMatch(plain, /([0-9.,]+\s*(?:B|KiB|MiB|GiB|TiB))\s+Uploaded/i)),
      accountMetric('torrent_downloaded', '下载量', firstMatch(plain, /([0-9.,]+\s*(?:B|KiB|MiB|GiB|TiB))\s+Downloaded/i)),
      accountMetric('torrent_ratio', '分享率', firstMatch(plain, /([0-9.\-]+)\s+(?:Share\s+)?Ratio/i)),
      accountMetric('torrent_completed', '完成种子', firstMatch(plain, /([0-9,]+)\s+Completed\s+Torrents?/i)),
      accountMetric('gallery_completed', '完成画廊', firstMatch(plain, /([0-9,]+)\s+Completed\s+Galleries/i)),
      accountMetric('seed_minutes', '做种时长', firstMatch(plain, /([0-9,]+)\s+Seed\s+Minutes/i))
    ].filter(function (metric) { return !!metric; });
    if (torrentMetrics.length) sections.push({ id: 'torrent_stats', title: '种子统计', metrics: torrentMetrics });

    var gpMetrics = [];
    var gpPatterns = [
      ['gp_browsing', '画廊浏览', /([0-9,]+\s*GP)\s+from\s+Gallery\s+Browsing/i],
      ['gp_torrents', '完成种子', /([0-9,]+\s*GP)\s+from\s+Torrent\s+Completions?/i],
      ['gp_archives', '档案下载', /([0-9,]+\s*GP)\s+from\s+Archive\s+Downloads?/i],
      ['gp_hath', 'Hentai@Home', /([0-9,]+\s*GP)\s+from\s+Hentai@Home/i]
    ];
    gpPatterns.forEach(function (entry) {
      var metric = accountMetric(entry[0], entry[1], firstMatch(plain, entry[2]));
      if (metric) gpMetrics.push(metric);
    });
    if (gpMetrics.length) sections.push({ id: 'gp_gained', title: '获得的 GP', metrics: gpMetrics });

    var toplistMetrics = [];
    var toplistText = firstMatch(plain, /Toplists?\s+([\s\S]{0,260}?)(?=(?:Moderation|Mod)\s+Power|$)/i);
    if (toplistText) {
      if (/not\s+(?:currently\s+)?on\s+(?:any\s+)?toplists?|没有上榜/i.test(toplistText)) {
        toplistMetrics.push(accountMetric('toplist_status', '当前排名', '暂无上榜'));
      } else {
        var toplistMatches = toplistText.match(/(?:^|\s)([A-Za-z][A-Za-z /@&-]{2,32})\s+#?([0-9,]+)/g) || [];
        toplistMatches.slice(0, 8).forEach(function (entry, index) {
          var match = entry.match(/\s*([A-Za-z][A-Za-z /@&-]{2,32})\s+#?([0-9,]+)/);
          if (match) toplistMetrics.push(accountMetric('toplist_' + index, cleanSnippetText(match[1]), '#' + match[2]));
        });
        if (!toplistMetrics.length) toplistMetrics.push(accountMetric('toplist_status', '当前排名', toplistText));
      }
    }
    if (toplistMetrics.length) sections.push({ id: 'toplists', title: '排行', metrics: toplistMetrics });

    var moderationText = firstMatch(plain, /(?:Moderation|Mod)\s+Power\s+([\s\S]{0,700})/i);
    if (moderationText) {
      var moderationMetrics = [];
      var moderationPatterns = [
        ['moderation_current', '当前愿力', /Current\s+(?:Mod(?:eration)?\s+)?Power\s*:?\s*([0-9.]+)/i],
        ['moderation_base', '基础', /Base\s*([+-]\s*[0-9.]+)/i],
        ['moderation_awards', '奖励', /Awards?\s*([+-]\s*[0-9.]+)/i],
        ['moderation_tagging', '标签贡献', /Tagging\s*([+-]\s*[0-9.]+)/i],
        ['moderation_level', '等级', /Level\s*([+-]\s*[0-9.]+)/i],
        ['moderation_donations', '捐赠', /Donations?\s*([+-]\s*[0-9.]+)/i],
        ['moderation_forum', '论坛活跃', /Forum\s+Activity\s*([+-]\s*[0-9.]+)/i],
        ['moderation_uploads', '上传 / H@H', /Uploads?\s*\/\s*H@H\s*([+-]\s*[0-9.]+)/i],
        ['moderation_age', '账户资历', /Account\s+Age\s*([+-]\s*[0-9.]+)/i]
      ];
      moderationPatterns.forEach(function (entry) {
        var value = firstMatch(moderationText, entry[2]);
        if (value) moderationMetrics.push(accountMetric(entry[0], entry[1], value.replace(/\s+/g, '')));
      });
      var cappedTotal = firstMatch(moderationText, /(?:capped|maximum|不超过)[^=]{0,30}=\s*([0-9.]+)/i);
      if (cappedTotal) moderationMetrics.push(accountMetric('moderation_calculated', '资历项合计（上限 25）', cappedTotal));
      if (moderationMetrics.length) sections.push({ id: 'moderation_power', title: '愿力', metrics: moderationMetrics });
    }

    return {
      isSupported: sections.length > 0,
      sections: sections,
      message: sections.length ? null : '官网没有返回可识别的账户概览，请确认账号状态。'
    };
  }

  globalThis.__source = {
    // 热门：站点的 /popular 快照页（单页，无分页）。
    getPopular: function (page) {
      return listPage('popular', site() + '/popular', page);
    },

    // 最新：首页按 gid 倒序，即最新上传；游标翻页。
    getLatest: function (page) {
      return listPage('latest', site() + '/', page);
    },

    // 订阅流：站点按账号 My Tags 的 watched 标签过滤，列表结构与首页一致。
    getWatched: function (page, query, category) {
      return listPage('watched:' + (query || '') + ':' + (category || 'all'), buildWatchedURL(query, category), page);
    },

    search: function (page, query, filters) {
      var base = buildSearchURL(query, filters);
      if (!base) return this.getLatest(page);
      return listPage('search:' + base, base, page);
    },

    getFavorites: function (page, category, query, sort) {
      var base = buildFavoritesURL(page, category, query, sort);
      return listPage('favorites:' + (category == null ? 'all' : String(category)), base, page);
    },

    getToplist: function (page, period) {
      return toplistPage(page, period);
    },

    getMangaDetails: function (manga) {
      var body = galleryBody(manga);
      var res = { body: body };
      var doc = parseHTML(body, site());

      var en = textOf(doc, '#gn');
      var jp = textOf(doc, '#gj');
      var title = jp || en || manga.title;

      // 封面是 #gd1 内 div 的 background-image，不是 <img>。
      var cover = manga.coverURL || null;
      var coverEl = doc.selectFirst('#gd1 div') || doc.selectFirst('#gd1 img');
      if (coverEl) {
        var style = coverEl.attr('style') || '';
        var styledCover = cssURL(style);
        if (styledCover) cover = styledCover;
        else cover = coverEl.attr('abs:src') || coverEl.attr('src') || cover;
      }

      var category = textOf(doc, '#gdc .cs') || textOf(doc, '#gdc .cn') || textOf(doc, '#gdc');
      var uploader = textOf(doc, '#gdn a') || textOf(doc, '#gdn');

      // 带命名空间的**原始**标签：直接从 #taglist 锚点的 href `/tag/<ns>:<key>` 抠 `ns:key`，
      // 站点把空格编码成 '+'，还原成空格（如 female:big+breasts → "female:big breasts"），对齐
      // EhTagTranslation 词库的键。汉化留给 App 侧，这里只吐原始值；去重保序。
      var tags = [];
      var tseen = {};
      doc.select('#taglist a').forEach(function (t) {
        var href = t.attr('href') || '';
        var m = href.match(/\/tag\/([a-z]+:[^"?#&]+)/i);
        if (!m) return;
        var raw = m[1].replace(/\+/g, ' ').trim();
        if (raw && !tseen[raw]) { tseen[raw] = true; tags.push(raw); }
      });

      // 扁平 genres（列表卡/兜底展示用）：分类 + 各标签的显示文本。
      var genres = [];
      if (category) genres.push(category);
      doc.select('#taglist a').forEach(function (t) {
        var v = t.text().trim();
        if (v) genres.push(v);
      });

      // #gdd 元数据表：<td class="gdt1">Label:</td><td class="gdt2">VALUE</td>。
      function gddValue(label) {
        var result = null;
        doc.select('#gdd tr').forEach(function (row) {
          if (result) return;
          var name = textOf(row, '.gdt1').replace(/:$/, '').trim().toLowerCase();
          if (name !== label.toLowerCase()) return;
          var value = textOf(row, '.gdt2').replace(/\s+/g, ' ').trim();
          if (value) result = value;
        });
        if (result) return result;
        var re = new RegExp('gdt1[^>]*>\\s*' + label + ':?\\s*</td>\\s*<td[^>]*gdt2[^>]*>([^<]+)', 'i');
        var mm = res.body.match(re);
        return mm ? mm[1].replace(/&nbsp;/g, '').trim() : null;
      }
      var lenM = res.body.match(/Length[\s\S]{0,40}?(\d+)\s*pages/i);
      var ratingM = res.body.match(/Average:\s*([0-9.]+)/);

      // 元数据弹性键值袋：评分/语言/体积/页数/发布时间/上传者/分类，详情页有序展示。
      var info = {};
      if (category) info.category = category;
      if (uploader) info.uploader = uploader;
      if (ratingM) info.rating = ratingM[1];
      var lang = gddValue('Language'); if (lang) info.language = lang;
      var fsize = gddValue('File Size'); if (fsize) info.fileSize = fsize;
      var posted = gddValue('Posted'); if (posted) info.posted = posted;
      var parent = gddValue('Parent'); if (parent) info.parent = parent;
      var visible = gddValue('Visible'); if (visible) info.visible = visible;
      var favorites = gddValue('Favorited'); if (favorites) info.favorites = favorites;
      if (lenM) info.pages = lenM[1];

      // 简介：英文/日文双标题 + 页数，便于一眼区分同名画廊。
      var descParts = [];
      if (en && jp && en !== jp) descParts.push(en);
      if (lenM) descParts.push(lenM[1] + ' 页');

      return {
        id: manga.id || manga.url,
        url: manga.url,
        title: title,
        coverURL: cover,
        author: uploader || null,
        artist: null,
        description: descParts.length ? descParts.join(' · ') : null,
        genres: genres,
        status: 'completed',
        tags: tags,
        info: info
      };
    },

    // 列表缩略图只负责首帧。可见卡片随后最多两路并发调用这里，解析画廊第一张
    // 重采样大图作为高清最终封面；失败时 App 会继续保留列表缩略图，不阻塞文字排版。
    getHighResolutionCover: function (manga) {
      var details = this.getMangaDetails(manga);
      var chapters = this.getChapterList(details);
      if (!chapters.length) return details;
      var pages = this.getPageList(chapters[0]);
      if (!pages.length) return details;
      var resolved = this.getImageURL(pages[0], false, 'cover');
      details.highResolutionCoverURL = resolved || details.coverURL || manga.coverURL || null;
      return details;
    },

    // 只读评论（P3）：复用详情那张画廊页（galleryBody 缓存），解析 #cdiv 里的 .c1 评论块。
    // c3=作者+时间、c6=正文、c5=分值。上传者评论(无分值且居首)打标记置顶。
    // 正文走 .html() → parseCommentSpans 保真排版（换行/链接），body 用切片拼接成纯文本兜底。
    getComments: function (manga) {
      return parseGalleryComments(parseHTML(galleryBody(manga), site()));
    },

    submitComment: function (manga, text) {
      return submitCommentForm(manga, text);
    },

    // 种子列表（P4，只读）：抓 gallerytorrents.php?gid&t，逐个 form 解析名称/链接 + 字段。
    getTorrents: function (manga) {
      var key = galleryKey(manga.url);
      if (!key) return [];
      var url = site() + '/gallerytorrents.php?gid=' + key.gid + '&t=' + key.token;
      var res = fetch(url, headers());
      var doc = parseHTML(res.body, site());
      var forms = doc.select('#torrentinfo form');
      if (forms.length === 0) forms = doc.select('form');
      var out = [];
      var seen = {};
      for (var i = 0; i < forms.length; i++) {
        var form = forms[i];
        var a = null;
        var anchors = form.select('a');
        for (var ai = 0; ai < anchors.length; ai++) {
          if (/\.torrent/i.test(anchors[ai].attr('href') || '')) { a = anchors[ai]; break; }
        }
        if (!a) continue;
        var href = a.attr('abs:href') || a.attr('href') || '';
        if (!href || seen[href]) continue;
        seen[href] = true;
        var name = a.text().trim() || '种子';
        // 各字段挨着拼成一行（"Posted: … Size: … Seeds: …"），取本 label 到下一 label/行尾的值。
        // 种子名是 form 文本最后一段，先切掉它，否则最后一个字段（Downloads）会把名字也吞进去。
        var t = form.text() || '';
        var ni = name && t.indexOf(name) >= 0 ? t.indexOf(name) : -1;
        if (ni >= 0) t = t.substring(0, ni);
        function field(label) {
          var m = t.match(new RegExp(label + ':\\s*(\\S[\\s\\S]*?)\\s*(?:Posted:|Size:|Uploader:|Seeds:|Peers:|Downloads:|$)', 'i'));
          return m ? m[1].trim() : null;
        }
        // 坏种判定：做种数为 0 即无人做种、实际下不动 → 标记 isStale，App 侧该行标红。
        var seedsStr = field('Seeds');
        var seedsNum = seedsStr != null ? parseInt(seedsStr, 10) : null;
        var isStale = seedsNum !== null && !isNaN(seedsNum) && seedsNum <= 0;
        out.push({
          id: href,
          name: name,
          size: field('Size'),
          seeds: seedsStr,
          peers: field('Peers'),
          downloads: field('Downloads'),
          dateText: field('Posted'),
          url: href,
          isStale: isStale
        });
      }
      return out;
    },

    // 全站种子索引：列表本身保持原生分页/搜索/状态过滤；点某条时 App 再调用
    // getTorrents 解析该画廊的真实 .torrent 链接，避免列表首屏额外发 50 个请求。
    getGlobalTorrents: function (page, query, status, mineOnly) {
      var url = globalTorrentsURL(page, query, status, !!mineOnly);
      var res = fetch(url, listHeaders());
      return parseGlobalTorrents(res.body || '', page);
    },

    // My Home 只读概览。始终读取主站账户页（里站开关不改变账户级配额/积分），
    // 使用 App 已注入的同一组登录 Cookie，不打开网页。
    getAccountOverview: function () {
      var res = fetch('https://e-hentai.org/home.php', listHeaders());
      return parseAccountOverview(res.body || '');
    },

    getFavoriteState: function (manga) {
      return favoriteStateFromPopup(manga);
    },

    setFavorite: function (manga, category, note) {
      var url = galleryPopupURL(manga);
      if (!url) return { isSupported: false, isFavorited: false, category: null, categories: [], note: null, message: '无法识别画廊地址' };
      var cat = parseInt(category, 10);
      if (isNaN(cat) || cat < 0 || cat > 9) cat = 0;
      var body = formEncode({
        favcat: cat,
        favnote: note || '',
        apply: 'Apply Changes',
        update: '1'
      });
      var res = fetch(url, { headers: formHeaders(), method: 'POST', body: body });
      var doc = parseHTML(res.body, site());
      var state = parseFavoriteStateFromDoc(doc);
      // 提交成功后的弹窗有时只返回短消息，不再带 radio checked；用用户刚选的分类兜底。
      if (state.isSupported || /requested action has been performed|favorite updated|added/i.test(state.message || '')) {
        state.isSupported = true;
        state.isFavorited = true;
        state.category = state.category == null ? cat : state.category;
        state.note = state.note == null ? (note || null) : state.note;
      }
      return state;
    },

    removeFavorite: function (manga) {
      var url = galleryPopupURL(manga);
      if (!url) return { isSupported: false, isFavorited: false, category: null, categories: [], note: null, message: '无法识别画廊地址' };
      var body = formEncode({
        favcat: 'favdel',
        apply: 'Apply Changes',
        update: '1'
      });
      var res = fetch(url, { headers: formHeaders(), method: 'POST', body: body });
      var doc = parseHTML(res.body, site());
      var state = parseFavoriteStateFromDoc(doc);
      if (state.isSupported || /requested action has been performed|favorite updated|removed|deleted/i.test(state.message || '')) {
        state.isSupported = true;
        state.isFavorited = false;
        state.category = null;
      }
      return state;
    },

    getRatingState: function (manga) {
      return ratingStateFromBody(galleryBody(manga, false), null, null);
    },

    setRating: function (manga, rating) {
      var info = ratingAPIInfo(manga);
      var state = ratingStateFromBody(info.body, null, null);
      if (!state.isSupported) return state;
      var score = Math.round((parseFloat(rating) || 0) * 2);
      if (score < 1) score = 1;
      if (score > 10) score = 10;
      var payload = {
        method: 'rategallery',
        apiuid: parseInt(info.apiuid, 10),
        apikey: info.apikey,
        rating: score,
        gid: parseInt(info.gid, 10),
        token: info.token
      };
      if (!payload.gid || !payload.token || !payload.apikey || !payload.apiuid) {
        return { isSupported: false, average: state.average, count: state.count, userRating: null, message: '无法识别画廊评分参数' };
      }
      var res = fetch(info.apiURL, { headers: apiHeaders(), method: 'POST', body: JSON.stringify(payload) });
      try {
        var json = JSON.parse(res.body || '{}');
        if (json.error) {
          return { isSupported: true, average: state.average, count: state.count, userRating: null, message: String(json.error) };
        }
        var nextAverage = json.rating_avg == null ? state.average : String(json.rating_avg);
        var nextCount = json.rating_cnt == null ? state.count : String(json.rating_cnt);
        var nextUserRating = json.rating_usr == null ? score / 2 : parseFloat(json.rating_usr);
        _galleryCache = { id: null, body: null };
        return {
          isSupported: true,
          average: nextAverage,
          count: nextCount,
          userRating: isNaN(nextUserRating) ? score / 2 : nextUserRating,
          message: '已提交评分'
        };
      } catch (e) {
        _galleryCache = { id: null, body: null };
        return { isSupported: true, average: state.average, count: state.count, userRating: score / 2, message: '已提交评分' };
      }
    },

    watchTag: function (tag) {
      var state = this.addUserTag(tag, 'watched', null);
      var found = findUserTag(state, tag);
      return {
        isSupported: state.isSupported,
        isWatched: !!(found && found.isWatched),
        tag: normalizeTag(tag),
        message: state.message
      };
    },

    getUserTags: function () {
      // 原生设置页每次打开/刷新都以官网为准，不复用上次 UI 会话的短缓存。
      return fetchUserTagsState(null, true);
    },

    addUserTag: function (tag, mode, tagSetID) {
      var normalized = normalizeTag(tag);
      if (!normalized) {
        return { isSupported: false, tagSets: [], selectedTagSetID: null, tags: [], message: '标签为空' };
      }
      mode = mode === 'hidden' ? 'hidden' : 'watched';
      var before = fetchUserTagsState(null);
      if (!before.isSupported) return before;
      var existing = findUserTag(before, normalized);
      if (existing && ((mode === 'hidden' && existing.isHidden) || (mode !== 'hidden' && existing.isWatched))) {
        before.message = mode === 'hidden' ? '标签已隐藏' : '标签已订阅';
        return before;
      }
      var selectedTagSetID = tagSetID == null ? before.selectedTagSetID : tagSetID;
      var fields = buildAddUserTagFields(normalized, mode);
      var postResult = postMyTags(fields, selectedTagSetID);
      var after = fetchUserTagsState(null, true);
      var saved = findUserTag(after, normalized);
      var ok = !!(saved && ((mode === 'hidden' && saved.isHidden) || (mode !== 'hidden' && saved.isWatched)));
      if (!ok) {
        console.log(
          '[EH My Tags] add not confirmed'
          + ' status=' + String(postResult && postResult.status || 0)
          + ' finalURL=' + String(postResult && postResult.url || myTagsURL(selectedTagSetID))
          + ' responseBytes=' + String(postResult && postResult.body ? postResult.body.length : 0)
          + ' tagSet=' + String(selectedTagSetID == null ? '' : selectedTagSetID)
        );
      }
      after.message = ok
        ? (mode === 'hidden' ? '已隐藏标签' : '已订阅标签')
        : '官网未确认保存，请稍后重试或打开 My Tags 检查。';
      return after;
    },

    deleteUserTags: function (ids) {
      ids = Array.isArray(ids) ? ids.filter(function (id) { return id != null && String(id).trim(); }).map(String) : [];
      if (!ids.length) return fetchUserTagsState('请选择要删除的标签。');
      var before = fetchUserTagsState(null);
      if (!before.isSupported) return before;
      postMyTags(buildDeleteUserTagsFields(ids), before.selectedTagSetID);
      var after = fetchUserTagsState(null, true);
      var remaining = {};
      after.tags.forEach(function (tag) { remaining[String(tag.id)] = true; });
      var ok = ids.every(function (id) { return !remaining[String(id)]; });
      after.message = ok ? '已删除标签' : '官网未确认删除，请稍后重试或打开 My Tags 检查。';
      return after;
    },

    updateUserTagSet: function (id, name, isEnabled) {
      id = parseInt(id, 10) || 1;
      var before = fetchUserTagsState(null);
      if (!before.isSupported) return before;
      var fields = {
        tagset_action: name ? 'rename' : 'update',
        tagset_name: name || '',
        tagset_color: ''
      };
      if (isEnabled !== false) fields.tagset_enable = 'on';
      postMyTags(fields, id);
      var after = fetchUserTagsState('已保存标签组', true);
      return after;
    },

    updateUserTag: function (id, isWatched, isHidden, weight, color) {
      id = String(id || '').trim();
      var before = fetchUserTagsState(null, true);
      if (!before.isSupported) return before;
      var existing = null;
      before.tags.forEach(function (tag) { if (String(tag.id) === id) existing = tag; });
      if (!existing) {
        before.message = '没有找到要修改的标签。';
        return before;
      }
      postMyTags(
        buildUpdateUserTagFields(id, !!isWatched, !!isHidden, weight, color),
        existing.tagSetID || before.selectedTagSetID
      );
      var after = fetchUserTagsState(null, true);
      var saved = null;
      after.tags.forEach(function (tag) { if (String(tag.id) === id) saved = tag; });
      var expectedWeight = weight == null ? '10' : String(weight);
      var expectedColor = color == null ? '' : String(color);
      var ok = !!saved
        && saved.isWatched === !!isWatched
        && saved.isHidden === !!isHidden
        && String(saved.weight == null ? '' : saved.weight) === expectedWeight
        && String(saved.color == null ? '' : saved.color) === expectedColor;
      after.message = ok ? '已保存标签' : '官网未确认保存，请刷新后重试。';
      return after;
    },

    getAccountFilters: function () {
      return fetchAccountFilters(null).state;
    },

    setAccountFilters: function (excludedLanguageOptionIDs, excludedUploaders) {
      var fetched = fetchAccountFilters(null);
      var current = fetched.state;
      if (!current.isSupported) return current;
      var doc = parseHTML(fetched.body, site());
      var form = findAccountSettingsForm(doc);
      var languageHTML = htmlHeadingSection(fetched.body, 'Excluded\\s+Languages', '排除语言');
      var uploaderHTML = htmlHeadingSection(fetched.body, 'Excluded\\s+Uploaders', '排除上传者');
      var uploaderDoc = uploaderHTML ? parseHTML(uploaderHTML, site()) : null;
      var uploaderTextarea = uploaderDoc ? uploaderDoc.selectFirst('textarea[name], textarea') : null;
      if (!form || (!current.languageOptions.length && !uploaderTextarea)) {
        current.isSupported = false;
        current.message = '官网表单结构发生变化，为避免覆盖其他设置，本次没有保存。';
        return current;
      }

      var fields = extractSuccessfulFormFields(form);
      var selected = {};
      (Array.isArray(excludedLanguageOptionIDs) ? excludedLanguageOptionIDs : []).forEach(function (id) {
        selected[String(id)] = true;
      });
      var languageFieldNames = {};
      current.languageOptions.forEach(function (option) {
        var parts = String(option.id || '').split('|');
        if (parts.length < 2) return;
        var name = decodeURIComponent(parts.shift());
        var value = decodeURIComponent(parts.join('|'));
        languageFieldNames[name] = true;
        if (selected[option.id]) {
          if (!fields.__ehSelectedLanguageFields) fields.__ehSelectedLanguageFields = [];
          fields.__ehSelectedLanguageFields.push({ name: name, value: value });
        }
      });
      Object.keys(languageFieldNames).forEach(function (name) { delete fields[name]; });
      var languageSelections = fields.__ehSelectedLanguageFields || [];
      delete fields.__ehSelectedLanguageFields;
      languageSelections.forEach(function (entry) { addFormField(fields, entry.name, entry.value); });

      var normalizedUploaders = normalizedUploaderList(excludedUploaders);
      if (uploaderTextarea) {
        var uploaderName = uploaderTextarea.attr('name') || '';
        if (uploaderName) fields[uploaderName] = normalizedUploaders.join('\n');
      }

      var submit = form.selectFirst('input[type="submit"][name], button[type="submit"][name]');
      if (submit) addFormField(fields, submit.attr('name') || '', submit.attr('value') || submit.text() || 'Apply');
      var rawAction = form.attr('action') || '';
      var action = rawAction ? (form.attr('abs:action') || rawAction) : '';
      var url = (!action || action === '#') ? site() + '/uconfig.php' : abs(action);
      fetch(url, { headers: formHeaders(), method: 'POST', body: formEncode(fields) });

      var after = fetchAccountFilters(null).state;
      var actualSelected = after.languageOptions.filter(function (option) { return option.isExcluded; }).map(function (option) { return option.id; }).sort();
      var expectedSelected = Object.keys(selected).filter(function (id) {
        return current.languageOptions.some(function (option) { return option.id === id; });
      }).sort();
      var languageOK = actualSelected.join('\n') === expectedSelected.join('\n');
      var uploadersOK = after.excludedUploaders.slice().sort().join('\n') === normalizedUploaders.slice().sort().join('\n');
      after.message = languageOK && uploadersOK ? '已同步到官网' : '官网未确认全部修改，请刷新后重试。';
      return after;
    },

    getArchiveOptions: function (manga) {
      var url = archiverURL(manga);
      if (!url) return { isSupported: false, options: [], downloadURL: null, message: '无法识别画廊地址' };
      var res = fetch(url, { headers: archiveHeaders(), timeout: 45 });
      var doc = parseHTML(res.body, site());
      var options = parseArchiveOptionsFromDoc(doc);
      var downloadURL = parseArchiveDownloadURL(doc);
      // 有些旧版页面会直接带余额；没有时由独立资金钩子读取，避免拖慢归档选项。
      var accountFunds = parseArchiveAccountFundsFromHTML(res.body) || parseArchiveAccountFunds(doc);
      var diagnostic = accountFunds ? archiveDiagnostic(doc, accountFunds, null) : null;
      var text = doc.text() || '';
      return {
        isSupported: options.length > 0 || !!downloadURL,
        options: options,
        downloadURL: downloadURL || null,
        nextURL: parseArchiveNextURL(doc) || null,
        accountFunds: accountFunds,
        diagnostic: diagnostic,
        message: text || null
      };
    },

    getArchiveAccountFunds: function () {
      var result = archiveAccountFundsFallbackResult();
      return {
        isSupported: true,
        accountFunds: result.funds,
        diagnostic: result.diagnostic,
        message: result.funds ? '已读取账号资金' : '未读取到账号资金'
      };
    },

    requestArchive: function (manga, mode) {
      var url = archiverURL(manga);
      if (!url) return { isSupported: false, options: [], downloadURL: null, message: '无法识别画廊地址' };
      var first = fetch(url, { headers: archiveHeaders(), timeout: 45 });
      var doc = parseHTML(first.body, site());
      var fields = buildArchivePostFields(doc, mode);
      var post = fetch(url, { headers: formHeaders(), method: 'POST', body: formEncode(fields) });
      var postDoc = parseHTML(post.body, site());
      var downloadURL = parseArchiveDownloadURL(postDoc);
      var nextURL = parseArchiveNextURL(postDoc);
      var options = parseArchiveOptionsFromDoc(postDoc);
      var accountFunds = parseArchiveAccountFundsFromHTML(post.body)
        || parseArchiveAccountFundsFromHTML(first.body)
        || parseArchiveAccountFunds(postDoc)
        || parseArchiveAccountFunds(doc);
      var diagnostic = accountFunds ? archiveDiagnostic(postDoc, accountFunds, null) : null;
      var text = postDoc.text() || '';
      return {
        isSupported: true,
        options: options,
        downloadURL: downloadURL || null,
        nextURL: nextURL || null,
        accountFunds: accountFunds,
        diagnostic: diagnostic,
        message: text || (downloadURL ? 'Archiver 已准备下载。' : (archiveIsPreparing(postDoc) ? 'Archiver 正在准备文件。' : 'Archiver 正在准备，请稍后再试。'))
      };
    },

    // 画廊只有一“话”，章节就是整本；阅读地址沿用画廊页 URL。
    getChapterList: function (manga) {
      return [{ id: manga.id || manga.url, url: manga.url, name: (manga && manga.title) || '全部', number: 1 }];
    },

    // **惰性页表**（治「点章节转圈好久才进去」）：只抓画廊首页拿总页数 + 每缩略页图数(perPage)，
    // 立刻返回 N 页——每页 url = 它所属的缩略页地址(?p=k，k=floor(i/perPage)；k=0 即画廊首页)，
    // 不带直链 imageURL。阅读器秒开；缓冲读到第 i 页时再抓那一张缩略页解析出 /s/，再走 /s/→#img
    // （见原生 viewerLinkParser/viewerParser）。比旧做法「进章节先把 ceil(total/perPage) 张缩略页
    // 全抓完拼整本页表」少等一大截（首屏只需 base 一张），且首图更快出现。
    getPageList: function (chapter) {
      var galleryURL = abs(chapter.url);

      // 章节即整本画廊，url/id 同 manga；复用详情那张画廊页（紧接详情进来读时省一次整页请求）。
      var firstBody = galleryBody({ id: chapter.id || chapter.url, url: chapter.url });
      var firstDoc = parseHTML(firstBody, site());
      var sLinks = collectThumbnailViewerLinks(firstDoc);
      var firstPages = collectThumbnailPages(firstDoc);
      var perPage = galleryPerPage(firstBody, sLinks.length);

      var lenM = firstBody.match(/Length[\s\S]{0,40}?(\d+)\s*pages/i);
      var total = lenM ? parseInt(lenM[1], 10) : sLinks.length;
      if (!total || total < sLinks.length) total = sLinks.length;
      if (!total) {
        // A detail request can have been made much earlier than opening the
        // reader. Refresh once before declaring the gallery empty; importantly,
        // galleryBody only stores responses verified as real gallery pages.
        firstBody = galleryBody({ id: chapter.id || chapter.url, url: chapter.url }, true);
        firstDoc = parseHTML(firstBody, site());
        sLinks = collectThumbnailViewerLinks(firstDoc);
        firstPages = collectThumbnailPages(firstDoc);
        perPage = galleryPerPage(firstBody, sLinks.length);
        lenM = firstBody.match(/Length[\s\S]{0,40}?(\d+)\s*pages/i);
        total = lenM ? parseInt(lenM[1], 10) : sLinks.length;
        if (!total || total < sLinks.length) total = sLinks.length;
      }
      if (!total) {
        throw new Error('E-Hentai 画廊页已打开，但没有解析到可用图片，请稍后重试');
      }

      var out = [];
      for (var i = 0; i < total; i++) {
        var k = Math.floor(i / perPage);
        var first = firstPages[i];
        out.push({
          index: i,
          url: first ? first.viewerURL : (k === 0 ? galleryURL : galleryURL + '?p=' + k),
          previewURL: first ? first.previewURL : null,
          previewCrop: first ? first.previewCrop : null
        });
      }
      return out;
    },

    // 第二步（批量，引擎优先调）：把一**组**查看页地址一次**并发**解析成真图直链。
    // 走 api.php(showpage)：每页只换一个 ~1KB JSON（含 i3 真图 + i6 的 nl 令牌），用 requestAll
    // 一个并发批次打完——替代「逐页抓几十 KB 查看页 HTML 串行往返」，这是接近原站速度的关键。
    // 解析不出的页返回 null，引擎再对其逐页走 getImageURL 兜底/失败转移。
    getImageURLs: function (pages, retry, purpose) {
      if (!pages || pages.length === 0) return [];

      // 惰性页表给的页 url 是缩略页(?p=k)，先批量解析成各页的 /s/ 查看页地址（已是 /s/ 的直接用）。
      var viewer = resolveViewerURLs(pages);
      var sURLs = pages.map(function (p) {
        return viewer[p.index] || (isViewerURL(p.url) ? p.url : null);
      });

      // 整本画廊共用一个 showkey；缺了就取一张查看页补上（防御）。
      var gid = null;
      for (var i = 0; i < sURLs.length; i++) {
        var k = viewerKey(sURLs[i]);
        if (k) { gid = k.gid; break; }
      }
      if (gid == null) return pages.map(function () { return null; });
      var showkey = storage.get(transientKey('showkey:' + gid));
      if (!showkey) {
        for (var fi = 0; fi < sURLs.length; fi++) {
          if (sURLs[fi]) { showkey = ensureShowkey(gid, sURLs[fi]); break; }
        }
      }
      // 没 showkey 走不了 api.php，整批交给逐页 getImageURL 兜底。
      if (!showkey) return pages.map(function () { return null; });

      // 为每页拼一条 api.php POST；retry 时带上各自存下的 nl 令牌换节点。
      var specs = [];
      var meta = [];
      for (var p = 0; p < pages.length; p++) {
        var su = sURLs[p];
        var key = su ? viewerKey(su) : null;
        if (!key) { meta.push(null); continue; }
        var nlToken = retry ? storage.get(transientKey('nl:' + su)) : null;
        meta.push({ url: su, key: key });
        specs.push({
          url: site() + '/api.php',
          method: 'POST',
          headers: apiHeaders(),
          body: showpageBody(key.gid, key.page, key.imgkey, showkey, nlToken)
        });
      }

      var results = requestAll(specs);
      var out = [];
      var ri = 0;
      for (var q = 0; q < pages.length; q++) {
        if (!meta[q]) { out.push(null); continue; }
        var res = results[ri++];
        var src = null;
        if (res && !res.error && res.body) {
          try {
            var j = JSON.parse(res.body);
            // 在线阅读严格服从官网账户设置。官网会在 i3 中返回该账户当前获准的图像；
            // App 不再绕过 Source Nexus / 图像配额去抓取 i7 的手动原图链接。
            src = extractImg(j.i3 || '') || null;
            var nl = extractNL(j.i6 || '');
            if (nl) storage.set(transientKey('nl:' + meta[q].url), nl);
          } catch (e) { src = null; }
        }
        out.push(src);
      }
      return out;
    },

    // 单页兜底/失败转移（引擎在批量解析不出某页时回调）。优先 api.php showpage；
    // 失败或 retry 再回退抓查看页 HTML（用 nl 令牌换节点）——这条老路最稳，保证某图 509 后能恢复。
    getImageURL: function (page, retry, purpose) {
      // 惰性页表给的 page.url 可能是缩略页(?p=k)，先解析出本页的 /s/ 查看页地址。
      var sURL = isViewerURL(page.url) ? page.url : resolveViewerURLs([page])[page.index];
      if (!sURL) return null;

      var key = viewerKey(sURL);
      if (key && !retry) {
        var showkey = storage.get(transientKey('showkey:' + key.gid)) || ensureShowkey(key.gid, sURL);
        if (showkey) {
          var res = fetch(site() + '/api.php', { headers: apiHeaders(), method: 'POST', body: showpageBody(key.gid, key.page, key.imgkey, showkey, null) });
          if (res && res.body) {
            try {
              var j = JSON.parse(res.body);
              var nl = extractNL(j.i6 || '');
              if (nl) storage.set(transientKey('nl:' + sURL), nl);
              var src = extractImg(j.i3 || '');
              if (src) return src;
            } catch (e) {}
          }
        }
      }

      // 回退/失败转移：抓查看页 HTML，retry 带 nl 令牌换 H@H 节点。
      var viewer = abs(sURL);
      if (retry) {
        var token = storage.get(transientKey('nl:' + sURL));
        if (token) viewer += (viewer.indexOf('?') >= 0 ? '&' : '?') + 'nl=' + encodeURIComponent(token);
      }
      var r2 = fetch(viewer, headers());
      var nlm = extractNL(r2.body);
      if (nlm) storage.set(transientKey('nl:' + sURL), nlm);
      if (key) {
        var sk = extractShowkey(r2.body);
        if (sk) storage.set(transientKey('showkey:' + key.gid), sk);
      }
      return extractImg(parseHTML(r2.body, site())) || null;
    }
  };
})();
