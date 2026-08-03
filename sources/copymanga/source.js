// CopyManga source plug-in. Uses only mangacopy.com / api.mangacopy.com.
(function () {
  var API_HOST = 'api.mangacopy.com';
  var WEB_BASE = 'https://www.mangacopy.com';
  var API_BASE = 'https://' + API_HOST;
  var PAGE_SIZE = 30;
  var WEB_PAGE_SIZE = 50;
  var TOPIC_PAGE_SIZE = 6;
  var TOPIC_CONTENT_PAGE_SIZE = 21;
  var CHAPTER_PAGE_SIZE = 100;
  var RECOMMEND_POS = '3200102';

  var API_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'COPY/3.0.0',
    'version': '2025.08.15',
    'platform': '1',
    'webp': '1',
    'region': '1'
  };
  var WEB_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Referer': WEB_BASE + '/'
  };
  var FALLBACK_THEMES = [
    ['全部', ''], ['愛情', 'aiqing'], ['歡樂向', 'huanlexiang'], ['冒險', 'maoxian'],
    ['奇幻', 'qihuan'], ['百合', 'baihe'], ['校园', 'xiaoyuan'], ['科幻', 'kehuan'],
    ['東方', 'dongfang'], ['耽美', 'danmei'], ['生活', 'shenghuo'], ['格鬥', 'gedou'],
    ['轻小说', 'qingxiaoshuo'], ['其他', 'qita'], ['悬疑', 'xuanyi'], ['TL', 'teenslove'],
    ['萌系', 'mengxi'], ['神鬼', 'shengui'], ['职场', 'zhichang'], ['治愈', 'zhiyu'],
    ['节操', 'jiecao'], ['四格', 'sige'], ['長條', 'changtiao'], ['舰娘', 'jianniang'],
    ['搞笑', 'gaoxiao'], ['竞技', 'jingji'], ['伪娘', 'weiniang'], ['魔幻', 'mohuan'],
    ['热血', 'rexue'], ['性转换', 'xingzhuanhuan'], ['美食', 'meishi'], ['励志', 'lizhi'],
    ['彩色', 'COLOR'], ['後宮', 'hougong'], ['侦探', 'zhentan'], ['惊悚', 'jingsong'],
    ['异世界', 'yishijie'], ['战争', 'zhanzheng'], ['历史', 'lishi'], ['都市', 'dushi']
  ];
  var REGION_OPTIONS = [['全部', ''], ['日漫', '0'], ['韓漫', '1'], ['美漫', '2']];
  var STATUS_OPTIONS = [['全部', ''], ['連載中', '0'], ['已完結', '1'], ['短篇', '2']];
  var ORDERING_OPTIONS = [['更新時間↓', '-datetime_updated'], ['更新時間↑', 'datetime_updated'], ['熱門↓', '-popular'], ['熱門↑', 'popular']];
  var SEARCH_TYPES = [['全部', ''], ['名稱', 'name'], ['作者', 'author'], ['漢化組', 'local']];
  var RANK_PERIODS = [['日榜', 'day'], ['周榜', 'week'], ['月榜', 'month'], ['總榜', 'total']];
  var RANK_AUDIENCES = [['全部', ''], ['男頻', 'male'], ['女頻', 'female']];

  var themeOptions = FALLBACK_THEMES.slice();
  var detailCache = {};

  function apiOptions(extraHeaders) {
    var headers = {};
    Object.keys(API_HEADERS).forEach(function (key) { headers[key] = API_HEADERS[key]; });
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (key) { headers[key] = extraHeaders[key]; });
    return { headers: headers, timeout: 20 };
  }

  function webOptions() {
    return { headers: WEB_HEADERS, timeout: 20 };
  }

  function authHeaders() {
    // ComicReader's native bridge attaches the Keychain token only to the
    // signed manifest's API host/path. JavaScript receives only this non-secret
    // login-state bit and never receives the token value.
    return storage.get('account_logged_in') === '1' ? {} : null;
  }

  function parseEnvelope(response) {
    if (!response || typeof response.status !== 'number') {
      throw new Error('CopyManga empty response');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error('CopyManga HTTP ' + response.status + ': ' + String(response.body || '').slice(0, 160));
    }
    var payload;
    try { payload = JSON.parse(response.body); }
    catch (error) { throw new Error('CopyManga invalid JSON'); }
    if (!payload || typeof payload.code !== 'number') {
      throw new Error('CopyManga invalid API envelope');
    }
    if (payload.code !== 200) {
      throw new Error('CopyManga ' + payload.code + ': ' + (payload.message || 'request failed'));
    }
    return payload.results;
  }

  function apiGet(path, headers) {
    return parseEnvelope(fetch(API_BASE + path, apiOptions(headers)));
  }

  function webAPIGet(path, headers) {
    var options = apiOptions(headers);
    options.headers['Referer'] = WEB_BASE + '/web/person';
    return parseEnvelope(fetch(WEB_BASE + path, options));
  }

  function apiPostForm(path, values, headers) {
    var options = apiOptions(headers);
    options.method = 'POST';
    options.body = queryString(values);
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return parseEnvelope(fetch(API_BASE + path, options));
  }

  function apiGetAll(paths, headers) {
    if (!paths.length) return [];
    var responses = fetchAll(paths.map(function (path) { return API_BASE + path; }), apiOptions(headers));
    return responses.map(function (response, index) {
      if (!response || response.error) return apiGet(paths[index], headers);
      return parseEnvelope(response);
    });
  }

  function webGet(path) {
    var response = fetch(WEB_BASE + path, webOptions());
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error('CopyManga web HTTP ' + (response && response.status));
    }
    return response.body || '';
  }

  function queryString(values) {
    var parts = [];
    Object.keys(values).forEach(function (key) {
      var value = values[key];
      if (value !== null && value !== undefined && value !== '') {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      }
    });
    return parts.join('&');
  }

  function selected(filters, key, fallback) {
    filters = filters || [];
    for (var i = 0; i < filters.length; i++) {
      if (filters[i].key === key) return filters[i].value;
    }
    return fallback;
  }

  function optionValue(options, rawIndex, fallback) {
    var index = parseInt(rawIndex, 10);
    return index >= 0 && index < options.length ? options[index][1] : fallback;
  }

  function optionLabel(options, rawIndex, fallback) {
    var index = parseInt(rawIndex, 10);
    return index >= 0 && index < options.length ? options[index][0] : fallback;
  }

  function absoluteURL(value) {
    if (!value) return null;
    value = String(value);
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf('//') === 0) return 'https:' + value;
    if (value.charAt(0) === '/') return WEB_BASE + value;
    return WEB_BASE + '/' + value;
  }

  function textValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function statusValue(status) {
    if (!status) return 'unknown';
    if (status.value === 0 || String(status.display || '').indexOf('连载') >= 0 || String(status.display || '').indexOf('連載') >= 0) return 'ongoing';
    if (status.value === 1 || String(status.display || '').indexOf('完结') >= 0 || String(status.display || '').indexOf('完結') >= 0) return 'completed';
    return 'unknown';
  }

  function mangaSlug(manga) {
    if (manga.id) return manga.id;
    return String(manga.url || '').replace(/^.*\/comic\//, '').replace(/\/$/, '');
  }

  function listManga(raw) {
    var item = raw && raw.comic ? raw.comic : (raw || {});
    var slug = item.path_word || '';
    var info = {
      updated: item.datetime_updated || raw.datetime_created || '',
      popular: item.popular == null ? '' : String(item.popular),
      latest: item.last_chapter_name || raw.name || ''
    };
    if (raw.sort != null) info.rank = String(raw.sort);
    if (raw.rise_num != null) info.rise = String(raw.rise_num);
    if (raw.last_chapter_name) info.cloudChapter = raw.last_chapter_name;
    if (raw.last_browse && raw.last_browse.last_browse_name) info.lastBrowse = raw.last_browse.last_browse_name;
    if (item.browse && item.browse.chapter_name) info.lastBrowse = item.browse.chapter_name;
    return {
      id: slug,
      url: '/comic/' + slug,
      title: item.name || '',
      coverURL: item.cover || null,
      author: (item.author || []).map(function (author) { return author.name; }).filter(Boolean).join(', ') || null,
      genres: (item.theme || []).map(function (theme) { return theme.name; }).filter(Boolean),
      status: statusValue(item.status),
      info: info
    };
  }

  function pagedList(results, mapper) {
    results = results || {};
    var list = results.list || [];
    var offset = Number(results.offset || 0);
    var limit = Number(results.limit || list.length || PAGE_SIZE);
    var total = Number(results.total || 0);
    return {
      items: list.map(mapper || listManga).filter(function (item) { return item.id && (item.title || item.url); }),
      hasNextPage: offset + limit < total
    };
  }

  function loadDetails(slug) {
    if (detailCache[slug]) return detailCache[slug];
    var results = apiGet('/api/v3/comic2/' + encodeURIComponent(slug) + '?platform=1') || {};
    detailCache[slug] = results;
    return results;
  }

  function dateMilliseconds(value) {
    if (!value) return null;
    var timestamp = new Date(value + (String(value).indexOf('T') >= 0 ? '' : 'T00:00:00Z')).getTime();
    return isNaN(timestamp) ? null : timestamp;
  }

  function chapterFrom(raw, group) {
    var ordered = Number(raw.ordered);
    var number = isFinite(ordered) && ordered > 0 ? ordered / 10 : -1;
    return {
      id: raw.uuid,
      url: '/comic/' + raw.comic_path_word + '/chapter/' + raw.uuid,
      name: raw.name || '',
      number: number,
      dateUpload: dateMilliseconds(raw.datetime_created),
      scanlator: group && group.path_word !== 'default' ? (group.name || group.path_word) : null
    };
  }

  function chaptersForGroup(slug, group) {
    var base = '/api/v3/comic/' + encodeURIComponent(slug) + '/group/' +
      encodeURIComponent(group.path_word) + '/chapters?limit=' + CHAPTER_PAGE_SIZE + '&offset=';
    var first = apiGet(base + '0') || {};
    var chapters = (first.list || []).slice();
    var total = Number(first.total || chapters.length);
    var paths = [];
    for (var offset = CHAPTER_PAGE_SIZE; offset < total; offset += CHAPTER_PAGE_SIZE) {
      paths.push(base + offset);
    }
    apiGetAll(paths).forEach(function (page) {
      chapters = chapters.concat((page && page.list) || []);
    });
    return chapters.map(function (chapter) { return chapterFrom(chapter, group); });
  }

  function orderedPages(chapterData) {
    var contents = chapterData.contents || [];
    var words = chapterData.words || [];
    var valid = contents.length === words.length;
    var seen = {};
    var pairs = [];
    for (var i = 0; i < contents.length; i++) {
      var order = Number(words[i]);
      if (!isFinite(order) || order < 0 || order >= contents.length || Math.floor(order) !== order || seen[order]) valid = false;
      seen[order] = true;
      pairs.push({ order: order, url: contents[i] && contents[i].url });
    }
    if (valid) pairs.sort(function (a, b) { return a.order - b.order; });
    return pairs.filter(function (pair) { return !!pair.url; }).map(function (pair, index) {
      return {
        index: index,
        imageURL: pair.url.replace(/\.c\d+x\./i, '.c1500x.')
      };
    });
  }

  function loadThemeOptions() {
    try {
      var results = apiGet('/api/v3/h5/filterIndex/comic/tags?type=1&platform=1') || {};
      var themes = (results.theme || []).map(function (theme) {
        var label = theme.name + (theme.count != null ? ' (' + theme.count + ')' : '');
        return [label, theme.path_word];
      }).filter(function (theme) { return theme[0] && theme[1]; });
      if (themes.length) themeOptions = [['全部', '']].concat(themes);
    } catch (error) {
      themeOptions = FALLBACK_THEMES.slice();
    }
  }

  function parseBrowseHTML(html) {
    var doc = parseHTML(html, WEB_BASE);
    var cards = doc.select('.exemptComic_Item');
    var items = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var link = card.selectFirst('a[href^="/comic/"]');
      if (!link) continue;
      var href = link.attr('href') || '';
      var slug = href.replace(/^.*\/comic\//, '').replace(/[#?].*$/, '').replace(/\/$/, '');
      var img = card.selectFirst('img');
      var titleNode = card.selectFirst('.twoLines') || card.selectFirst('p') || card.selectFirst('.exemptComicItem-txt a');
      var author = textValue((card.selectFirst('.exemptComicItem-txt-span') || card).text()).replace(/^作者：/, '');
      items.push({
        id: slug,
        url: '/comic/' + slug,
        title: textValue(titleNode ? titleNode.text() : link.text()),
        coverURL: img ? absoluteURL(img.attr('data-src') || img.attr('src')) : null,
        author: author || null,
        genres: [],
        status: 'unknown',
        info: {}
      });
    }
    var total = 0;
    var pageLinks = doc.select('a[href*="offset="]');
    for (var j = 0; j < pageLinks.length; j++) {
      var pageHref = pageLinks[j].attr('href') || '';
      var offsetMatch = pageHref.match(/[?&]offset=(\d+)/);
      var limitMatch = pageHref.match(/[?&]limit=(\d+)/);
      if (offsetMatch) {
        var candidate = Number(offsetMatch[1]) + Number(limitMatch ? limitMatch[1] : WEB_PAGE_SIZE);
        if (candidate > total) total = candidate;
      }
    }
    return {
      items: items,
      hasNextPage: total ? items.length && total > currentOffsetFromHTML(html) + items.length : items.length >= WEB_PAGE_SIZE
    };
  }

  function currentOffsetFromHTML(html) {
    var match = html.match(/[?&]offset=(\d+)&limit=\d+[^"]*["'][^>]*>\s*\d+\s*<\/a>/);
    return match ? Number(match[1]) : 0;
  }

  function browseByWebsite(page, filters) {
    var offset = Math.max(0, page - 1) * WEB_PAGE_SIZE;
    var theme = optionValue(themeOptions, selected(filters, 'theme', '0'), '');
    var region = optionValue(REGION_OPTIONS, selected(filters, 'region', '0'), '');
    var status = optionValue(STATUS_OPTIONS, selected(filters, 'status', '0'), '');
    var ordering = optionValue(ORDERING_OPTIONS, selected(filters, 'ordering', '0'), '-datetime_updated');
    var qs = queryString({
      theme: theme,
      region: region,
      status: status,
      ordering: ordering,
      offset: offset,
      limit: WEB_PAGE_SIZE
    });
    var html = webGet('/comics?' + qs);
    var result = parseBrowseHTML(html);
    // The API gives exact pagination when only one CopyManga API top condition is
    // active. Use it as a fallback if the website layout changes.
    if (!result.items.length) {
      var top = status === '1' ? 'finish' : (region === '0' ? 'japan' : (region === '1' ? 'korea' : (region === '2' ? 'west' : '')));
      return pagedList(apiGet('/api/v3/comics?' + queryString({
        limit: PAGE_SIZE,
        offset: Math.max(0, page - 1) * PAGE_SIZE,
        ordering: ordering,
        theme: theme,
        top: top,
        platform: 1
      })));
    }
    result.hasNextPage = result.items.length >= WEB_PAGE_SIZE;
    return result;
  }

  function collectionFromTopic(raw) {
    raw = raw || {};
    return {
      id: raw.path_word || '',
      title: raw.title || '',
      coverURL: raw.cover || null,
      subtitle: [raw.journal, raw.period, raw.datetime_created].filter(Boolean).join(' · '),
      description: raw.brief || raw.intro || '',
      info: {
        type: raw.type == null ? '1' : String(raw.type),
        period: raw.period || '',
        date: raw.datetime_created || ''
      }
    };
  }

  function parseTopicHTML(html) {
    var doc = parseHTML(html, WEB_BASE);
    var cards = doc.select('.specialContent.comic');
    var items = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var link = card.selectFirst('a[href^="/topic/"]');
      if (!link) continue;
      var slug = (link.attr('href') || '').replace(/^.*\/topic\//, '').replace(/[#?].*$/, '');
      var img = card.selectFirst('img');
      var title = textValue((card.selectFirst('.specialContentImageSpan') || card.selectFirst('.specialContentTitle')).text());
      var desc = textValue((card.selectFirst('.specialContentTextContent') || card).text());
      var date = textValue((card.selectFirst('.specialContentButtonTime') || card).text());
      items.push({
        id: slug,
        title: title,
        coverURL: img ? absoluteURL(img.attr('data-src') || img.attr('src')) : null,
        subtitle: date,
        description: desc,
        info: { type: '1', date: date }
      });
    }
    return items;
  }

  function getHomeIndex() {
    return apiGet('/api/v3/h5/homeIndex?platform=1') || {};
  }

  function homeList(key) {
    var home = getHomeIndex();
    var value = home[key];
    if (!value) return [];
    if (value.list) return value.list;
    return value;
  }

  function homePaged(items, mapper) {
    return { items: (items || []).map(mapper || listManga).filter(function (x) { return x.id && x.title; }), hasNextPage: false };
  }

  function rankPath(page, period, audience) {
    var offset = Math.max(0, page - 1) * PAGE_SIZE;
    return '/api/v3/ranks?' + queryString({
      limit: PAGE_SIZE,
      offset: offset,
      date_type: period || 'day',
      audience_type: audience || '',
      platform: 1
    });
  }

  function favoritesPath(page, sort) {
    return '/api/v3/member/collect/comics?' + queryString({
      limit: PAGE_SIZE,
      offset: Math.max(0, page - 1) * PAGE_SIZE,
      free_type: 1,
      ordering: sort || '-datetime_browse',
      platform: 1
    });
  }

  function requireAuth() {
    var headers = authHeaders();
    if (!headers) throw new Error('请先在拷贝漫画设置中登录账号。');
    return headers;
  }

  globalThis.__source = {
    getPopular: function (page) {
      var offset = Math.max(0, page - 1) * PAGE_SIZE;
      return pagedList(apiGet('/api/v3/recs?pos=' + RECOMMEND_POS + '&limit=' + PAGE_SIZE + '&offset=' + offset + '&platform=1'));
    },

    getLatest: function (page) {
      var offset = Math.max(0, page - 1) * PAGE_SIZE;
      // 官网“热门更新/发现”来自漫画库的更新时间排序，而不是
      // homeIndex.newComics（全新上架）。旧实现误用了 update/newest，
      // 在当前接口上会与全新上架返回同一批内容。
      return pagedList(apiGet('/api/v3/comics?' + queryString({
        limit: PAGE_SIZE,
        offset: offset,
        ordering: '-datetime_updated',
        platform: 1
      })));
    },

    getToplist: function (page, period) {
      period = period || 'day';
      var parts = String(period).split(':');
      return pagedList(apiGet(rankPath(page, parts[0] || 'day', parts[1] || '')));
    },

    getFavorites: function (page, category, query, sort) {
      return pagedList(apiGet(favoritesPath(page, sort || '-datetime_browse'), requireAuth()), function (raw) {
        var manga = listManga(raw);
        if (raw && raw.uuid != null) manga.info.collectID = String(raw.uuid);
        if (raw && raw.last_browse && raw.last_browse.last_browse_name) manga.info.lastBrowse = raw.last_browse.last_browse_name;
        return manga;
      });
    },

    getHistory: function (page) {
      // 官网个人中心当前使用 web/browses；member/browse/comics 已不再是
      // Web 账号浏览记录的有效读取入口。
      return pagedList(webAPIGet('/api/v2/web/browses?' + queryString({
        limit: PAGE_SIZE,
        offset: Math.max(0, page - 1) * PAGE_SIZE,
        free_type: 1,
        platform: 1
      }), requireAuth()), function (raw) {
        var manga = listManga(raw);
        if (raw.last_chapter_name) manga.info.cloudChapter = raw.last_chapter_name;
        return manga;
      });
    },

    // Account profile is fetched on demand and returned only to the native
    // account screen. It is never persisted by the plugin. The native bridge
    // adds the Keychain token after JavaScript has constructed the request.
    getAccountOverview: function () {
      var profile = apiGet('/api/v3/member/info?platform=1', requireAuth()) || {};
      function text(value) {
        return value === null || value === undefined || value === '' ? null : String(value);
      }
      function metric(id, title, value) {
        value = text(value);
        return value === null ? null : { id: id, title: title, value: value };
      }
      var identity = [
        metric('nickname', '昵称', profile.nickname),
        metric('username', '用户名', profile.username),
        metric('created', '注册时间', profile.datetime_created)
      ].filter(Boolean);
      var quota = [
        metric('ticket', '月票', profile.ticket),
        metric('reward_ticket', '奖励月票', profile.reward_ticket),
        metric('downloads', '下载额度', profile.downloads),
        metric('vip_downloads', 'VIP 下载额度', profile.vip_downloads),
        metric('reward_downloads', '奖励下载额度', profile.reward_downloads)
      ].filter(Boolean);
      var sections = [];
      if (identity.length) sections.push({ id: 'identity', title: '账户', metrics: identity });
      if (quota.length) sections.push({ id: 'quota', title: '权益与额度', metrics: quota });
      return { isSupported: true, sections: sections, message: sections.length ? null : '账户没有返回可展示的资料' };
    },

    search: function (page, query, filters) {
      var offset = Math.max(0, page - 1) * PAGE_SIZE;
      query = String(query || '').trim();
      if (query) {
        var qType = optionValue(SEARCH_TYPES, selected(filters, 'q_type', '0'), '');
        var searchQuery = queryString({ limit: PAGE_SIZE, offset: offset, q: query, q_type: qType, platform: 1 });
        return pagedList(apiGet('/api/v3/search/comic?' + searchQuery));
      }
      // CopyManga exposes "全新上架" only through its editorial home payload.
      // Keep it as a source-private browse route so the native UI can open a
      // real "查看更多" page without confusing it with "热门更新".
      if (selected(filters, 'home_section', '') === 'newest') {
        var newItems = homeList('newComics');
        var start = offset;
        var slice = newItems.slice(start, start + PAGE_SIZE);
        return {
          items: slice.map(listManga).filter(function (item) { return item.id && item.title; }),
          hasNextPage: start + PAGE_SIZE < newItems.length
        };
      }
      return browseByWebsite(page, filters);
    },

    getMangaDetails: function (manga) {
      var slug = mangaSlug(manga);
      var results = loadDetails(slug);
      var comic = results.comic || {};
      var authors = (comic.author || []).map(function (author) { return author.name; }).filter(Boolean);
      var genres = (comic.theme || []).map(function (theme) { return theme.name; }).filter(Boolean);
      return {
        id: slug,
        url: '/comic/' + slug,
        title: comic.name || manga.title,
        coverURL: comic.cover || manga.coverURL || null,
        highResolutionCoverURL: comic.cover || manga.coverURL || null,
        author: authors.join(', ') || null,
        description: comic.brief || null,
        genres: genres,
        status: statusValue(comic.status),
        info: {
          alias: comic.alias || '',
          updated: comic.datetime_updated || '',
          popular: comic.popular == null ? '' : String(comic.popular),
          region: comic.region ? (comic.region.display || '') : '',
          restriction: comic.restrict ? (comic.restrict.display || '') : '',
          category: comic.reclass ? (comic.reclass.display || '') : '',
          comicID: comic.uuid || comic.id || '',
          isLogin: results.is_login == null ? '' : String(results.is_login),
          isCollected: results.is_collect == null ? '' : String(results.is_collect)
        }
      };
    },

    getFavoriteState: function (manga) {
      if (!authHeaders()) {
        return {
          isSupported: true, isFavorited: false, category: null,
          categories: [], note: null, message: '请先登录拷贝漫画账号'
        };
      }
      var results = loadDetails(mangaSlug(manga));
      return {
        isSupported: true,
        isFavorited: results.is_collect === true || results.is_collect === 1 ||
          String(results.is_collect) === 'true' || String(results.is_collect) === '1',
        category: null,
        categories: [],
        note: null,
        message: null
      };
    },

    setFavorite: function (manga, category, note) {
      var slug = mangaSlug(manga);
      var results = loadDetails(slug);
      var comic = results.comic || {};
      var comicID = comic.uuid || comic.id;
      if (!comicID) throw new Error('拷贝漫画详情缺少收藏所需的漫画 ID。');
      apiPostForm('/api/v2/web/collect', {
        comic_id: comicID,
        is_collect: 1
      }, requireAuth());
      delete detailCache[slug];
      return {
        isSupported: true, isFavorited: true, category: null,
        categories: [], note: null, message: '已同步到拷贝漫画书架'
      };
    },

    removeFavorite: function (manga) {
      var slug = mangaSlug(manga);
      var results = loadDetails(slug);
      var comic = results.comic || {};
      var comicID = comic.uuid || comic.id;
      if (!comicID) throw new Error('拷贝漫画详情缺少收藏所需的漫画 ID。');
      apiPostForm('/api/v2/web/collect', {
        comic_id: comicID,
        is_collect: 0
      }, requireAuth());
      delete detailCache[slug];
      return {
        isSupported: true, isFavorited: false, category: null,
        categories: [], note: null, message: '已从拷贝漫画书架移除'
      };
    },

    getChapterList: function (manga) {
      var slug = mangaSlug(manga);
      var details = loadDetails(slug);
      var groups = details.groups || {};
      var chapters = [];
      Object.keys(groups).forEach(function (key) {
        var group = groups[key] || {};
        group.path_word = group.path_word || key;
        chapters = chapters.concat(chaptersForGroup(slug, group));
      });
      var seen = {};
      return chapters.filter(function (chapter) {
        if (!chapter.id || seen[chapter.id]) return false;
        seen[chapter.id] = true;
        return true;
      });
    },

    getPageList: function (chapter) {
      var path = String(chapter.url || '');
      var match = path.match(/\/comic\/([^/]+)\/chapter\/([^/?#]+)/);
      if (!match) throw new Error('CopyManga invalid chapter URL: ' + path);
      var results = apiGet('/api/v3/comic/' + encodeURIComponent(match[1]) + '/chapter2/' +
        encodeURIComponent(match[2]) + '?platform=1', authHeaders() || undefined) || {};
      return orderedPages(results.chapter || {});
    },

    getCollections: function (page) {
      var offset = Math.max(0, page - 1) * TOPIC_PAGE_SIZE;
      try {
        return pagedList(apiGet('/api/v3/topics?limit=' + TOPIC_PAGE_SIZE + '&offset=' + offset + '&platform=1'), collectionFromTopic);
      } catch (error) {
        var html = webGet('/topic?' + queryString({ offset: offset, limit: TOPIC_PAGE_SIZE }));
        var items = parseTopicHTML(html);
        return { items: items, hasNextPage: items.length >= TOPIC_PAGE_SIZE };
      }
    },

    getCollectionManga: function (collection, page) {
      var slug = collection.id;
      var topicType = collection.info && collection.info.type ? Number(collection.info.type) : 1;
      if (!slug) throw new Error('CopyManga invalid topic id');
      if (page === 1 && (!collection.description || !collection.info || !collection.info.type)) {
        try {
          var topic = apiGet('/api/v3/topic/' + encodeURIComponent(slug) + '?platform=1') || {};
          topicType = Number(topic.type || topicType);
        } catch (error) {}
      }
      return pagedList(apiGet('/api/v3/topic/' + encodeURIComponent(slug) + '/contents?' + queryString({
        type: topicType || 1,
        limit: TOPIC_CONTENT_PAGE_SIZE,
        offset: Math.max(0, page - 1) * TOPIC_CONTENT_PAGE_SIZE,
        platform: 1
      })));
    },

    getFilterList: function () {
      loadThemeOptions();
      return [
        { key: 'q_type', name: '搜索方式', kind: 'select', values: SEARCH_TYPES.map(function (item) { return item[0]; }), defaultValue: '0', scope: 'keyword' },
        { key: 'theme', name: '题材', kind: 'select', values: themeOptions.map(function (theme) { return theme[0]; }), defaultValue: '0', scope: 'browse' },
        { key: 'region', name: '地区', kind: 'select', values: REGION_OPTIONS.map(function (item) { return item[0]; }), defaultValue: '0', scope: 'browse' },
        { key: 'status', name: '状态', kind: 'select', values: STATUS_OPTIONS.map(function (item) { return item[0]; }), defaultValue: '0', scope: 'browse' },
        { key: 'ordering', name: '排序', kind: 'sort', values: ORDERING_OPTIONS.map(function (item) { return item[0]; }), defaultValue: '0', scope: 'browse' }
      ];
    },

    getCopyMangaHome: function () {
      var home = getHomeIndex();
      return {
        featured: homePaged(home.banners || [], function (raw) { return listManga(raw.comic || raw); }).items,
        recommended: homePaged((home.recComics && home.recComics.list) || [], listManga).items,
        latest: homePaged(home.newComics || [], listManga).items,
        popular: homePaged(home.hotComics || [], listManga).items,
        completed: homePaged((home.finishComics && home.finishComics.list) || [], listManga).items,
        rankDay: homePaged((home.rankDayComics && home.rankDayComics.list) || [], listManga).items,
        rankWeek: homePaged((home.rankWeekComics && home.rankWeekComics.list) || [], listManga).items,
        rankMonth: homePaged((home.rankMonthComics && home.rankMonthComics.list) || [], listManga).items,
        topics: ((home.topics && home.topics.list) || home.topicsList || []).map(collectionFromTopic).filter(function (topic) { return topic.id && topic.title; })
      };
    }
  };
})();
