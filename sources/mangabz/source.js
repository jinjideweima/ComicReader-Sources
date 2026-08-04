// MangaBZ source plug-in.
// Engine globals: fetch / parseHTML / storage / sleep / btoa / atob / console.
// DOM selectors follow Jsoup/SwiftSoup semantics.
(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
  var MIRRORS = [
    { id: 'main', base: 'https://www.mangabz.com', suffix: 'bz', languageCookie: 'mangabz_lang' },
    { id: 'yy', base: 'https://www.yymanhua.com', suffix: 'yy', languageCookie: 'yymanhua_lang' },
    { id: 'xm', base: 'https://www.xmanhua.com', suffix: 'xm', languageCookie: 'xmanhua_lang' }
  ];

  // ashx is intentionally limited to five requests per second. Image CDN
  // downloads remain independently concurrent in the native reader.
  var IMAGE_ENDPOINT_INTERVAL_MS = 200;
  var MIRROR_BASE_COOLDOWN_MS = 15000;
  var MIRROR_MAX_COOLDOWN_MS = 5 * 60 * 1000;
  var lastImageEndpointRequestAt = 0;
  var imageCache = {};
  var GENRE_CODES = ['0', '31', '26', '1', '2', '25', '11', '17', '15', '34'];
  var STATUS_CODES = ['0', '1', '2'];
  var SORT_CODES = ['10', '2'];

  function mirrorByID(id) {
    for (var i = 0; i < MIRRORS.length; i++) {
      if (MIRRORS[i].id === id) return MIRRORS[i];
    }
    return null;
  }

  function languageValue() {
    return storage.get('language') === '2' ? '2' : '1';
  }

  function mirrorOrder() {
    var configured = storage.get('mirror_preference') || 'auto';
    var active = storage.get('active_mirror');
    var preferred = [];
    function add(id) {
      if (!mirrorByID(id) || preferred.indexOf(id) >= 0) return;
      preferred.push(id);
    }
    if (configured !== 'auto') add(configured);
    else add(active);
    add('main');
    add('yy');
    add('xm');

    if (configured !== 'auto') {
      // An explicit user preference is always attempted first. Healthy
      // alternatives follow; cooling mirrors are retained only as last-resort
      // fallbacks when every alternative is also unhealthy.
      var configuredID = preferred.shift();
      var healthyFallbacks = preferred.filter(function (id) { return !mirrorIsCooling(id); });
      var coolingFallbacks = preferred.filter(function (id) { return mirrorIsCooling(id); });
      return [configuredID].concat(healthyFallbacks, coolingFallbacks);
    }

    var healthy = preferred.filter(function (id) { return !mirrorIsCooling(id); });
    if (healthy.length) return healthy;
    // If all mirrors are cooling, retry the one whose cooldown expires first
    // instead of failing without making a request.
    return preferred.sort(function (left, right) {
      return mirrorFailureUntil(left) - mirrorFailureUntil(right);
    });
  }

  function mirrorStorageNumber(key) {
    var value = parseInt(storage.get(key), 10);
    return isNaN(value) ? 0 : value;
  }

  function mirrorFailureUntil(id) {
    return mirrorStorageNumber('mirror_failure_until_' + id);
  }

  function mirrorFailureCount(id) {
    return mirrorStorageNumber('mirror_failure_count_' + id);
  }

  function mirrorIsCooling(id) {
    return mirrorFailureUntil(id) > Date.now();
  }

  function markMirrorSuccess(id) {
    storage.set('mirror_failure_count_' + id, '0');
    storage.set('mirror_failure_until_' + id, '0');
    storage.set('mirror_health_' + id, 'healthy');
    storage.set('mirror_last_success_' + id, String(Date.now()));
  }

  function markMirrorFailure(id) {
    var failures = Math.min(mirrorFailureCount(id) + 1, 6);
    var cooldown = Math.min(
      MIRROR_BASE_COOLDOWN_MS * Math.pow(2, failures - 1),
      MIRROR_MAX_COOLDOWN_MS
    );
    storage.set('mirror_failure_count_' + id, String(failures));
    storage.set('mirror_failure_until_' + id, String(Date.now() + cooldown));
    storage.set('mirror_health_' + id, 'cooldown');
  }

  function requestTimeout(kind, mirror) {
    if (kind === 'account') return 10;
    if (mirrorFailureCount(mirror.id) > 0) return 3;
    if (kind === 'image') return 6;
    if (kind === 'home') return 6;
    return 5;
  }

  function requestOptions(mirror, refererPath, kind) {
    var language = languageValue();
    return {
      headers: {
        'Referer': mirror.base + (refererPath || '/'),
        'User-Agent': UA,
        'Accept-Language': language === '2' ? 'zh-CN,zh;q=0.9' : 'zh-TW,zh-Hant;q=0.9,zh;q=0.8'
      },
      timeout: requestTimeout(kind || 'list', mirror)
    };
  }

  function stripOrigin(value) {
    return String(value || '').replace(/^https?:\/\/[^/]+/i, '');
  }

  function canonicalPath(value) {
    var path = stripOrigin(value);
    return path.replace(/\/(\d+)(?:bz|yy|xm)\//i, '/$1bz/');
  }

  function pathForMirror(value, mirror) {
    var path = canonicalPath(value);
    return path.replace(/\/(\d+)bz\//i, '/$1' + mirror.suffix + '/');
  }

  function responseIsUsable(response, kind) {
    var status = parseInt(response && response.status, 10) || 0;
    var body = String((response && response.body) || '');
    if (status < 200 || status >= 400 || !body.trim()) return false;
    if (/cf-chl-|just a moment|attention required|cloudflare/i.test(body)) return false;
    if (kind === 'detail') return /detail-info|chapterlistload/i.test(body);
    if (kind === 'chapter') return /MANGABZ_IMAGE_COUNT|chapterimage\.ashx/i.test(body);
    if (kind === 'image') return /^\s*eval/i.test(body);
    return true;
  }

  function throttleImageEndpoint() {
    var now = Date.now();
    var remaining = IMAGE_ENDPOINT_INTERVAL_MS - (now - lastImageEndpointRequestAt);
    if (remaining > 0) sleep(remaining);
    lastImageEndpointRequestAt = Date.now();
  }

  function requestPathWithMirrors(path, kind, refererPath, ids) {
    var lastFailure = '';
    for (var i = 0; i < ids.length; i++) {
      var mirror = mirrorByID(ids[i]);
      var mappedPath = pathForMirror(path, mirror);
      try {
        if (kind === 'image') throttleImageEndpoint();
        var response = fetch(mirror.base + mappedPath, requestOptions(mirror, refererPath, kind));
        if (responseIsUsable(response, kind)) {
          markMirrorSuccess(mirror.id);
          storage.set('active_mirror', mirror.id);
          return { response: response, mirror: mirror, path: mappedPath };
        }
        markMirrorFailure(mirror.id);
        lastFailure = mirror.id + ': HTTP ' + String(response.status || 0);
      } catch (error) {
        markMirrorFailure(mirror.id);
        lastFailure = mirror.id + ': ' + String(error && error.message ? error.message : error);
      }
    }
    throw new Error('fetch failed: MangaBZ 主站和备用站点均不可用（' + lastFailure + '）');
  }

  function requestPath(path, kind, refererPath) {
    // MangaBZ only records account history on its primary domain. Once the App
    // has an authenticated session, opening a detail/chapter must not quietly
    // move to a mirror that cannot see that Cookie.
    if (storage.get('account_logged_in') === '1' && (kind === 'detail' || kind === 'chapter')) {
      return requestPathWithMirrors(path, kind, refererPath, ['main']);
    }
    return requestPathWithMirrors(path, kind, refererPath, mirrorOrder());
  }

  // The main MangaBZ site is the only mirror that publishes the complete
  // editorial home (four featured works, popularity, editor picks and the
  // five hot categories). The alternatives intentionally use a different,
  // smaller layout and must never be cached as a complete editorial home.
  // List/detail/reader requests keep their normal mirror failover behavior.
  function requestEditorialHome() {
    return requestPathWithMirrors('/', 'home', '/', ['main']);
  }

  function absoluteURL(value, mirror) {
    if (!value) return '';
    if (/^https?:/i.test(value)) return String(value).replace(/^http:/i, 'https:');
    if (String(value).indexOf('//') === 0) return 'https:' + value;
    return mirror.base + (String(value).charAt(0) === '/' ? value : '/' + value);
  }

  function between(value, start, end) {
    var source = String(value || '');
    var i = source.indexOf(start);
    if (i < 0) return '';
    i += start.length;
    var j = source.indexOf(end, i);
    return j < 0 ? '' : source.substring(i, j);
  }

  function floatOf(value) {
    var match = String(value || '').match(/\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : -2;
  }

  // Capture the unpacked script without executing its site-defined function.
  function unpackEval(body) {
    var captured = '';
    var source = String(body || '').replace(/^\s*eval/, '__capture');
    try {
      (new Function('__capture', source))(function (value) {
        captured = String(value || '');
        return value;
      });
    } catch (error) {
      captured = '';
    }
    return captured;
  }

  function parseImageBatch(body) {
    var script = unpackEval(body);
    var prefix = between(script, 'pix="', '"');
    var encodedPaths = between(script, '["', '"]');
    if (!prefix || !encodedPaths) return [];
    return encodedPaths.split('","').map(function (path) { return prefix + path; });
  }

  function parseList(html, mirror) {
    var doc = parseHTML(html, mirror.base);
    var container = doc.selectFirst('.mh-list');
    var items = [];
    if (container) {
      container.children().forEach(function (element) {
        var titleLink = element.selectFirst('h2 a') || element.selectFirst('a');
        var titleElement = element.selectFirst('h2');
        var image = element.selectFirst('img');
        if (!titleLink || !titleElement) return;
        var href = canonicalPath(titleLink.attr('href'));
        var statusElement = element.selectFirst('.chapter span');
        var latestElement = element.selectFirst('.chapter a');
        var statusText = statusElement ? statusElement.text().trim() : '';
        var status = statusText === '完结' || statusText === '完結' ? 'completed'
          : statusText === '最新' ? 'ongoing' : 'unknown';
        var info = {};
        if (latestElement) {
          info.latestChapter = latestElement.text().trim();
          info.latestChapterURL = canonicalPath(latestElement.attr('href'));
        }
        items.push({
          id: href,
          url: href,
          title: titleElement.text(),
          coverURL: image ? absoluteURL(image.attr('abs:src') || image.attr('src'), mirror) : null,
          genres: [],
          status: status,
          info: Object.keys(info).length ? info : null
        });
      });
    }
    var pagination = doc.select('.page-pagination a');
    var hasNextPage = pagination.length > 0 && pagination[pagination.length - 1].text().trim() === '>';
    return { items: items, hasNextPage: hasNextPage };
  }

  function accountHasNextPage(doc) {
    var pagination = doc.select('.page-pagination a, .pagination a, .shelf-pagination a');
    return pagination.some(function (link) {
      var text = link.text().trim();
      return text === '>' || text === '下一页' || text === '下一頁';
    });
  }

  function accountMangaPath(element) {
    var links = element.select('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = canonicalPath(links[i].attr('href')).replace(/[?#].*$/, '');
      if (/\/\d+bz\/?$/i.test(href)) {
        return href.charAt(href.length - 1) === '/' ? href : href + '/';
      }
    }
    return '';
  }

  // The logged-in desktop pages at /bookmarker/ and /comichistory/ are a
  // dedicated shelf, not the public .mh-list catalogue.  Keep this parser
  // separate so account sync does not accidentally consume header/footer links
  // as manga cards when the site changes a surrounding wrapper.
  function accountShelfManga(element, mirror) {
    var titleElement = element.selectFirst('.shelf-manga-item-title');
    var href = accountMangaPath(element);
    if (!href) return null;

    var image = element.selectFirst('.shelf-manga-item-cover img') || element.selectFirst('img');
    var info = {};
    var subtitle = element.selectFirst('.shelf-manga-item-subtitle');
    var coverStatus = element.selectFirst('.shelf-manga-item-cover p');
    var chapterLink = element.selectFirst('.shelf-manga-item-subtitle a[href*="/m"]')
      || element.selectFirst('.shelf-manga-item-cover a[href*="/m"]');
    if (chapterLink) {
      info.latestChapter = chapterLink.text().trim();
      info.latestChapterURL = canonicalPath(chapterLink.attr('href'));
    }
    if (coverStatus && coverStatus.text().trim()) info.updated = coverStatus.text().trim();
    if (subtitle && subtitle.text().trim()) info.accountSubtitle = subtitle.text().trim();

    return {
      id: href,
      url: href,
      title: titleElement ? titleElement.text().trim() : '',
      coverURL: image ? absoluteURL(image.attr('abs:src') || image.attr('src'), mirror) : null,
      genres: [],
      status: 'unknown',
      info: Object.keys(info).length ? info : null
    };
  }

  // MangaBZ serves a compact mobile account shelf to some authenticated
  // sessions. It uses the same card data but different class names, so parse
  // it explicitly instead of falling through to a misleading empty shelf.
  function accountMobileManga(element, mirror) {
    var titleElement = element.selectFirst('.manga-i-list-title, .manga-item-title');
    var href = accountMangaPath(element);
    if (!href) return null;

    var image = element.selectFirst('.manga-i-cover, .manga-item-cover') || element.selectFirst('img');
    var subtitle = element.selectFirst('.manga-i-list-subtitle, .manga-item-subtitle');
    var chapterLink = subtitle ? subtitle.selectFirst('a[href*="/m"]') : null;
    var info = {};
    if (subtitle && subtitle.text().trim()) info.accountSubtitle = subtitle.text().trim();
    if (chapterLink) {
      info.latestChapter = chapterLink.text().trim();
      info.latestChapterURL = canonicalPath(chapterLink.attr('href'));
    }
    return {
      id: href,
      url: href,
      title: titleElement ? titleElement.text().trim() : '',
      coverURL: image ? absoluteURL(image.attr('abs:src') || image.attr('src'), mirror) : null,
      genres: [],
      status: 'unknown',
      info: Object.keys(info).length ? info : null
    };
  }

  function accountDOMFingerprint(doc) {
    // Diagnostics intentionally contain only anonymous structure counts — no
    // titles, account identifiers, cookie values, or response HTML.
    return 'shelf=' + doc.select('.shelf-manga-item').length
      + ', mobileGrid=' + doc.select('.manga-i-list-item').length
      + ', mobileRows=' + doc.select('.manga-list .manga-item').length
      + ', catalogue=' + doc.select('.mh-list').length
      + ', login=' + (doc.select('#formlogin, input[name="txt_username"]').length ? '1' : '0');
  }

  function isExplicitlyEmptyAccountShelf(doc) {
    var emptyElement = doc.selectFirst('.shelf-empty, .empty, .no-data, .no-result, .empty-tip');
    var text = String((emptyElement ? emptyElement.text() : '') || '').replace(/\s+/g, ' ').trim();
    return /(?:暫無|暂无|還沒有|还没有|暫未|暂未|沒有|没有).{0,12}(?:收藏|收藏夾|收藏夹|閱讀歷史|阅读历史|記錄|记录)/.test(text);
  }

  // An empty array is only valid when MangaBZ explicitly tells us that the
  // shelf is empty.  A signed-in but unrecognised document is a parser error,
  // never an "account has no content" result.
  function parseAccountList(html, mirror, kind) {
    var doc = parseHTML(html, mirror.base);
    var items = [];
    var seen = {};
    doc.select('.shelf-manga-list .shelf-manga-item').forEach(function (element) {
      var manga = accountShelfManga(element, mirror);
      if (!manga || seen[manga.id]) return;
      seen[manga.id] = true;
      items.push(manga);
    });
    if (items.length) return { items: items, hasNextPage: accountHasNextPage(doc) };

    doc.select('.manga-i-list .manga-i-list-item, .manga-list .manga-item').forEach(function (element) {
      var manga = accountMobileManga(element, mirror);
      if (!manga || seen[manga.id]) return;
      seen[manga.id] = true;
      items.push(manga);
    });
    if (items.length) return { items: items, hasNextPage: accountHasNextPage(doc) };

    // Older MangaBZ skins used the ordinary catalogue list for account pages.
    // Retain that compatibility, but only when its container is actually present.
    if (doc.selectFirst('.mh-list')) {
      var catalogue = parseList(html, mirror);
      if (catalogue.items.length || isExplicitlyEmptyAccountShelf(doc)) return catalogue;
    }

    if (isExplicitlyEmptyAccountShelf(doc)) return { items: [], hasNextPage: false };

    var pageName = kind === 'history' ? '阅读历史' : '收藏';
    console.warn('[MangaBZ account parser] ' + pageName + ' ' + accountDOMFingerprint(doc));
    throw new Error('MangaBZ ' + pageName + '页面结构无法识别，未将结果误判为空。请重试；若仍失败，请重新登录后再试。');
  }

  function accountPath(path, page, query, sort) {
    var params = [];
    if (sort === '3' || sort === '6') params.push('sort=' + sort);
    if (query) params.push('title=' + encodeURIComponent(String(query)));
    if (page > 1) params.push('page=' + page);
    return params.length ? path + '?' + params.join('&') : path;
  }

  function isLoginDocument(body) {
    var text = String(body || '').toLowerCase();
    return text.indexOf('id="formlogin"') >= 0
      || text.indexOf("id='formlogin'") >= 0
      || text.indexOf('name="txt_username"') >= 0
      || text.indexOf('name="txt_password"') >= 0;
  }

  // Account data always stays on the MangaBZ main domain. Mirrors intentionally
  // do not share the authenticated Cookie jar and must never receive it.
  function requestAccountPath(path, method, body, refererPath) {
    var main = mirrorByID('main');
    var options = requestOptions(main, refererPath || '/', 'account');
    if (method) options.method = method;
    if (body != null) {
      options.body = body;
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      options.headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    var response;
    try {
      response = fetch(main.base + pathForMirror(path, main), options);
    } catch (error) {
      markMirrorFailure(main.id);
      throw error;
    }
    if (!response || parseInt(response.status, 10) < 200 || parseInt(response.status, 10) >= 400) {
      markMirrorFailure(main.id);
      throw new Error('MangaBZ 账户请求失败（HTTP ' + String((response && response.status) || 0) + '）');
    }
    markMirrorSuccess(main.id);
    if (isLoginDocument(response.body)) {
      throw new Error('MangaBZ 登录状态已失效，请重新登录后再试。');
    }
    return { response: response, mirror: main };
  }

  function mangaNumericID(manga) {
    var value = String((manga && (manga.id || manga.url)) || '');
    var match = value.match(/\/(\d+)(?:bz|yy|xm)\//i);
    return match ? match[1] : '';
  }

  function accountForm(values) {
    var parts = [];
    Object.keys(values).forEach(function (key) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key] == null ? '' : values[key])));
    });
    return parts.join('&');
  }

  function accountUserID(body) {
    var match = String(body || '').match(/MANGABZ_USERID\s*=\s*["']?(\d+)/i);
    var uid = match ? match[1] : '';
    if (!uid || uid === '0') {
      throw new Error('MangaBZ 登录状态已失效，请重新登录后再试。');
    }
    return uid;
  }

  function accountFavoriteState(manga) {
    var mid = mangaNumericID(manga);
    if (!mid) throw new Error('无法识别 MangaBZ 漫画编号。');
    var detail = requestAccountPath(canonicalPath(manga.url || manga.id), 'GET', null, '/');
    var uid = accountUserID(detail.response.body);
    var response = requestAccountPath(
      canonicalPath(manga.url || manga.id).replace(/\/$/, '') + '/useractivity.ashx',
      'POST',
      accountForm({ tp: 1, mid: mid }),
      canonicalPath(manga.url || manga.id)
    );
    var payload = {};
    try { payload = JSON.parse(String(response.response.body || '{}')); } catch (error) {}
    return {
      isSupported: true,
      isFavorited: String(payload.msg || payload.Value || '') === '1',
      category: null,
      categories: [],
      note: null,
      message: null,
      _uid: uid,
      _mid: mid
    };
  }

  function toggleAccountFavorite(manga) {
    var state = accountFavoriteState(manga);
    var path = canonicalPath(manga.url || manga.id).replace(/\/$/, '') + '/bookmarker.ashx';
    var result = requestAccountPath(
      path,
      'POST',
      accountForm({ cid: 0, mid: state._mid, page: 0, uid: state._uid }),
      canonicalPath(manga.url || manga.id)
    );
    var payload = {};
    try { payload = JSON.parse(String(result.response.body || '{}')); } catch (error) {}
    if (String(payload.Value || '') === '2') {
      throw new Error('MangaBZ 收藏操作失败，请稍后重试。');
    }
    return {
      isSupported: true,
      // Official endpoint is a toggle. Invert the state we just read instead
      // of trusting its historically inconsistent success text.
      isFavorited: !state.isFavorited,
      category: null,
      categories: [],
      note: null,
      message: !state.isFavorited ? '已同步到 MangaBZ 收藏' : '已从 MangaBZ 收藏移除'
    };
  }

  function deleteAccountShelfItems(mangas, kind) {
    var seen = {};
    var ids = (mangas || []).map(mangaNumericID).filter(function (id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
    if (!ids.length) {
      throw new Error(kind === 'history' ? '请选择要删除的阅读记录。' : '请选择要删除的收藏。');
    }

    var isHistory = kind === 'history';
    var shelfPath = isHistory ? '/comichistory/' : '/bookmarker/';
    var shelf = requestAccountPath(shelfPath, 'GET', null, '/');
    var uid = accountUserID(shelf.response.body);
    var endpoint = isHistory ? '/readHistory.ashx?t=' + Date.now()
      : '/bookmarker/bookmarkerAction.ashx?d=' + Date.now();
    var form = isHistory
      ? accountForm({ mids: ids.join(',') + ',', uid: uid, action: 'delete' })
      : accountForm({
          ids: ids.map(function (id) { return '1-' + uid + '-' + id; }).join(','),
          uid: uid,
          action: 'delete'
        });
    var result = requestAccountPath(endpoint, 'POST', form, shelfPath);
    var payload = {};
    try { payload = JSON.parse(String(result.response.body || '{}')); } catch (error) {}
    if (String(payload.Value || '') !== '1') {
      throw new Error(isHistory ? 'MangaBZ 阅读历史删除失败，请稍后重试。' : 'MangaBZ 收藏删除失败，请稍后重试。');
    }
    return {
      isSupported: true,
      didSucceed: true,
      affectedCount: ids.length,
      message: isHistory ? '已删除所选阅读历史' : '已删除所选收藏'
    };
  }

  function filterIndex(filters, key, fallback) {
    for (var i = 0; i < (filters || []).length; i++) {
      if (filters[i].key === key) {
        var value = parseInt(filters[i].value, 10);
        return isNaN(value) ? fallback : value;
      }
    }
    return fallback;
  }

  function browsePath(page, filters) {
    var genre = GENRE_CODES[filterIndex(filters, 'genre', 0)] || '0';
    var status = STATUS_CODES[filterIndex(filters, 'status', 0)] || '0';
    var ordering = SORT_CODES[filterIndex(filters, 'ordering', 0)] || '10';
    var filtered = genre !== '0' || status !== '0' || ordering !== '10';
    var base = filtered
      ? '/manga-list-' + genre + '-' + status + '-' + ordering
      : '/manga-list';
    return base + (page > 1 ? '-p' + page : '') + '/';
  }

  function parseRankList(html, mirror) {
    var doc = parseHTML(html, mirror.base);
    var items = [];
    doc.select('.rank-list .list').forEach(function (element) {
      var titleLink = element.selectFirst('.rank-item-title a');
      var image = element.selectFirst('.rank-item-cover');
      if (!titleLink) return;
      var href = canonicalPath(titleLink.attr('href'));
      var rankElement = element.selectFirst('[class*=rank-top-]');
      var rank = rankElement ? rankElement.text().trim() : '';
      items.push({
        id: href,
        url: href,
        title: titleLink.text().trim(),
        coverURL: image ? absoluteURL(image.attr('abs:src') || image.attr('src'), mirror) : null,
        genres: element.select('.rank-item-right span').map(function (span) { return span.text().trim(); }),
        status: 'unknown',
        info: rank ? { rank: '#' + rank } : null
      });
    });
    return { items: items, hasNextPage: false };
  }

  function homeManga(element, mirror, titleSelector, imageSelector) {
    var titleLink = titleSelector ? element.selectFirst(titleSelector) : null;
    if (!titleLink) titleLink = element.selectFirst('h2 a') || element.selectFirst('.rank-item-title a') || element.selectFirst('a');
    if (!titleLink) return null;
    var href = canonicalPath(titleLink.attr('href'));
    if (!href) return null;
    var image = imageSelector ? element.selectFirst(imageSelector) : element.selectFirst('img');
    var genres = element.select('.index-manga-item-subtitle span, .rank-item-right span, .carousel-right-item-tag span')
      .map(function (span) { return span.text().trim(); })
      .filter(function (value) { return value.length > 0; });
    var info = {};
    var subtitle = element.selectFirst('.carousel-right-item-subtitle');
    var content = element.selectFirst('.carousel-right-item-content');
    if (subtitle && subtitle.text().trim()) info.author = subtitle.text().trim();
    if (content && content.text().trim()) info.description = content.text().trim();
    var rankElement = element.selectFirst('[class*=rank-top-]');
    if (rankElement && rankElement.text().trim()) info.rank = '#' + rankElement.text().trim();
    return {
      id: href,
      url: href,
      title: titleLink.text().trim(),
      coverURL: image ? absoluteURL(image.attr('abs:src') || image.attr('src'), mirror) : null,
      genres: genres,
      status: 'unknown',
      info: Object.keys(info).length ? info : null
    };
  }

  function dedupeManga(items) {
    var seen = {};
    return (items || []).filter(function (item) {
      if (!item || !item.id || seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  }

  function homeSectionByHeading(doc, heading) {
    var containers = doc.select('.container');
    for (var i = 0; i < containers.length; i++) {
      var title = containers[i].selectFirst('.list-con-title');
      if (title && title.text().trim().indexOf(heading) >= 0) return containers[i];
    }
    return null;
  }

  function homeSectionStatus(container, items, title) {
    if (!container) {
      return { state: 'failed', message: '未识别到官网“' + title + '”板块，请重试。' };
    }
    if (!items || !items.length) {
      return { state: 'failed', message: '官网“' + title + '”板块存在，但内容解析失败，请重试。' };
    }
    return { state: 'loaded', message: null };
  }

  function parseHome(html, mirror) {
    var doc = parseHTML(html, mirror.base);
    var heroes = [];
    var heroContainer = doc.selectFirst('.banner-con');
    (heroContainer ? heroContainer.select('a') : []).forEach(function (anchor) {
      var href = canonicalPath(anchor.attr('href'));
      var image = anchor.selectFirst('img');
      var title = anchor.attr('title') || (image ? image.attr('alt') : '') || '';
      if (!href || !image) return;
      var manga = {
        id: href,
        url: href,
        title: String(title).trim(),
        coverURL: absoluteURL(image.attr('abs:src') || image.attr('src'), mirror),
        genres: [],
        status: 'unknown',
        info: { hero: '1' }
      };
      heroes.push({ manga: manga, imageURL: manga.coverURL });
    });

    // Keep a title-based fallback: MangaBZ has changed the wrapper classes
    // before, while the editorial headings have remained stable.
    var popularContainer = doc.selectFirst('.list-con-1')
      || homeSectionByHeading(doc, '人氣推薦')
      || homeSectionByHeading(doc, '人气推荐');
    var popular = popularContainer
      ? popularContainer.select('.index-manga-item').map(function (element) { return homeManga(element, mirror, '.index-manga-item-title a', '.index-manga-item-cover'); }).filter(function (item) { return item; })
      : [];
    var rankContainer = doc.selectFirst('.rank-con');
    var toplist = rankContainer
      ? rankContainer.select('.rank-list .list').map(function (element) { return homeManga(element, mirror, '.rank-item-title a', '.rank-item-cover'); }).filter(function (item) { return item; })
      : [];
    var editorContainer = homeSectionByHeading(doc, '編輯推薦') || homeSectionByHeading(doc, '编辑推荐');
    var editor = editorContainer
      ? editorContainer.select('.index-manga-item').map(function (element) { return homeManga(element, mirror, '.index-manga-item-title a', '.index-manga-item-cover'); }).filter(function (item) { return item; })
      : [];
    var risingContainer = homeSectionByHeading(doc, '上升最快') || homeSectionByHeading(doc, '上升最快');
    var rising = risingContainer
      ? risingContainer.select('.carousel-right-item').map(function (element) { return homeManga(element, mirror, '.carousel-right-item-title a', '.carousel-right-item-cover'); }).filter(function (item) { return item; })
      : [];
    var categoryRoot = doc.selectFirst('#hotCatgoryId')
      || homeSectionByHeading(doc, '熱門分類')
      || homeSectionByHeading(doc, '热门分类');
    var categoryNames = categoryRoot ? categoryRoot.select('.list-con-title-class a') : [];
    var categoryLists = categoryRoot ? categoryRoot.select('.index-manga-list') : [];
    var hotCategories = [];
    for (var i = 0; i < categoryNames.length && i < categoryLists.length; i++) {
      var categoryItems = categoryLists[i].select('.index-manga-item')
        .map(function (element) { return homeManga(element, mirror, '.index-manga-item-title a', '.index-manga-item-cover'); })
        .filter(function (item) { return item; });
      hotCategories.push({
        id: 'hot-' + String(i),
        title: categoryNames[i].text().trim(),
        items: dedupeManga(categoryItems)
      });
    }
    var sectionStates = {
      featured: homeSectionStatus(heroContainer, heroes, '顶部推荐'),
      popular: homeSectionStatus(popularContainer, popular, '人气推荐'),
      toplist: homeSectionStatus(rankContainer, toplist, '热度排行'),
      editor: homeSectionStatus(editorContainer, editor, '编辑推荐'),
      rising: homeSectionStatus(risingContainer, rising, '上升最快'),
      hotCategories: homeSectionStatus(categoryRoot, hotCategories, '热门分类')
    };
    return {
      heroes: heroes,
      popular: dedupeManga(popular),
      toplist: dedupeManga(toplist),
      editor: dedupeManga(editor),
      rising: dedupeManga(rising),
      hotCategories: hotCategories,
      sectionStates: sectionStates
    };
  }

  function parseDescription(contentElement, title) {
    var text = contentElement.text()
      .replace(/\[\+展開\]|\[\+展开\]|\[-折疊\]|\[-折叠\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    var simplifiedPrefix = title + '漫画 ，';
    var traditionalPrefix = title + '漫畫 ，';
    if (text.indexOf(simplifiedPrefix) === 0) text = text.substring(simplifiedPrefix.length);
    else if (text.indexOf(traditionalPrefix) === 0) text = text.substring(traditionalPrefix.length);
    return text;
  }

  function ownTexts(element) {
    return element.children().map(function (child) { return child.ownText(); })
      .filter(function (text) { return text.length > 0; });
  }

  function pageCountFromName(name) {
    var match = String(name || '').match(/[（(]\s*(\d+)\s*P\s*[）)]/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  function chapterID(value) {
    var match = String(value || '').match(/\/m(\d+)/i);
    return match ? match[1] : '';
  }

  function descriptor(chapterId, page, pageCount) {
    return MIRRORS[0].base + '/m' + chapterId + '/chapterimage.ashx?cid=' + chapterId
      + '&page=' + page + '&pc=' + pageCount;
  }

  function descriptorInfo(page) {
    var value = String(page && page.url || '');
    var cid = (value.match(/[?&]cid=(\d+)/i) || [])[1] || chapterID(value);
    var requested = parseInt((value.match(/[?&]page=(\d+)/i) || [])[1], 10) || ((page && page.index) + 1);
    var count = parseInt((value.match(/[?&]pc=(\d+)/i) || [])[1], 10) || 0;
    return { cid: cid, page: requested, count: count };
  }

  function cacheFor(info) {
    var key = info.cid + ':' + languageValue();
    if (!imageCache[key]) imageCache[key] = { urls: {}, count: info.count };
    if (info.count > imageCache[key].count) imageCache[key].count = info.count;
    return imageCache[key];
  }

  function resolveImageBatch(info, startPage) {
    if (!info.cid) return [];
    var path = '/m' + info.cid + '/chapterimage.ashx?cid=' + info.cid + '&page=' + startPage;
    var result = requestPath(path, 'image', '/m' + info.cid + '/');
    var urls = parseImageBatch(result.response.body);
    var cache = cacheFor(info);
    for (var i = 0; i < urls.length; i++) {
      var pageNumber = startPage + i;
      if (!cache.count || pageNumber <= cache.count) cache.urls[pageNumber] = urls[i];
    }
    return urls;
  }

  globalThis.__source = {
    getHome: function () {
      var result = requestEditorialHome();
      return parseHome(result.response.body, result.mirror);
    },

    getPopular: function (page) {
      var result = requestPath(browsePath(page, []), 'list', '/');
      return parseList(result.response.body, result.mirror);
    },

    getLatest: function (page) {
      var result = requestPath(browsePath(page, [{ key: 'ordering', value: '1' }]), 'list', '/');
      return parseList(result.response.body, result.mirror);
    },

    search: function (page, query, filters) {
      if (!query) {
        var browseResult = requestPath(browsePath(page, filters), 'list', '/');
        return parseList(browseResult.response.body, browseResult.mirror);
      }
      var searchMode = filterIndex(filters, 'search_mode', 0);
      var path = '/search?title=' + encodeURIComponent(query) + '&page=' + page;
      if (searchMode === 1) path += '&f=1';
      else if (searchMode === 2) path += '&f=2';
      var result = requestPath(path, 'list', '/');
      return parseList(result.response.body, result.mirror);
    },

    getToplist: function () {
      var result = requestPath('/', 'list', '/');
      return parseRankList(result.response.body, result.mirror);
    },

    getMangaDetails: function (manga) {
      var result = requestPath(manga.url, 'detail', '/');
      var doc = parseHTML(result.response.body, result.mirror.base);
      var titleElement = doc.selectFirst('.detail-info-title');
      var coverElement = doc.selectFirst('.detail-info-cover');
      var contentElement = doc.selectFirst('.detail-info-content');
      var tip = doc.selectFirst('.detail-info-tip');
      var fields = tip ? tip.children() : [];
      var title = titleElement ? titleElement.ownText() : manga.title;
      var status = 'unknown';
      if (fields.length > 1) {
        var statusChild = fields[1].child(0);
        var statusText = statusChild ? statusChild.ownText() : fields[1].ownText();
        if (statusText === '连载中' || statusText === '連載中') status = 'ongoing';
        else if (statusText === '已完结' || statusText === '已完結') status = 'completed';
      }
      var info = {};
      var existingInfo = manga.info || {};
      Object.keys(existingInfo).forEach(function (key) { info[key] = existingInfo[key]; });
      var ratingElement = doc.selectFirst('.detail-info-stars span');
      if (ratingElement) info.rating = ratingElement.text().trim();
      var chapterHeader = doc.selectFirst('.detail-list-form-title');
      if (chapterHeader) {
        var headerText = chapterHeader.text();
        var countMatch = headerText.match(/共\s*(\d+)\s*章/);
        var dateMatch = headerText.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/)
          || headerText.match(/(\d{4}年\d{1,2}月\d{1,2}[日號号])/)
          || headerText.match(/(\d{1,2}月\d{1,2}[日號号])/);
        if (countMatch) info.chapters = countMatch[1];
        if (dateMatch) info.updated = dateMatch[1].replace(/\//g, '-').replace(/\./g, '-');
        var latest = chapterHeader.selectFirst('.s a');
        if (latest) {
          info.latestChapter = latest.text().trim();
          info.latestChapterURL = canonicalPath(latest.attr('href'));
        }
      }
      return {
        id: canonicalPath(manga.id || manga.url),
        url: canonicalPath(manga.url),
        title: title,
        coverURL: coverElement
          ? absoluteURL(coverElement.attr('abs:src') || coverElement.attr('src'), result.mirror)
          : (manga.coverURL || null),
        author: fields.length > 0 ? ownTexts(fields[0]).join(', ') : null,
        genres: fields.length > 2 ? ownTexts(fields[2]) : [],
        status: status,
        description: contentElement ? parseDescription(contentElement, title) : null,
        info: Object.keys(info).length ? info : null
      };
    },

    getChapterList: function (manga) {
      var result = requestPath(manga.url, 'detail', '/');
      var doc = parseHTML(result.response.body, result.mirror.base);
      var list = doc.selectFirst('#chapterlistload');
      if (!list) return [];
      var seen = {};
      return list.children().map(function (anchor) {
        var pageSpan = anchor.child(0);
        var name = anchor.ownText() + (pageSpan ? pageSpan.ownText() : '');
        var url = canonicalPath(anchor.attr('href'));
        if (!url || seen[url]) return null;
        seen[url] = true;
        return { id: url, url: url, name: name, number: floatOf(anchor.ownText()) };
      }).filter(function (chapter) { return chapter !== null; });
    },

    getPageList: function (chapter) {
      var cid = chapterID(chapter.url);
      var count = pageCountFromName(chapter.name);
      if (!cid) return [];
      // Logged-in reads intentionally visit the chapter document even when its
      // title already contains the page count. This is the official history
      // write path; without it the native reader would never reach MangaBZ.
      if (!count || storage.get('account_logged_in') === '1') {
        var chapterResult = requestPath(chapter.url, 'chapter', '/');
        if (!count) {
          var match = String(chapterResult.response.body).match(/MANGABZ_IMAGE_COUNT\s*=\s*(\d+)/);
          count = match ? parseInt(match[1], 10) : 0;
        }
      }
      if (!count) return [];
      var pages = [];
      for (var i = 0; i < count; i++) {
        pages.push({ index: i, imageURL: null, url: descriptor(cid, i + 1, count) });
      }
      return pages;
    },

    getImageURL: function (page, retry) {
      var info = descriptorInfo(page);
      var cache = cacheFor(info);
      if (retry) delete cache.urls[info.page];
      if (!retry && cache.urls[info.page]) return cache.urls[info.page];
      resolveImageBatch(info, info.page);
      return cache.urls[info.page] || null;
    },

    // Resolve only the first missing server batch. The native reader can start
    // downloading immediately; remaining pages are filled lazily as its window advances.
    getImageURLs: function (pages, retry) {
      var output = [];
      var firstMissing = null;
      for (var i = 0; i < pages.length; i++) {
        var info = descriptorInfo(pages[i]);
        var cache = cacheFor(info);
        if (retry) delete cache.urls[info.page];
        if (!cache.urls[info.page] && firstMissing === null) firstMissing = info;
        output.push(cache.urls[info.page] || null);
      }
      if (firstMissing) resolveImageBatch(firstMissing, firstMissing.page);
      for (var j = 0; j < pages.length; j++) {
        var nextInfo = descriptorInfo(pages[j]);
        output[j] = cacheFor(nextInfo).urls[nextInfo.page] || null;
      }
      return output;
    },

    // 官网账户数据：这两页要求网页登录后的主站 Cookie。它们不参与首页或普通列表的镜像
    // 选择，避免备用域名把“未登录页面”误当成空收藏/空历史。
    getFavorites: function (page, category, query, sort) {
      var result = requestAccountPath(accountPath('/bookmarker/', page || 1, query, sort), 'GET', null, '/');
      return parseAccountList(result.response.body, result.mirror, 'favorites');
    },

    getHistory: function (page, query) {
      var result = requestAccountPath(accountPath('/comichistory/', page || 1, query, null), 'GET', null, '/');
      return parseAccountList(result.response.body, result.mirror, 'history');
    },

    // MangaBZ does not expose a stable profile API. Provide a useful on-demand
    // account overview from its two authenticated account pages instead.
    getAccountOverview: function () {
      var favoritesResponse = requestAccountPath('/bookmarker/', 'GET', null, '/');
      var historyResponse = requestAccountPath('/comichistory/', 'GET', null, '/');
      var favorites = parseAccountList(
        favoritesResponse.response.body,
        favoritesResponse.mirror,
        'favorites'
      );
      var history = parseAccountList(
        historyResponse.response.body,
        historyResponse.mirror,
        'history'
      );
      return {
        isSupported: true,
        sections: [
          {
            id: 'account',
            title: '账户',
            metrics: [
              { id: 'status', title: '登录状态', value: '已登录' }
            ]
          },
          {
            id: 'library',
            title: '云端书架',
            metrics: [
              { id: 'favorites_count', title: '本页收藏', value: String(favorites.items.length) },
              { id: 'history_count', title: '本页阅读记录', value: String(history.items.length) }
            ]
          }
        ],
        message: null
      };
    },

    deleteAccountShelfItems: function (mangas, kind) {
      return deleteAccountShelfItems(mangas, kind);
    },

    getFavoriteState: function (manga) {
      var state = accountFavoriteState(manga);
      return {
        isSupported: state.isSupported,
        isFavorited: state.isFavorited,
        category: null,
        categories: [],
        note: null,
        message: null
      };
    },

    // MangaBZ 没有收藏夹分类；契约里的 category/note 对该站忽略。
    setFavorite: function (manga, category, note) {
      var state = accountFavoriteState(manga);
      return state.isFavorited ? {
        isSupported: true,
        isFavorited: true,
        category: null,
        categories: [],
        note: null,
        message: '已在 MangaBZ 收藏中'
      } : toggleAccountFavorite(manga);
    },

    removeFavorite: function (manga) {
      var state = accountFavoriteState(manga);
      return state.isFavorited ? toggleAccountFavorite(manga) : {
        isSupported: true,
        isFavorited: false,
        category: null,
        categories: [],
        note: null,
        message: '已不在 MangaBZ 收藏中'
      };
    },

    getFilterList: function () {
      var traditional = languageValue() === '1';
      return [
        {
          key: 'search_mode', name: traditional ? '搜尋方式' : '搜索方式', kind: 'select',
          values: traditional ? ['全部', '漫畫名稱', '作者'] : ['全部', '漫画名称', '作者'],
          defaultValue: '0', scope: 'keyword'
        },
        {
          key: 'genre', name: traditional ? '題材' : '题材', kind: 'select',
          values: traditional
            ? ['全部', '熱血', '戀愛', '校園', '冒險', '科幻', '生活', '懸疑', '魔法', '運動']
            : ['全部', '热血', '恋爱', '校园', '冒险', '科幻', '生活', '悬疑', '魔法', '运动'],
          defaultValue: '0', scope: 'browse'
        },
        {
          key: 'status', name: traditional ? '狀態' : '状态', kind: 'select',
          values: traditional ? ['全部', '連載中', '完結'] : ['全部', '连载中', '完结'],
          defaultValue: '0', scope: 'browse'
        },
        {
          key: 'ordering', name: traditional ? '排序' : '排序', kind: 'sort',
          values: traditional ? ['人氣', '更新時間'] : ['人气', '更新时间'],
          defaultValue: '0', scope: 'browse'
        }
      ];
    }
  };
})();
