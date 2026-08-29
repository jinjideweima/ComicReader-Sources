// 绅士漫画（WNACG）图源插件。
// 主站固定为 wnacg.com；其余域名仅作官网不可用时的备用线路。
(function () {
  // The mobile site uses a different, reduced DOM. Request the canonical desktop
  // markup on every platform so iPhone, iPad, and Mac share one parser contract.
  var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  var SITES = [
    { id: 'main', base: 'https://www.wnacg.com' },
    { id: 'ru', base: 'https://www.wnacg.ru' },
    { id: 'wn09-cfd', base: 'https://www.wn09.cfd' },
    { id: 'wn09-shop', base: 'https://www.wn09.shop' },
    { id: 'wn08-cfd', base: 'https://www.wn08.cfd' },
    { id: 'wn08-shop', base: 'https://www.wn08.shop' }
  ];
  var HOME_SECTIONS = [
    { id: 'latest', title: '最新更新', cardCategory: '最新更新', path: '/albums.html', category: null, limit: 6 },
    { id: 'doujin', title: '同人志', cardCategory: '同人志', path: '/albums-index-cate-5.html', category: '5', limit: 12 },
    { id: 'tankoubon', title: '单行本', cardCategory: '单行本', path: '/albums-index-cate-6.html', category: '6', limit: 12 },
    { id: 'magazine', title: '杂志与短篇', cardCategory: '杂志与短篇', path: '/albums-index-cate-7.html', category: '7', limit: 12 },
    { id: 'korean', title: '韩国漫画', cardCategory: '韩国漫画', path: '/albums-index-cate-19.html', category: '19', limit: 12 },
    { id: 'cosplay', title: 'Cosplay 写真', cardCategory: 'Cosplay 写真', path: '/albums-index-cate-3.html', category: '3', limit: 12 }
  ];
  var CATEGORY_GROUPS = {
    doujin: [
      ['5', '全部'], ['1', '汉化'], ['12', '日语'], ['16', 'English'],
      ['2', 'CG 画集'], ['37', 'AI 图集'], ['22', '3D 漫画'], ['3', 'Cosplay']
    ],
    tankoubon: [['6', '全部'], ['9', '汉化'], ['13', '日语'], ['17', 'English']],
    magazine: [['7', '全部'], ['10', '汉化'], ['14', '日语'], ['18', 'English']],
    korean: [['19', '全部'], ['20', '汉化'], ['21', '其他']],
    cosplay: [['3', 'Cosplay']]
  };
  var RANKING_CATEGORIES = [
    ['0', '全部分类'],
    ['5', '同人志'], ['12', '同人志／日语'], ['16', '同人志／English'], ['1', '同人志／汉化'], ['2', '同人志／CG 画集'],
    ['6', '单行本'], ['13', '单行本／日语'], ['17', '单行本／English'], ['9', '单行本／汉化'],
    ['7', '杂志与短篇'], ['14', '杂志与短篇／日语'], ['18', '杂志与短篇／English'], ['10', '杂志与短篇／汉化'],
    ['3', '写真与 Cosplay'],
    ['19', '韩国漫画'], ['21', '韩国漫画／生肉'], ['20', '韩国漫画／汉化'],
    ['22', '3D 漫画'], ['23', '3D 漫画／汉化'], ['24', '3D 漫画／其他'],
    ['37', 'AI 图集']
  ];

  function trim(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function configuredSites() {
    var selected = storage.get('mirror') || 'auto';
    if (selected !== 'auto') {
      return SITES.filter(function (site) { return site.id === selected; });
    }
    var last = storage.get('last_working_site') || '';
    var ordered = [SITES[0]];
    SITES.forEach(function (site) {
      if (site.base === last && site.id !== 'main') ordered.push(site);
    });
    SITES.forEach(function (site) {
      if (!ordered.some(function (value) { return value.id === site.id; })) ordered.push(site);
    });
    return ordered;
  }

  function headers(base, cookie) {
    var result = {
      'User-Agent': UA,
      'Referer': base + '/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache'
    };
    if (cookie) result.Cookie = cookie;
    return result;
  }

  function pathOnly(value) {
    var source = String(value || '');
    var match = source.match(/^https?:\/\/[^/]+(\/[^#]*)?/i);
    if (match) return match[1] || '/';
    return source.charAt(0) === '/' ? source : '/' + source;
  }

  function request(path, cookie) {
    var sites = configuredSites();
    var lastError = null;
    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      try {
        var response = fetch(site.base + pathOnly(path), {
          headers: headers(site.base, cookie),
          cachePolicy: 'reloadIgnoringLocalCacheData',
          timeout: 20
        });
        var status = Number(response.status || 0);
        if (status >= 400 || !String(response.body || '').trim()) {
          throw new Error('HTTP ' + status);
        }
        if (site.id !== 'main') storage.set('last_working_site', site.base);
        else storage.set('last_working_site', null);
        return { response: response, base: site.base, doc: parseHTML(response.body, site.base) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('绅士漫画全部线路暂时不可用');
  }

  function absoluteURL(value, base) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\/{2,}/.test(raw)) return 'https://' + raw.replace(/^\/+/, '');
    if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:');
    if (raw.charAt(0) === '/') return base + raw;
    return base + '/' + raw;
  }

  function textOf(root, selector) {
    if (!root) return '';
    var element = root.selectFirst(selector);
    return element ? trim(element.text()) : '';
  }

  function albumID(value) {
    var match = String(value || '').match(/(?:aid[-=]|photos-index-aid-)(\d+)/i);
    if (!match) match = String(value || '').match(/\b(\d{3,})\b/);
    return match ? match[1] : trim(value);
  }

  function mangaFromCard(card, base, categoryTitle) {
    var anchor = card.selectFirst('.title a') || card.selectFirst('.pic_box a') || card.selectFirst('a[href*="aid-"]');
    var image = card.selectFirst('.pic_box img') || card.selectFirst('img');
    if (!anchor) return null;
    var href = anchor.attr('href') || anchor.attr('abs:href') || '';
    var id = albumID(href);
    var title = trim(anchor.attr('title') || anchor.text() || (image ? image.attr('alt') : ''));
    if (!id || !title) return null;
    var infoText = textOf(card, '.info_col');
    var pagesMatch = infoText.match(/(\d+)\s*(?:[Pp]|張圖片|张图片)/);
    var dateMatch = infoText.match(/\b(\d{4}-\d{1,2}-\d{1,2})\b/);
    var info = {};
    if (pagesMatch) info.pages = pagesMatch[1];
    if (dateMatch) info.updatedAt = dateMatch[1];
    if (categoryTitle) info.category = categoryTitle;
    return {
      id: id,
      url: pathOnly(href || ('/photos-index-aid-' + id + '.html')),
      title: title,
      coverURL: image ? absoluteURL(image.attr('data-original') || image.attr('data-src') || image.attr('src'), base) : null,
      author: null,
      genres: [],
      status: 'completed',
      info: info
    };
  }

  function parseCards(root, base, limit, categoryTitle) {
    var output = [];
    var seen = {};
    root.select('.gallary_item').forEach(function (card) {
      if (limit && output.length >= limit) return;
      var manga = mangaFromCard(card, base, categoryTitle);
      if (!manga || seen[manga.id]) return;
      seen[manga.id] = true;
      output.push(manga);
    });
    return output;
  }

  function hasNextPage(doc) {
    var next = doc.selectFirst('span.thispage + a') || doc.selectFirst('.next a') || doc.selectFirst('a.next');
    if (!next) return false;
    var href = next.attr('href') || '';
    return href.indexOf('page-') >= 0 || trim(next.text()).indexOf('下一') >= 0;
  }

  function pagePath(category, page) {
    var p = Math.max(1, Number(page || 1));
    if (category) return '/albums-index-page-' + p + '-cate-' + category + '.html';
    return p === 1 ? '/albums.html' : '/albums-index-page-' + p + '.html';
  }

  function filterValue(filters, key, fallback) {
    var list = filters || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return String(list[i].value);
    }
    return fallback;
  }

  function categoryForSection(sectionID) {
    for (var i = 0; i < HOME_SECTIONS.length; i++) {
      if (HOME_SECTIONS[i].id === sectionID) return HOME_SECTIONS[i].category;
    }
    return null;
  }

  function sortCookie(filters) {
    var selected = filterValue(filters, 'sort', 'created');
    var value = selected === 'uploaded' || selected === '1' ? 'ut_desc'
      : (selected === 'pages' || selected === '2' ? 'p_desc' : 'ct_asc');
    return 'Mpic_sortset_album=' + value;
  }

  function listing(page, category, filters) {
    var result = request(pagePath(category, page), sortCookie(filters));
    var items = parseCards(result.doc, result.base);
    return { items: items, hasNextPage: hasNextPage(result.doc) || items.length >= 20 };
  }

  function searchListing(page, query, filters) {
    var section = filterValue(filters, 'home_section', '');
    var category = filterValue(filters, 'category_id', '') || categoryForSection(section);
    if (!trim(query)) return listing(page, category, filters);
    var p = Math.max(1, Number(page || 1));
    var path = '/search/index.php?q=' + encodeURIComponent(trim(query)) + '&p=' + p + '&f=_all&syn=yes';
    var result = request(path, sortCookie(filters));
    var items = parseCards(result.doc, result.base);
    return { items: items, hasNextPage: hasNextPage(result.doc) || items.length >= 20 };
  }

  function rankingPath(page, period, category) {
    var p = Math.max(1, Number(page || 1));
    var type = ['day', 'week', 'month', 'year'].indexOf(period) >= 0 ? period : 'week';
    var path = '/albums-favorite_ranking';
    if (p > 1) path += '-page-' + p;
    path += '-type-' + type;
    if (category && category !== '0') path += '-cate-' + category;
    return path + '.html';
  }

  function rankingState(page, kind, period) {
    var rawKind = String(kind || '0');
    var category = rawKind.replace(/^wnacg:/, '');
    if (!category || category === 'gallery') category = '0';
    var result = request(rankingPath(page, period, category));
    var cards = result.doc.select('.gallary_item');
    var entries = [];
    cards.forEach(function (card, index) {
      var manga = mangaFromCard(card, result.base);
      if (!manga) return;
      var raw = trim(card.text());
      var scoreMatch = raw.match(/[❤♥]\s*([0-9,]+)/) || raw.match(/收藏[^0-9]*([0-9,]+)/);
      var rankMatch = raw.match(/^#?\s*(\d+)/);
      var rank = rankMatch ? rankMatch[1] : String((Number(page || 1) - 1) * 20 + index + 1);
      entries.push({
        id: String(period || 'week') + ':' + category + ':' + manga.id,
        rank: rank,
        score: scoreMatch ? scoreMatch[1] + ' 收藏' : '',
        title: manga.title,
        subtitle: null,
        url: manga.url,
        manga: manga
      });
    });
    return {
      isSupported: true,
      title: '收藏排行榜',
      kind: 'wnacg:' + category,
      period: period || 'week',
      entries: entries,
      hasNextPage: hasNextPage(result.doc) || entries.length >= 20,
      message: entries.length ? null : '官网当前没有返回排行内容'
    };
  }

  function detailPath(manga) {
    return '/photos-index-aid-' + albumID(manga.id || manga.url) + '.html';
  }

  function detailMetadata(doc) {
    var values = {};
    doc.select('.uwconn > label, .uwconn label').forEach(function (label) {
      var value = trim(label.text());
      var match = value.match(/^([^：:]+)[：:]\s*(.+)$/);
      if (match) values[trim(match[1])] = trim(match[2]);
    });
    return values;
  }

  function parseDescription(doc) {
    var paragraph = doc.selectFirst('.uwconn > p') || doc.selectFirst('.uwconn p');
    if (!paragraph) return null;
    var text = trim(paragraph.text()).replace(/^(?:简介|簡介)\s*[：:]\s*/i, '').trim();
    return text || null;
  }

  function parseDetails(manga, result) {
    var doc = result.doc;
    var id = albumID(manga.id || manga.url);
    var title = textOf(doc, '#bodywrap.userwrap h2') || textOf(doc, '.userwrap h2') || textOf(doc, 'h2') || manga.title;
    var cover = doc.selectFirst('.uwthumb img');
    var metadata = detailMetadata(doc);
    var category = metadata['分类'] || metadata['分類'] || '';
    var pagesText = metadata['页数'] || metadata['頁數'] || '';
    var pageMatch = pagesText.match(/\d+/);
    var uploader = textOf(doc, '.uwuinfo > a p') || textOf(doc, '.uwuinfo a');
    var posted = metadata['创建时间'] || metadata['創建時間']
      || metadata['上传时间'] || metadata['上傳時間']
      || metadata['发布时间'] || metadata['發佈時間'] || '';
    var tags = [];
    var seen = {};
    doc.select('.addtags a.tagshow, a.tagshow').forEach(function (tag) {
      var value = trim(tag.text());
      if (value && !seen[value]) { seen[value] = true; tags.push(value); }
    });
    var info = {};
    if (pageMatch) info.pages = pageMatch[0];
    if (category) info.category = category;
    if (uploader) info.uploader = uploader;
    if (posted) info.posted = posted;
    info.contentKind = 'gallery';
    return {
      id: id,
      url: detailPath(manga),
      title: title,
      coverURL: cover ? absoluteURL(cover.attr('src') || cover.attr('data-original'), result.base) : manga.coverURL,
      highResolutionCoverURL: cover ? absoluteURL(cover.attr('src') || cover.attr('data-original'), result.base) : manga.coverURL,
      author: uploader || null,
      description: parseDescription(doc),
      genres: tags,
      status: 'completed',
      info: info
    };
  }

  function pageURLs(body) {
    var match = String(body || '').match(/"page_url"\s*:\s*\[([\s\S]*?)\]/);
    if (!match) return [];
    var urls = [];
    var seen = {};
    var re = /["'](https?:\\?\/\\?\/[^"']+)["']/g;
    var item;
    while ((item = re.exec(match[1])) !== null) {
      var url = item[1].replace(/\\\//g, '/').replace(/^http:/i, 'https:');
      if (!seen[url]) { seen[url] = true; urls.push(url); }
    }
    return urls;
  }

  function commentsPage(manga, page) {
    if (Number(page || 1) > 1) return { comments: [], hasNextPage: false, total: null };
    var id = albumID(manga.id || manga.url);
    var result = request('/comment-index-aid-' + id + '.html');
    var comments = [];
    var seen = {};
    result.doc.select('.plItem, .plRe').forEach(function (item, index) {
      var commentID = item.attr('data-id') || ('comment-' + index);
      if (seen[commentID]) return;
      var body = textOf(item, '.plText');
      if (!body) return;
      seen[commentID] = true;
      var avatar = item.selectFirst('img.plAv') || item.selectFirst('img.plReAv')
        || item.selectFirst('.plAv img') || item.selectFirst('.plReAv img');
      var classes = item.attr('class') || '';
      var isReply = classes.indexOf('plRe') >= 0;
      comments.push({
        id: commentID,
        author: textOf(item, '.plName') || '匿名用户',
        dateText: textOf(item, '.plTime') || null,
        body: body,
        score: textOf(item, '.plUp i') || null,
        isUploader: false,
        avatarURL: avatar ? absoluteURL(avatar.attr('src'), result.base) : null,
        parentID: isReply ? (item.attr('data-parent-id') || null) : null,
        isReply: isReply
      });
    });
    return { comments: comments, hasNextPage: false, total: comments.length };
  }

  function downloadInfo(manga) {
    var id = albumID(manga.id || manga.url);
    var result = request('/download-index-aid-' + id + '.html');
    var body = String(result.response.body || '');
    var server2Anchor = result.doc.selectFirst('a.ads[href*=".zip"]') || result.doc.selectFirst('a[href*=".zip"]');
    var server2 = server2Anchor ? absoluteURL(server2Anchor.attr('href'), result.base) : '';
    var keyMatch = body.match(/FILE_KEY\s*:\s*["']([^"']+)["']/i);
    var nameMatch = body.match(/FILE_NAME\s*:\s*["']([^"']+)["']/i);
    var apiMatch = body.match(/WORKER_API\s*:\s*["']([^"']+)["']/i);
    return {
      id: id,
      server2: server2,
      fileKey: keyMatch ? keyMatch[1] : '',
      fileName: nameMatch ? nameMatch[1] : (trim(manga.title) + '.zip'),
      api: apiMatch ? apiMatch[1] : 'https://d1.wcdn.date/api/generate-link'
    };
  }

  function archiveOptions(info) {
    var options = [];
    if (info.fileKey) options.push({ mode: 'server1', title: '压缩包线路 1', subtitle: '由官网生成下载链接', size: null, cost: null, requiresGPConfirmation: false });
    if (info.server2) options.push({ mode: 'server2', title: '压缩包线路 2', subtitle: '官网备用直链', size: null, cost: null, requiresGPConfirmation: false });
    return options;
  }

  function categoryFilters(section) {
    var values = CATEGORY_GROUPS[section] || [];
    return values.map(function (value) { return { value: value[0], title: value[1] }; });
  }

  globalThis.__source = {
    getHome: function () {
      var home = request('/');
      var wraps = home.doc.select('.bodywrap .gallary_wrap, .bodywrap.gallary_wrap');
      var sections = [];
      HOME_SECTIONS.forEach(function (definition, index) {
        var root = wraps[index] || null;
        var items = root ? parseCards(root, home.base, definition.limit, definition.cardCategory) : [];
        if (!items.length) {
          try {
            var fallback = request(definition.path);
            items = parseCards(fallback.doc, fallback.base, definition.limit, definition.cardCategory);
          } catch (_) {}
        }
        sections.push({ id: definition.id, title: definition.title, items: items.slice(0, definition.limit) });
      });
      var ranking;
      try { ranking = rankingState(1, 'wnacg:0', 'week').entries.slice(0, 10); }
      catch (_) { ranking = []; }
      var heroes = ranking.map(function (entry) { return { manga: entry.manga, imageURL: entry.manga.coverURL }; });
      if (!heroes.length && sections.length) {
        heroes = sections[0].items.slice(0, 10).map(function (manga) { return { manga: manga, imageURL: manga.coverURL }; });
      }
      var states = {
        featured: { state: heroes.length ? 'loaded' : 'failed', message: heroes.length ? '本周收藏排行榜' : '排行榜暂时不可用' },
        hotCategories: { state: sections.some(function (section) { return section.items.length; }) ? 'loaded' : 'failed', message: null }
      };
      sections.forEach(function (section) {
        states['hotCategory.' + section.id] = { state: section.items.length ? 'loaded' : 'empty', message: null };
      });
      return { heroes: heroes, popular: [], toplist: [], editor: [], rising: [], hotCategories: sections, sectionStates: states };
    },

    getPopular: function (page) {
      var state = rankingState(page, 'wnacg:0', 'week');
      return { items: state.entries.map(function (entry) { return entry.manga; }), hasNextPage: state.hasNextPage };
    },

    getLatest: function (page) { return listing(page, null, []); },

    search: function (page, query, filters) { return searchListing(page, query, filters || []); },

    getToplist: function (page, period) {
      var state = rankingState(page, 'wnacg:0', period || 'week');
      return { items: state.entries.map(function (entry) { return entry.manga; }), hasNextPage: state.hasNextPage };
    },

    getRankings: function (page, kind, period) { return rankingState(page, kind, period); },

    getMangaDetails: function (manga) { return parseDetails(manga, request(detailPath(manga))); },

    getHighResolutionCover: function (manga) { return parseDetails(manga, request(detailPath(manga))); },

    getChapterList: function (manga) {
      return [{ id: albumID(manga.id || manga.url), url: detailPath(manga), name: manga.title || '全部', number: 1 }];
    },

    getPageList: function (chapter) {
      var id = albumID(chapter.id || chapter.url);
      var result = request('/photos-item-aid-' + id + '.html');
      var urls = pageURLs(result.response.body);
      if (!urls.length) throw new Error('官网阅读页没有返回图片清单');
      return urls.map(function (url, index) { return { index: index, imageURL: url, url: null }; });
    },

    getComments: function (manga) { return commentsPage(manga, 1).comments; },
    getCommentsPage: function (manga, page) { return commentsPage(manga, page); },

    getArchiveOptions: function (manga) {
      var info = downloadInfo(manga);
      var options = archiveOptions(info);
      return { isSupported: options.length > 0, options: options, downloadURL: null, nextURL: null, message: options.length ? '可选择官网压缩包线路，或使用逐页下载。' : '官网暂未提供压缩包。' };
    },

    requestArchive: function (manga, mode) {
      var info = downloadInfo(manga);
      if (mode === 'server2' && info.server2) {
        return { isSupported: true, options: archiveOptions(info), downloadURL: info.server2, nextURL: null, message: '线路 2 已准备完成。' };
      }
      if (mode !== 'server1' || !info.fileKey) {
        return { isSupported: false, options: archiveOptions(info), downloadURL: null, nextURL: null, message: '所选压缩包线路当前不可用。' };
      }
      var response = fetch(info.api, {
        method: 'POST', timeout: 30,
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': 'https://www.wnacg.com', 'Referer': 'https://www.wnacg.com/' },
        body: JSON.stringify({ file_key: info.fileKey, file_name: info.fileName })
      });
      var payload = {};
      try { payload = JSON.parse(response.body || '{}'); } catch (_) {}
      var url = payload.url || (payload.data && payload.data.url) || '';
      return { isSupported: true, options: archiveOptions(info), downloadURL: url || null, nextURL: null, message: url ? '线路 1 已准备完成。' : (payload.message || '官网暂未生成压缩包链接，请稍后重试。') };
    },

    getFilterList: function () {
      return [
        { key: 'sort', name: '排序', kind: 'sort', values: ['创建时间', '上传时间', '图片数'], defaultValue: '0', scope: 'all' }
      ];
    },

    getWNACGCategories: function (section) {
      return { section: section, values: categoryFilters(section), ranking: RANKING_CATEGORIES.map(function (value) { return { value: value[0], title: value[1] }; }) };
    }
  };
})();
