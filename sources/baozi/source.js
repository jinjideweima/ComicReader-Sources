// 包子漫画图源插件（对齐 keiyoushi BaoziTheme 语义；选择器/结构按真实站点 www.baozimh.com /
// www.twmanga.com 实测确定）。
// 引擎契约：把图源对象赋给 globalThis.__source；可用全局：fetch / parseHTML / storage / btoa / atob / console。
// 选择器语义同 Jsoup（SwiftSoup）。
//
// 站点分工：
//   SITE   www/cn.baozimh.com   列表(API)/详情/章节/搜索（繁/简）
//   READER www/cn.twmanga.com  普通章节阅读页
//   APP    appgb*-vdkr.baozimh.com  官网把最新章替换成下载提示时的真实阅读页
//   COVER  static-tw.baozimh.com 封面 CDN
// 取图直链在阅读页 amp-img 上已是绝对地址（s2.bzcdn.net 等），无需拼接。
(function () {
  var SITE_MIRRORS = [
    { id: 'baozimh', tw: 'https://www.baozimh.com', cn: 'https://cn.baozimh.com' },
    { id: 'webmota', tw: 'https://www.webmota.com', cn: 'https://cn.webmota.com' },
    { id: 'kukuc', tw: 'https://www.kukuc.co', cn: 'https://cn.kukuc.co' },
    { id: 'twmanga', tw: 'https://www.twmanga.com', cn: 'https://cn.twmanga.com' },
    { id: 'dinnerku', tw: 'https://www.dinnerku.com', cn: 'https://cn.dinnerku.com' }
  ];
  var READER_MIRRORS = [
    { id: 'twmanga', tw: 'https://www.twmanga.com', cn: 'https://cn.twmanga.com' },
    { id: 'webmota', tw: 'https://www.webmota.com', cn: 'https://cn.webmota.com' },
    { id: 'kukuc', tw: 'https://www.kukuc.co', cn: 'https://cn.kukuc.co' },
    { id: 'dinnerku', tw: 'https://www.dinnerku.com', cn: 'https://cn.dinnerku.com' },
    { id: 'baozimh', tw: 'https://www.baozimh.com', cn: 'https://cn.baozimh.com' }
  ];
  // 包子网页端会把每部漫画的最新章替换成固定的「请在 APP 内阅读」图片。
  // 这些官方 App 阅读域名会返回同一章节的真实图片，且繁简共用同一组入口。
  var APP_READER_MIRRORS = [
    { id: 'appgb-vdkr', tw: 'https://appgb-vdkr.baozimh.com', cn: 'https://appgb-vdkr.baozimh.com' },
    { id: 'appgb1-vdkr', tw: 'https://appgb1-vdkr.baozimh.com', cn: 'https://appgb1-vdkr.baozimh.com' },
    { id: 'appgb2-vdkr', tw: 'https://appgb2-vdkr.baozimh.com', cn: 'https://appgb2-vdkr.baozimh.com' },
    { id: 'app1-vdkr', tw: 'https://app1-vdkr.baozimh.com', cn: 'https://app1-vdkr.baozimh.com' },
    { id: 'app2-vdkr', tw: 'https://app2-vdkr.baozimh.com', cn: 'https://app2-vdkr.baozimh.com' }
  ];
  var COVER = 'https://static-tw.baozimh.com';
  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  var APP_UA = 'baozimh_android/1.0.31/gb/adset';
  var MIRROR_BASE_COOLDOWN_MS = 15000;
  var MIRROR_MAX_COOLDOWN_MS = 5 * 60 * 1000;
  var lastDetailRequest = null;

  var TYPE_OPTIONS = [
    ['全部', '全部', 'all'], ['恋爱', '戀愛', 'lianai'], ['纯爱', '純愛', 'chunai'], ['古风', '古風', 'gufeng'],
    ['异能', '異能', 'yineng'], ['悬疑', '懸疑', 'xuanyi'], ['剧情', '劇情', 'juqing'], ['科幻', '科幻', 'kehuan'],
    ['奇幻', '奇幻', 'qihuan'], ['玄幻', '玄幻', 'xuanhuan'], ['穿越', '穿越', 'chuanyue'], ['冒险', '冒險', 'mouxian'],
    ['推理', '推理', 'tuili'], ['武侠', '武俠', 'wuxia'], ['格斗', '格鬥', 'gedou'], ['战争', '戰爭', 'zhanzheng'],
    ['热血', '熱血', 'rexie'], ['搞笑', '搞笑', 'gaoxiao'], ['大女主', '大女主', 'danuzhu'], ['都市', '都市', 'dushi'],
    ['总裁', '總裁', 'zongcai'], ['后宫', '後宮', 'hougong'], ['日常', '日常', 'richang'], ['韩漫', '韓漫', 'hanman'],
    ['少年', '少年', 'shaonian'], ['其它', '其它', 'qita']
  ];
  var REGION_OPTIONS = [
    ['全部', '全部', 'all'], ['国漫', '國漫', 'cn'], ['日本', '日本', 'jp'],
    ['韩国', '韓國', 'kr'], ['欧美', '歐美', 'en']
  ];
  var STATUS_OPTIONS = [
    ['全部', '全部', 'all'], ['连载中', '連載中', 'serial'], ['已完结', '已完結', 'pub']
  ];
  var INITIAL_OPTIONS = [
    ['全部', '全部', '*'], ['ABCD', 'ABCD', 'ABCD'], ['EFGH', 'EFGH', 'EFGH'],
    ['IJKL', 'IJKL', 'IJKL'], ['MNOP', 'MNOP', 'MNOP'], ['QRST', 'QRST', 'QRST'],
    ['UVW', 'UVW', 'UVW'], ['XYZ', 'XYZ', 'XYZ'], ['0-9', '0-9', '0-9']
  ];

  function languageValue() {
    return storage.get('language') === 'cn' ? 'cn' : 'tw';
  }

  function mirrorBase(mirror) {
    return languageValue() === 'cn' ? mirror.cn : mirror.tw;
  }

  function siteBase() {
    return mirrorBase(SITE_MIRRORS[0]);
  }

  function readerBase() {
    return mirrorBase(READER_MIRRORS[0]);
  }

  function optionLabel(option) {
    return languageValue() === 'cn' ? option[0] : option[1];
  }

  function mirrorNumber(key) {
    var value = parseInt(storage.get(key), 10);
    return isNaN(value) ? 0 : value;
  }

  function failureKey(group, id, suffix) {
    return 'mirror_' + group + '_' + languageValue() + '_' + suffix + '_' + id;
  }

  function mirrorFailureUntil(group, id) {
    return mirrorNumber(failureKey(group, id, 'failure_until'));
  }

  function mirrorFailureCount(group, id) {
    return mirrorNumber(failureKey(group, id, 'failure_count'));
  }

  function mirrorIsCooling(group, id) {
    return mirrorFailureUntil(group, id) > Date.now();
  }

  function markMirrorSuccess(group, mirror) {
    storage.set(failureKey(group, mirror.id, 'failure_count'), '0');
    storage.set(failureKey(group, mirror.id, 'failure_until'), '0');
    storage.set('active_' + group + '_mirror_' + languageValue(), mirror.id);
  }

  function markMirrorFailure(group, mirror) {
    var failures = Math.min(mirrorFailureCount(group, mirror.id) + 1, 6);
    var cooldown = Math.min(
      MIRROR_BASE_COOLDOWN_MS * Math.pow(2, failures - 1),
      MIRROR_MAX_COOLDOWN_MS
    );
    storage.set(failureKey(group, mirror.id, 'failure_count'), String(failures));
    storage.set(failureKey(group, mirror.id, 'failure_until'), String(Date.now() + cooldown));
  }

  function mirrorOrder(group, mirrors) {
    var active = storage.get('active_' + group + '_mirror_' + languageValue());
    var ordered = [];
    function add(mirror) {
      if (!mirror || ordered.some(function (item) { return item.id === mirror.id; })) return;
      ordered.push(mirror);
    }
    mirrors.forEach(function (mirror) {
      if (mirror.id === active) add(mirror);
    });
    mirrors.forEach(add);
    var healthy = ordered.filter(function (mirror) { return !mirrorIsCooling(group, mirror.id); });
    if (healthy.length) return healthy;
    return ordered.sort(function (left, right) {
      return mirrorFailureUntil(group, left.id) - mirrorFailureUntil(group, right.id);
    });
  }

  function requestPathOf(value) {
    var path = String(value || '').trim().replace(/^https?:\/\/[^/]+/i, '').split('#')[0];
    if (!path) return '/';
    return path.charAt(0) === '/' ? path : '/' + path;
  }

  function requestOptions(mirror, group, kind) {
    var base = mirrorBase(mirror);
    var simplified = languageValue() === 'cn';
    var headers = {
      'Referer': base + '/',
      'User-Agent': UA,
      'Accept-Language': simplified
        ? 'zh-CN,zh-Hans;q=0.9,zh;q=0.8'
        : 'zh-TW,zh-Hant;q=0.9,zh;q=0.8'
    };
    if (kind === 'appReader') {
      headers.Referer = 'https://app.baozimh.com/';
      headers.Origin = siteBase();
      headers['User-Agent'] = APP_UA;
      headers['app-id'] = 'cn.sts.xiaoyun.ordermeals';
      headers['app-version'] = '1.0.31';
    }
    return {
      headers: headers,
      timeout: mirrorFailureCount(group, mirror.id) > 0 ? 3 : 6,
      // 普通首页、详情、章节与图片解析必须保持无 Cookie。账号接入使用同一
      // URLSession，但 Cookie 只允许出现在下面 requestAccount 的官网请求里。
      handleCookies: false
    };
  }

  function responseIsUsable(response, kind) {
    var status = parseInt(response && response.status, 10) || 0;
    var body = String((response && response.body) || '');
    if (status < 200 || status >= 400 || !body.trim()) return false;
    if (/cf-chl-|just a moment|attention required|cloudflare/i.test(body)) return false;
    if (kind === 'api') {
      try { return Array.isArray(JSON.parse(body).items); } catch (e) { return false; }
    }
    if (kind === 'detail') return /comics-detail__title|og:novel:book_name/i.test(body);
    // cn.baozimh.com currently answers valid keyword requests with the homepage
    // (HTTP 200). The homepage itself contains `search-form`, so any generic
    // "search" class check is a false positive. Real simplified/traditional
    // result pages on every healthy mirror expose the dedicated keyword-hinter.
    if (kind === 'search') {
      return /class=["'][^"']*\bkeyword-hinter\b[^"']*["']/i.test(body);
    }
    if (kind === 'account') return /class=["'][^"']*\bbookshelf\b[^"']*["']/i.test(body);
    if (kind === 'reader' || kind === 'appReader') {
      return /comic-contain|next_chapter|next-chapter/i.test(body);
    }
    return /<html|comics-card|index-recommend-items/i.test(body);
  }

  function requestWithMirrors(group, mirrors, value, kind) {
    var path = requestPathOf(value);
    var ordered = mirrorOrder(group, mirrors);
    var lastFailure = '';
    for (var i = 0; i < ordered.length; i++) {
      var mirror = ordered[i];
      var base = mirrorBase(mirror);
      var mappedPath = path;
      if (kind === 'api') {
        mappedPath = path.replace(
          /([?&]__amp_source_origin=)[^&]*/i,
          '$1' + encodeURIComponent(base)
        );
      }
      try {
        var response = fetch(base + mappedPath, requestOptions(mirror, group, kind));
        if (responseIsUsable(response, kind)) {
          markMirrorSuccess(group, mirror);
          return { response: response, mirror: mirror, base: base, path: mappedPath };
        }
        markMirrorFailure(group, mirror);
        lastFailure = mirror.id + ': HTTP ' + String(response.status || 0);
      } catch (error) {
        markMirrorFailure(group, mirror);
        lastFailure = mirror.id + ': ' + String(error && error.message ? error.message : error);
      }
    }
    var target = group === 'app_reader' ? 'APP 阅读接口' : '主站';
    throw new Error('包子漫画' + target + '与备用域名均不可用（' + lastFailure + '）');
  }

  function requestSite(value, kind) {
    return requestWithMirrors('site', SITE_MIRRORS, value, kind);
  }

  // 详情页当前约 1.6 MB；getMangaDetails 与 getChapterList 会在同一个 runtime
  // 内连续读取同一页面。短时复用原始响应，避免串行下载和解析两次。
  function requestDetail(value) {
    var path = requestPathOf(value);
    var key = languageValue() + ':' + path;
    var now = Date.now();
    if (lastDetailRequest &&
        lastDetailRequest.key === key &&
        now - lastDetailRequest.savedAt < 60 * 1000) {
      return lastDetailRequest.result;
    }
    var result = requestSite(path, 'detail');
    lastDetailRequest = { key: key, savedAt: now, result: result };
    return result;
  }

  // Account and temporary-shelf traffic is deliberately pinned to
  // www.baozimh.com. Only this path enables the dedicated native cookie jar;
  // normal browsing and reader requests remain cookie-free.
  function requestAccount(value) {
    var loggedIn = storage.get('account_logged_in') === '1';
    var path = requestPathOf(value);
    var mirror = SITE_MIRRORS[0];
    var base = mirror.tw;
    var options = requestOptions(mirror, 'account', 'account');
    options.handleCookies = true;
    options.cachePolicy = 'reloadIgnoringLocalCacheData';
    options.headers.Referer = base + '/';
    options.headers.Origin = base;
    var response = fetch(base + path, options);
    var finalPath = requestPathOf(response.url || path);
    if (!responseIsUsable(response, 'account')) {
      throw new Error('包子漫画书架暂时无法读取，请稍后重试。');
    }
    if (loggedIn && /\/user\/signin(?:[/?#]|$)/i.test(finalPath)) {
      throw new Error('包子漫画登录状态已失效，请重新登录。');
    }
    return { response: response, mirror: mirror, base: base, path: path };
  }

  function requestReader(value) {
    return requestWithMirrors('reader', READER_MIRRORS, value, 'reader');
  }

  function requestAppReader(value) {
    var path = requestPathOf(value).replace(/^\/baozimhapp(?=\/)/, '');
    return requestWithMirrors(
      'app_reader',
      APP_READER_MIRRORS,
      '/baozimhapp' + path,
      'appReader'
    );
  }

  function readerImageSources(doc, appMode) {
    var imgs = appMode
      ? doc.select('img.comic-contain__item')
      : doc.select('amp-img.comic-contain__item');
    if (imgs.length === 0) {
      imgs = appMode ? doc.select('.comic-contain img') : doc.select('.comic-contain amp-img');
    }
    // 兼容入口切换期间两种标签混用的页面。
    if (imgs.length === 0) imgs = doc.select('.comic-contain__item');
    var sources = [];
    imgs.forEach(function (im) {
      var src = appMode
        ? (im.attr('data-src') || im.attr('abs:src') || im.attr('src'))
        : (im.attr('abs:src') || im.attr('src') || im.attr('data-src'));
      if (src) sources.push(src);
    });
    return sources;
  }

  function isAppOnlyPlaceholder(sources) {
    if (!sources || sources.length === 0) return false;
    // 官网目前把所有被锁定的最新章统一替换成「美少年綁架事件」这套 6 张
    // 下载引导图。繁体站目录是 0/1-iirg，简体站则是 0/2-df6a；目录还可能
    // 随站点部署改变，因此只认固定漫画 slug，不把语言相关目录写死。
    return sources.every(function (src) {
      return String(src).indexOf(
        '/scomic/meishaonianbangjiashijian-aojianyixi2/'
      ) >= 0;
    });
  }

  function floatOf(s) {
    var m = (s || '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : -1;
  }

  function textOf(scope, sel) {
    var e = scope.selectFirst(sel);
    return e ? e.text().trim() : '';
  }

  function metaContent(doc, name) {
    var metas = doc.select('meta');
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].attr('name') === name || metas[i].attr('property') === name) {
        return metas[i].attr('content').trim();
      }
    }
    return '';
  }

  function pathOf(url) {
    var value = String(url || '').trim();
    if (!value) return '';
    value = value.replace(/^https?:\/\/[^/]+/i, '');
    value = value.split('#')[0].split('?')[0];
    return value || '/';
  }

  function coverID(cover) {
    var match = String(cover || '').match(/\/cover\/([^/?#]+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i);
    if (!match || match[1] === 'default_cover') return '';
    try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
  }

  function comicID(cover, url, fallback) {
    var fromCover = coverID(cover);
    if (fromCover) return fromCover;
    if (fallback) return String(fallback);
    var match = pathOf(url).match(/^\/?comic\/([^/]+)\/?$/);
    return match ? match[1] : pathOf(url);
  }

  function highResolutionCover(cover) {
    return cover ? String(cover).split('#')[0].split('?')[0] : '';
  }

  function statusOf(value) {
    var text = String(value || '');
    if (text.indexOf('連載') >= 0 || text.indexOf('连载') >= 0) return 'ongoing';
    if (text.indexOf('完結') >= 0 || text.indexOf('完结') >= 0) return 'completed';
    if (text.indexOf('休載') >= 0 || text.indexOf('休载') >= 0) return 'hiatus';
    return 'unknown';
  }

  function selectedIndex(filters, key, fallback) {
    for (var i = 0; i < (filters || []).length; i++) {
      if (filters[i].key === key) {
        var value = parseInt(filters[i].value, 10);
        return isNaN(value) ? fallback : value;
      }
    }
    return fallback;
  }

  function optionCode(options, index, fallback) {
    return index >= 0 && index < options.length ? options[index][2] : fallback;
  }

  function browsePath(page, filters, base) {
    var type = optionCode(TYPE_OPTIONS, selectedIndex(filters, 'type', 0), 'all');
    var region = optionCode(REGION_OPTIONS, selectedIndex(filters, 'region', 0), 'all');
    var state = optionCode(STATUS_OPTIONS, selectedIndex(filters, 'status', 0), 'all');
    var initial = optionCode(INITIAL_OPTIONS, selectedIndex(filters, 'initial', 0), '*');
    return '/api/bzmhq/amp_comic_list?type=' + encodeURIComponent(type) +
      '&region=' + encodeURIComponent(region) + '&state=' + encodeURIComponent(state) +
      '&filter=' + encodeURIComponent(initial) + '&page=' + page +
      '&limit=36&language=' + languageValue() +
      '&__amp_source_origin=' + encodeURIComponent(base || siteBase());
  }

  function pagedAPI(page, filters) {
    // requestSite 会在每次切换镜像时同步改写 `__amp_source_origin`。
    var result = requestSite(browsePath(page, filters || [], siteBase()), 'api');
    var data;
    try { data = JSON.parse(result.response.body); } catch (e) { data = { items: [], next: '' }; }
    var items = (data.items || []).map(function (it) {
      return {
        id: it.comic_id,
        url: '/comic/' + it.comic_id,
        title: it.name,
        coverURL: it.topic_img ? (COVER + '/cover/' + it.topic_img) : null,
        author: it.author || null,
        genres: it.type_names || [],
        status: 'unknown'
      };
    });
    return { items: items, hasNextPage: !!(data.next && data.next.length) };
  }

  // 从 href 的 query 串解析键值（兼容 &amp; 实体）。
  function parseQuery(url) {
    var q = {};
    var i = (url || '').indexOf('?');
    if (i < 0) return q;
    var s = url.substring(i + 1).replace(/&amp;/g, '&');
    s.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length >= 2) {
        try { q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]); }
        catch (e) { q[kv[0]] = kv[1]; }
      }
    });
    return q;
  }

  // 把一张 .comics-card（首页/搜索的 HTML 卡片）解析成 SourceManga。
  function parseCard(card) {
    var a = card.selectFirst('a.comics-card__poster');
    if (!a) return null;
    var href = a.attr('href');
    if (!href || href.indexOf('{{') >= 0) return null;
    var title = a.attr('title');
    if (!title) title = textOf(card, '.comics-card__title');
    if (!title || title.indexOf('{{') >= 0) return null;
    var img = a.selectFirst('amp-img') || a.selectFirst('img');
    var cover = img ? (img.attr('abs:src') || img.attr('src')) : null;
    var author = textOf(card, '.comics-card__info small.tags');
    var genres = card.select('.tabs .tab').map(function (tag) {
      return tag.text().trim();
    }).filter(function (tag) { return tag.length > 0; });
    return {
      // 官网会给部分详情路径附加校验后缀，但封面文件名仍是稳定 comic_id。
      id: comicID(cover, href, ''),
      url: href,
      title: title,
      coverURL: highResolutionCover(cover) || cover,
      author: author || null,
      genres: genres,
      status: 'unknown'
    };
  }

  function parseCardsIn(scope) {
    var items = [];
    scope.select('.comics-card').forEach(function (c) {
      var m = parseCard(c);
      if (m) items.push(m);
    });
    return items;
  }

  function dedupeManga(items) {
    var seen = {};
    return (items || []).filter(function (item) {
      if (!item || !item.id || seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  }

  function hasBrowseFilters(filters) {
    return (filters || []).some(function (filter) {
      return filter && (
        filter.key === 'type' || filter.key === 'region' ||
        filter.key === 'status' || filter.key === 'initial'
      );
    });
  }

  function filterMangaByQuery(items, query) {
    var needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return items || [];
    return (items || []).filter(function (item) {
      return String(item.title || '').toLocaleLowerCase().indexOf(needle) >= 0 ||
        String(item.author || '').toLocaleLowerCase().indexOf(needle) >= 0;
    });
  }

  function parseShelfItems(doc) {
    var items = [];
    doc.select('.bookshelf-items').forEach(function (row) {
      var titleAnchor = row.selectFirst('.info h4 a') || row.selectFirst('.cover a');
      if (!titleAnchor) return;
      var href = titleAnchor.attr('href') || '';
      var title = titleAnchor.text().trim() || titleAnchor.attr('title');
      if (!href || !title) return;
      var image = row.selectFirst('.cover amp-img') || row.selectFirst('.cover img');
      var cover = image ? (image.attr('abs:src') || image.attr('src')) : null;
      var author = '';
      var status = 'unknown';
      row.select('.info li').forEach(function (line) {
        var text = line.text().trim();
        if (/^(?:作者|作者)：?/.test(text)) {
          author = text.replace(/^(?:作者|作者)\s*[：:]?\s*/, '').trim();
        } else if (/^(?:狀態|状态)\s*[：:]?/.test(text)) {
          status = statusOf(text);
        }
      });
      items.push({
        id: comicID(cover, href, ''),
        url: href,
        title: title,
        coverURL: highResolutionCover(cover) || cover,
        author: author || null,
        genres: [],
        status: status
      });
    });
    return dedupeManga(items);
  }

  function accountShelf() {
    var loggedIn = storage.get('account_logged_in') === '1';
    var result = requestAccount(loggedIn ? '/user/my_bookshelf' : '/user/bookshelf_direct');
    var doc = parseHTML(result.response.body, result.base);
    return { result: result, doc: doc, items: parseShelfItems(doc) };
  }

  function shelfContains(items, manga) {
    var id = comicID(manga.coverURL, manga.url, manga.id);
    return (items || []).some(function (item) {
      return item.id === id || pathOf(item.url) === pathOf(manga.url);
    });
  }

  function favoriteResult(isFavorited, message) {
    return {
      isSupported: true,
      isFavorited: !!isFavorited,
      category: null,
      categories: [],
      note: null,
      message: message || null
    };
  }

  function homeSectionStatus(container, items, title) {
    if (!container) return { state: 'failed', message: '未识别到官网“' + title + '”板块。' };
    if (!items || !items.length) return { state: 'failed', message: '官网“' + title + '”板块解析为空。' };
    return { state: 'loaded', message: null };
  }

  function parseHome(html, base) {
    var doc = parseHTML(html, base);
    var sections = doc.select('.index-recommend-items');
    var popularContainer = null;
    var popular = [];
    var recent = [];
    var categories = [];
    var sectionStates = {};
    var categoryIDs = {
      '推薦國漫': 'cn', '推荐国漫': 'cn',
      '推薦韓漫': 'kr', '推荐韩漫': 'kr',
      '推薦日漫': 'jp', '推荐日漫': 'jp',
      '熱血漫畫': 'hot-blooded', '热血漫画': 'hot-blooded',
      '最新上架': 'new', '最近更新': 'recent'
    };
    sections.forEach(function (section, index) {
      var title = textOf(section, '.catalog-title');
      var items = dedupeManga(parseCardsIn(section));
      if (title.indexOf('熱門漫畫') >= 0 || title.indexOf('热门漫画') >= 0) {
        popularContainer = section;
        popular = items;
        return;
      }
      if (title.indexOf('最近更新') >= 0) recent = items;
      if (title && items.length) {
        var categoryID = categoryIDs[title] || ('section-' + index);
        categories.push({
          id: categoryID,
          title: title,
          items: items
        });
        sectionStates['hotCategory.' + categoryID] = homeSectionStatus(section, items, title);
      }
    });
    var popularState = homeSectionStatus(popularContainer, popular, '热门漫画');
    sectionStates.featured = popularState;
    sectionStates.popular = popularState;
    sectionStates.hotCategories = categories.length
      ? { state: 'loaded', message: null }
      : { state: 'failed', message: '未读取到官网推荐分类。' };
    return {
      heroes: popular.map(function (manga) {
        return { manga: manga, imageURL: manga.coverURL || null };
      }),
      popular: popular,
      toplist: [],
      editor: [],
      rising: recent,
      hotCategories: categories,
      sectionStates: sectionStates
    };
  }

  globalThis.__source = {
    getHome: function () {
      var result = requestSite('/', 'home');
      return parseHome(result.response.body, result.base);
    },

    // 热门：amp_comic_list 综合推荐（JSON，分页由 next 字段判定）。
    getPopular: function (page) {
      return pagedAPI(page, []);
    },

    // 最新：首页「最近更新」版块卡片（单页，无分页）。
    getLatest: function (page) {
      if (page > 1) return { items: [], hasNextPage: false };
      var result = requestSite('/', 'home');
      var doc = parseHTML(result.response.body, result.base);
      var sections = doc.select('.index-recommend-items');
      var container = null;
      for (var i = 0; i < sections.length; i++) {
        var t = sections[i].selectFirst('.catalog-title');
        if (t && t.text().indexOf('最近更新') >= 0) { container = sections[i]; break; }
      }
      var items = container ? parseCardsIn(container) : parseCardsIn(doc);
      return { items: items, hasNextPage: false };
    },

    search: function (page, query, filters) {
      var homeSection = '';
      for (var filterIndex = 0; filterIndex < (filters || []).length; filterIndex++) {
        if (filters[filterIndex].key === 'home_section') {
          homeSection = filters[filterIndex].value;
          break;
        }
      }
      if (!query && (homeSection === 'new' || homeSection === 'recent')) {
        if (page > 1) return { items: [], hasNextPage: false };
        var newResult = requestSite('/list/new', 'list');
        var newDoc = parseHTML(newResult.response.body, newResult.base);
        return { items: dedupeManga(parseCardsIn(newDoc)), hasNextPage: false };
      }
      if (!query) return pagedAPI(page, filters || []);
      // The official classify API owns region/status/initial semantics. When a
      // keyword and classification are both present, search inside that
      // classified page instead of silently discarding the chosen filters.
      if (hasBrowseFilters(filters)) {
        var classified = pagedAPI(page, filters || []);
        classified.items = filterMangaByQuery(classified.items, query);
        return classified;
      }
      // 关键词搜索页目前忽略 page 参数并返回同一批完整结果。
      if (page > 1) return { items: [], hasNextPage: false };
      var result = requestSite('/search?q=' + encodeURIComponent(query), 'search');
      var doc = parseHTML(result.response.body, result.base);
      var items = dedupeManga(parseCardsIn(doc));
      return { items: items, hasNextPage: false };
    },

    getMangaDetails: function (manga) {
      var result = requestDetail(manga.url);
      var res = result.response;
      var doc = parseHTML(res.body, result.base);
      var title = textOf(doc, '.comics-detail__title') ||
        metaContent(doc, 'og:novel:book_name') || manga.title;
      var author = textOf(doc, '.comics-detail__author') ||
        metaContent(doc, 'og:novel:author');
      var desc = textOf(doc, '.comics-detail__desc') ||
        metaContent(doc, 'og:description') || metaContent(doc, 'description');
      var tags = doc.select('.tag-list span').map(function (s) { return s.text().trim(); })
        .filter(function (t) { return t.length > 0; });
      var statusText = metaContent(doc, 'og:novel:status') || (tags[0] || '');
      var status = statusOf(statusText);
      var region = tags.length > 1 ? tags[1] : '';
      var category = metaContent(doc, 'og:novel:category');
      // 可见标签已本地化；meta category 偶尔夹带 `types.*` 内部键，仅作兜底。
      var genres = tags.slice(2);
      if (genres.length === 0 && category) {
        genres = category.split(',').map(function (t) { return t.trim(); })
          .filter(function (t) { return t.length > 0 && t.indexOf('types.') !== 0; });
      }
      var coverImg = doc.selectFirst('.comics-detail__poster amp-img') ||
        doc.selectFirst('.comics-detail__poster img');
      var cover = metaContent(doc, 'og:image') ||
        (coverImg ? (coverImg.attr('abs:src') || coverImg.attr('src')) : '') ||
        manga.coverURL || null;
      cover = highResolutionCover(cover) || cover;
      var canonical = metaContent(doc, 'og:url') || metaContent(doc, 'og:novel:read_url');
      if (!canonical) {
        var canonicalLink = doc.selectFirst('link[rel=canonical]');
        canonical = canonicalLink ? (canonicalLink.attr('abs:href') || canonicalLink.attr('href')) : '';
      }
      canonical = pathOf(canonical || res.url || manga.url);
      var updatedText = textOf(doc, '.comics-detail__info em');
      var updatedMatch = updatedText.match(/\d{4}年\d{1,2}月\d{1,2}日/);
      var chapterCountMatch = (doc.text() || '').match(/查看全部\s*(\d+)\s*(?:話|话|章節|章节|章)/);
      var latestChapter = metaContent(doc, 'og:novel:latest_chapter_name');
      var latestChapterURL = metaContent(doc, 'og:novel:latest_chapter_url');
      var extra = {};
      if (region) extra.region = region;
      if (updatedMatch) extra.updated = updatedMatch[0];
      else if (updatedText) extra.updated = updatedText;
      if (chapterCountMatch) extra.chapters = chapterCountMatch[1];
      if (latestChapter) extra.latestChapter = latestChapter;
      if (latestChapterURL) extra.latestChapterURL = latestChapterURL;
      return {
        id: comicID(cover, canonical, manga.id),
        url: canonical,
        title: title,
        coverURL: cover,
        highResolutionCoverURL: highResolutionCover(cover) || null,
        author: author || null,
        description: desc || null,
        genres: genres,
        status: status,
        info: extra
      };
    },

    getChapterList: function (manga) {
      var result = requestDetail(manga.url);
      var doc = parseHTML(result.response.body, result.base);
      var anchors = doc.select('#chapter-items a.comics-chapters__item');
      var more = doc.select('#chapters_other_list a.comics-chapters__item');
      if (more.length) anchors = anchors.concat(more);
      if (anchors.length === 0) anchors = doc.select('a.comics-chapters__item');

      var seen = {};
      var chapters = [];
      anchors.forEach(function (a) {
        var href = a.attr('href') || '';
        var q = parseQuery(href);
        if (!q.comic_id || q.chapter_slot === undefined) return;
        var key = (q.section_slot || '0') + '_' + q.chapter_slot;
        if (seen[key]) return;
        seen[key] = true;
        // 章节名就在锚点的文本里；用预计算好的 a.text() 直接取，避免对每个锚点
        // 再 selectFirst('span') 触发一次 HTML 重解析——几千章时这是最大的卡顿来源。
        var name = a.text().trim();
        var readURL = readerBase() + '/comic/chapter/' + q.comic_id + '/' +
          (q.section_slot || '0') + '_' + q.chapter_slot + '.html';
        chapters.push({ id: key, url: readURL, name: name, number: floatOf(name) });
      });
      return chapters;
    },

    // 取图：普通章节直接解析网页；若官网返回固定的 APP 引导图，则透明切换到
    // `/baozimhapp/comic/chapter/...` 官方 App 阅读入口。长章节沿「下一頁」续抓。
    getPageList: function (chapter) {
      var pages = [];
      var url = chapter.url;
      var appMode = false;
      var idx = 0;
      var guard = 0;
      var seenURLs = {};
      var seenImages = {};
      while (url && guard < 30) {
        var path = requestPathOf(url);
        var requestKey = (appMode ? 'app:' : 'web:') + path;
        if (seenURLs[requestKey]) break;
        seenURLs[requestKey] = true;
        guard++;
        var result = appMode ? requestAppReader(path) : requestReader(path);
        var doc = parseHTML(result.response.body, result.base);
        var sources = readerImageSources(doc, appMode);
        if (!appMode && isAppOnlyPlaceholder(sources)) {
          appMode = true;
          url = path;
          continue;
        }
        sources.forEach(function (src) {
          if (src && !seenImages[src]) {
            seenImages[src] = true;
            pages.push({ index: idx, imageURL: src });
            idx++;
          }
        });
        var nextA = doc.selectFirst('.next_chapter a');
        var nextText = nextA ? nextA.text() : '';
        if (nextA && (nextText.indexOf('下一頁') >= 0 || nextText.indexOf('下一页') >= 0)) {
          var nextURL = nextA.attr('abs:href') || nextA.attr('href');
          var nextPath = requestPathOf(nextURL);
          var nextKey = (appMode ? 'app:' : 'web:') + nextPath;
          url = nextURL && !seenURLs[nextKey] ? nextPath : null;
        } else {
          url = null;
        }
      }
      return pages;
    },

    getFavorites: function (page, category, query, sort) {
      if (page > 1) return { items: [], hasNextPage: false };
      var shelf = accountShelf();
      var items = filterMangaByQuery(shelf.items, query || '');
      return { items: items, hasNextPage: false };
    },

    // Read only when the native account screen asks for it. The response is
    // reduced to anonymous status/count metrics and is never persisted.
    getAccountOverview: function () {
      var shelf = accountShelf();
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
            id: 'bookshelf',
            title: '书架',
            metrics: [
              { id: 'bookshelf_count', title: '收藏漫画', value: String(shelf.items.length) }
            ]
          }
        ],
        message: null
      };
    },

    getFavoriteState: function (manga) {
      return favoriteResult(
        shelfContains(accountShelf().items, manga),
        null
      );
    },

    // The official detail-page bookmark button uses operation_v2. Under a
    // signed-in TSID the same endpoint writes the permanent account shelf;
    // anonymous sessions instead create the temporary cookie shelf.
    setFavorite: function (manga, category, note) {
      var id = comicID(manga.coverURL, manga.url, manga.id);
      var current = accountShelf();
      if (shelfContains(current.items, manga)) {
        return favoriteResult(
          true,
          storage.get('account_logged_in') === '1'
            ? '已在包子漫画专属书架中'
            : '已在包子漫画临时书架中'
        );
      }
      var result = requestAccount(
        '/user/operation_v2?op=set_bookmark&comic_id=' +
        encodeURIComponent(id) + '&chapter_slot=0'
      );
      var doc = parseHTML(result.response.body, result.base);
      var didAdd = shelfContains(parseShelfItems(doc), manga);
      return favoriteResult(
        didAdd,
        didAdd
          ? (storage.get('account_logged_in') === '1'
              ? '已同步到包子漫画专属书架'
              : '已加入包子漫画临时书架')
          : '官网未确认收藏结果'
      );
    },

    removeFavorite: function (manga) {
      var id = comicID(manga.coverURL, manga.url, manga.id);
      var current = accountShelf();
      if (!shelfContains(current.items, manga)) {
        return favoriteResult(false, '已不在包子漫画书架中');
      }
      var result = requestAccount(
        '/user/operation?op=del_bookmark&comic_id=' + encodeURIComponent(id)
      );
      var doc = parseHTML(result.response.body, result.base);
      var stillFavorited = shelfContains(parseShelfItems(doc), manga);
      return favoriteResult(
        stillFavorited,
        stillFavorited
          ? '官网未确认移除结果'
          : (storage.get('account_logged_in') === '1'
              ? '已从包子漫画专属书架移除'
              : '已从包子漫画临时书架移除')
      );
    },

    getFilterList: function () {
      var simplified = languageValue() === 'cn';
      return [
        {
          key: 'type', name: simplified ? '题材' : '題材', kind: 'select',
          values: TYPE_OPTIONS.map(optionLabel),
          defaultValue: '0', scope: 'always'
        },
        {
          key: 'region', name: simplified ? '地区' : '地區', kind: 'select',
          values: REGION_OPTIONS.map(optionLabel),
          defaultValue: '0', scope: 'always'
        },
        {
          key: 'status', name: simplified ? '进度' : '進度', kind: 'select',
          values: STATUS_OPTIONS.map(optionLabel),
          defaultValue: '0', scope: 'always'
        },
        {
          key: 'initial', name: simplified ? '标题开头' : '標題開頭', kind: 'select',
          values: INITIAL_OPTIONS.map(optionLabel),
          defaultValue: '0', scope: 'always'
        }
      ];
    }
  };
})();
