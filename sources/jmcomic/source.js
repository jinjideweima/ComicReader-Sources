// JMComic (禁漫天堂) source plug-in.
// Engine globals: fetch / parseHTML / storage / crypto / sleep / console.
(function () {
  var API_TOKEN_SECRET = '18comicAPP';
  var API_CONTENT_TOKEN_SECRET = '18comicAPPContent';
  var API_DATA_SECRET = '185Hcomic3PAPP7R';
  var DOMAIN_SERVER_SECRET = 'diosfjckwpqpdfjkvnqQjsik';
  var DEFAULT_APP_VERSION = '2.0.33';
  var API_UA = 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36';
  var DOMAIN_SERVERS = [
    'https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt',
    'https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt'
  ];
  var FALLBACK_API_DOMAINS = [
    'www.cdnhth.club', 'www.cdngwc.cc', 'www.cdngwc.net', 'www.cdngwc.club', 'www.cdnhjk.cc',
    'www.cdnaspa.vip', 'www.cdnaspa.club', 'www.cdnplaystation6.org',
    'www.cdnplaystation6.vip', 'www.cdnplaystation6.cc'
  ];
  var FALLBACK_IMAGE_HOST = 'https://tencent.jmdanjonproxy.xyz';
  var runtimeImageHost = null;
  var runtimeAppVersion = null;
  var settingLoaded = false;

  function unique(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      value = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function savedDomains() {
    try {
      var parsed = JSON.parse(storage.get('api_domains') || '[]');
      return unique(parsed.concat(FALLBACK_API_DOMAINS));
    } catch (_) {
      return FALLBACK_API_DOMAINS.slice();
    }
  }

  function prioritizeDomain(domains, active) {
    if (!active) return domains;
    var index = domains.indexOf(active);
    if (index <= 0) return domains;
    domains.splice(index, 1);
    domains.unshift(active);
    return domains;
  }

  function refreshDomains() {
    var key = crypto.md5(DOMAIN_SERVER_SECRET);
    for (var i = 0; i < DOMAIN_SERVERS.length; i++) {
      try {
        var response = fetch(DOMAIN_SERVERS[i], { timeout: 8, cachePolicy: 'reloadIgnoringLocalCacheData' });
        if (response.status < 200 || response.status >= 300 || !String(response.body || '').trim()) continue;
        var decoded = crypto.aes256ECBDecryptBase64(String(response.body).trim(), key);
        var payload = JSON.parse(decoded);
        var domains = unique((payload.Setting || []).concat(payload.Server || []));
        if (domains.length) {
          storage.set('api_domains', JSON.stringify(domains));
          return domains;
        }
      } catch (_) {}
    }
    return [];
  }

  function timestamp() {
    return String(Math.floor(Date.now() / 1000));
  }

  function encodeForm(fields) {
    return Object.keys(fields || {}).sort().map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key] == null ? '' : String(fields[key]));
    }).join('&');
  }

  function decodedPayload(outer, requestTimestamp) {
    var encoded = outer && outer.data;
    if (encoded === null || encoded === undefined || encoded === '') return null;
    if (encoded === '[]') return [];
    var key = crypto.md5(requestTimestamp + API_DATA_SECRET);
    return JSON.parse(crypto.aes256ECBDecryptBase64(String(encoded), key));
  }

  function requestOnce(host, path, method, fields, tokenSecret, tokenVersion) {
    var ts = timestamp();
    var headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': API_UA,
      'token': crypto.md5(ts + tokenSecret),
      'tokenparam': ts + ',' + (tokenVersion || '')
    };
    var options = { method: method, headers: headers, timeout: 12 };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
      options.body = encodeForm(fields || {});
    }
    var response = fetch('https://' + host + path, options);
    if (response.status < 200 || response.status >= 300) {
      throw new Error('HTTP ' + response.status);
    }
    var outer = JSON.parse(response.body || '{}');
    if (Number(outer.code) !== 200) {
      throw new Error(String(outer.message || outer.msg || 'API ' + outer.code));
    }
    var payload = decodedPayload(outer, ts);
    if (payload && payload.error) throw new Error(String(payload.error));
    storage.set('active_api_domain', host);
    return { data: payload, host: host, response: response };
  }

  function apiRequest(path, method, fields, tokenSecret, tokenVersion) {
    method = method || 'GET';
    var domains = prioritizeDomain(savedDomains(), storage.get('active_api_domain'));
    var lastError = null;
    function attempt(list) {
      for (var i = 0; i < list.length; i++) {
        try {
          return requestOnce(
            list[i], path, method, fields,
            tokenSecret || API_TOKEN_SECRET,
            tokenVersion === undefined ? (method === 'POST' ? appVersion() : '') : tokenVersion
          );
        } catch (error) {
          lastError = error;
        }
      }
      return null;
    }
    var result = attempt(domains);
    if (!result) {
      var refreshed = refreshDomains();
      if (refreshed.length) result = attempt(unique(refreshed.concat(domains)));
    }
    if (!result) {
      throw new Error('禁漫天堂移动 API 当前不可用：' + String(lastError && lastError.message ? lastError.message : lastError));
    }
    return result;
  }

  function apiGet(path) {
    return apiRequest(path, 'GET', null, API_TOKEN_SECRET, '').data;
  }

  function apiPost(path, fields) {
    return apiRequest(path, 'POST', fields, API_TOKEN_SECRET, appVersion()).data;
  }

  function signedPlainGet(path, tokenSecret) {
    var domains = prioritizeDomain(savedDomains(), storage.get('active_api_domain'));
    var lastError = null;
    for (var i = 0; i < domains.length; i++) {
      var ts = timestamp();
      try {
        var response = fetch('https://' + domains[i] + path, {
          headers: {
            'Accept': 'text/html, */*',
            'Accept-Encoding': 'gzip, deflate',
            'User-Agent': API_UA,
            'token': crypto.md5(ts + tokenSecret),
            'tokenparam': ts + ','
          },
          timeout: 12
        });
        if (response.status >= 200 && response.status < 300 && String(response.body || '').trim()) {
          storage.set('active_api_domain', domains[i]);
          return String(response.body);
        }
        lastError = new Error('HTTP ' + response.status);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error('禁漫天堂章节模板不可用：' + String(lastError && lastError.message ? lastError.message : lastError));
  }

  function appVersion() {
    return runtimeAppVersion || storage.get('app_version') || DEFAULT_APP_VERSION;
  }

  function allowedDynamicImageHost(raw) {
    var value = String(raw || '').trim().replace(/\/$/, '');
    var match = value.match(/^https:\/\/([^/]+)$/i);
    if (!match) return null;
    var host = match[1].toLowerCase();
    var suffixes = [
      '.jmdanjonproxy.xyz', '.jmdanjonproxy.vip', '.jmapiproxy1.cc',
      '.jmapiproxy2.cc', '.jmapinodeudzn.net', '.18comic.vip'
    ];
    if (suffixes.some(function (suffix) { return host === suffix.slice(1) || host.slice(-suffix.length) === suffix; })) {
      return value;
    }
    return null;
  }

  function ensureSetting() {
    if (settingLoaded) return;
    settingLoaded = true;
    runtimeImageHost = allowedDynamicImageHost(storage.get('image_host')) || FALLBACK_IMAGE_HOST;
    runtimeAppVersion = storage.get('app_version') || DEFAULT_APP_VERSION;
    try {
      var setting = apiGet('/setting') || {};
      var imageHost = allowedDynamicImageHost(setting.img_host);
      if (imageHost) {
        runtimeImageHost = imageHost;
        storage.set('image_host', imageHost);
      }
      if (setting.jm3_version) {
        runtimeAppVersion = String(setting.jm3_version);
        storage.set('app_version', runtimeAppVersion);
      }
    } catch (_) {}
  }

  function imageHost() {
    ensureSetting();
    return runtimeImageHost || FALLBACK_IMAGE_HOST;
  }

  function absoluteMedia(path) {
    var value = String(path || '');
    if (/^https:/i.test(value)) return value;
    if (/^http:/i.test(value)) return value.replace(/^http:/i, 'https:');
    return imageHost() + (value.charAt(0) === '/' ? value : '/' + value);
  }

  function albumCover(id, highResolution) {
    return imageHost() + '/media/albums/' + id + (highResolution ? '' : '_3x4') + '.jpg';
  }

  function stringList(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (value === null || value === undefined || value === '') return [];
    return [String(value)];
  }

  function firstText(value) {
    return stringList(value).join(', ');
  }

  function albumID(value) {
    var match = String(value || '').match(/(?:^|\/)(\d+)(?:\/|$)/);
    return match ? match[1] : String(value || '').replace(/\D/g, '');
  }

  function mapAlbum(item, highResolution) {
    item = item || {};
    var id = String(item.id || item.AID || '');
    var genres = [];
    if (item.category && item.category.title) genres.push(String(item.category.title));
    if (item.category_sub && item.category_sub.title && genres.indexOf(String(item.category_sub.title)) < 0) {
      genres.push(String(item.category_sub.title));
    }
    stringList(item.tags).forEach(function (tag) { if (genres.indexOf(tag) < 0) genres.push(tag); });
    var info = { jmID: 'JM' + id, contentKind: 'comic' };
    if (item.likes !== undefined && item.likes !== null) info.likes = String(item.likes);
    if (item.total_views !== undefined && item.total_views !== null) info.views = String(item.total_views);
    if (item.total_photos !== undefined && item.total_photos !== null) info.pages = String(item.total_photos);
    if (item.comment_total !== undefined && item.comment_total !== null) info.comments = String(item.comment_total);
    if (item.update_at) info.updatedAt = String(item.update_at);
    return {
      id: id,
      url: '/album/' + id,
      title: String(item.name || item.title || ('JM' + id)),
      coverURL: albumCover(id, !!highResolution),
      highResolutionCoverURL: albumCover(id, true),
      author: firstText(item.author),
      description: item.description ? String(item.description) : null,
      genres: genres,
      status: genres.indexOf('完結') >= 0 || genres.indexOf('完结') >= 0 ? 'completed' : 'unknown',
      info: info
    };
  }

  function mapAlbums(items, limit) {
    var seen = {};
    var output = [];
    (items || []).forEach(function (item) {
      var manga = mapAlbum(item, false);
      if (!manga.id || seen[manga.id]) return;
      seen[manga.id] = true;
      output.push(manga);
    });
    return limit ? output.slice(0, limit) : output;
  }

  function mapEditorial(item, kind) {
    var id = String(item.id || '');
    var path = kind === 'novel' ? '/novel/' + id : '/library/item/' + id;
    var info = { contentKind: kind };
    if (item.likes !== undefined) info.likes = String(item.likes);
    if (item.update_at) info.updatedAt = String(item.update_at);
    return {
      id: kind + ':' + id,
      url: path,
      title: String(item.name || item.title || id),
      coverURL: absoluteMedia(item.image || item.pic_s || ''),
      author: firstText(item.author),
      genres: [kind === 'novel' ? '小说' : '创作者书库'],
      status: 'unknown',
      info: info
    };
  }

  function mapCommunity(id, title, subtitle) {
    return {
      id: 'community:' + id,
      url: '/blogs/' + id,
      title: title,
      coverURL: null,
      description: subtitle,
      genres: ['社区'],
      status: 'unknown',
      info: { contentKind: 'community', subtitle: subtitle }
    };
  }

  function paged(items, page, total, pageSize) {
    pageSize = pageSize || 80;
    var list = mapAlbums(items || []);
    var hasNext = total !== undefined && total !== null
      ? Number(page) * pageSize < Number(total)
      : list.length >= pageSize;
    return { items: list, hasNextPage: hasNext };
  }

  function findPromote(promote, id) {
    for (var i = 0; i < (promote || []).length; i++) {
      if (String(promote[i].id) === String(id)) return promote[i];
    }
    return null;
  }

  function categoryPage(page, category, order, time) {
    var o = order || 'mr';
    if (time && time !== 'a') o += '_' + time;
    var data = apiGet('/categories/filter?page=' + Number(page || 1)
      + '&order=&c=' + encodeURIComponent(category || '0') + '&o=' + encodeURIComponent(o)) || {};
    return paged(data.content || [], page, data.total, 80);
  }

  function promotePage(id, page) {
    var data = apiGet('/promote_list?id=' + encodeURIComponent(id) + '&page=' + Number(page || 1)) || {};
    var items = Array.isArray(data) ? data : (data.list || data.content || []);
    return paged(items, page, data.total, 27);
  }

  function searchPage(page, query, mainTag, order, time) {
    var path = '/search?main_tag=' + encodeURIComponent(mainTag || '0')
      + '&search_query=' + encodeURIComponent(query || '')
      + '&page=' + Number(page || 1)
      + '&o=' + encodeURIComponent(order || 'mr')
      + '&t=' + encodeURIComponent(time || 'a');
    var data = apiGet(path) || {};
    return paged(data.content || [], page, data.total, 80);
  }

  function filterValue(filters, key, fallback) {
    for (var i = 0; i < (filters || []).length; i++) {
      if (filters[i].key === key) return String(filters[i].value);
    }
    return fallback;
  }

  function homeSectionResult(id, page) {
    if (id === 'serialization') return promotePage('26', page);
    if (id === 'jm_translation') {
      var translation = promotePage('998', page);
      return translation.items.length
        ? translation
        : searchPage(page, '禁漫漢化組', '0', 'mr', 'a');
    }
    if (id === 'korean') {
      var korean = promotePage('999', page);
      return korean.items.length ? korean : categoryPage(page, 'hanman', 'mr', 'a');
    }
    if (id === 'c108') return promotePage('29', page);
    if (id === 'uncensored_color') return promotePage('30', page);
    if (id === 'single') return categoryPage(page, 'single', 'mr', 'a');
    if (id === 'latest') {
      var latest = apiGet('/latest?page=' + Number(page || 1)) || [];
      return paged(latest, page, null, 80);
    }
    if (id.indexOf('week:') === 0) {
      if (Number(page || 1) > 1) return { items: [], hasNextPage: false };
      var weekly = apiGet('/week/filter?id=' + encodeURIComponent(id.slice(5))) || {};
      return { items: mapAlbums(weekly.list || []), hasNextPage: false };
    }
    return { items: [], hasNextPage: false };
  }

  function stripHTML(value) {
    var doc = parseHTML('<div>' + String(value || '') + '</div>', 'https://18comic.vip');
    return doc ? doc.text().trim() : String(value || '').replace(/<[^>]+>/g, '').trim();
  }

  function flattenComments(list) {
    var output = [];
    function add(item, reply) {
      var body = stripHTML(item.content || item.comment || '');
      if (!body) body = '[图片评论]';
      output.push({
        id: String(item.CID || item.id || output.length),
        author: String(item.nickname || item.username || '匿名用户'),
        dateText: item.addtime ? String(item.addtime) : null,
        body: reply ? '回复：' + body : body,
        score: item.likes !== undefined ? String(item.likes) : null,
        isUploader: false
      });
      (item.replys || []).forEach(function (child) { add(child, true); });
    }
    (list || []).forEach(function (item) { add(item, false); });
    return output;
  }

  function favoriteState(manga) {
    var detail = apiGet('/album?id=' + encodeURIComponent(albumID(manga.id || manga.url))) || {};
    return {
      isSupported: true,
      isFavorited: detail.is_favorite === true,
      category: null,
      categories: [],
      note: null,
      message: null
    };
  }

  function setFavoriteValue(manga, desired) {
    var state = favoriteState(manga);
    if (state.isFavorited !== desired) {
      apiPost('/favorite', { aid: albumID(manga.id || manga.url) });
      state.isFavorited = desired;
    }
    state.message = desired ? '已加入禁漫天堂收藏' : '已从禁漫天堂收藏移除';
    return state;
  }

  globalThis.__source = {
    getHome: function () {
      ensureSetting();
      var promote = apiGet('/promote') || [];
      var serial = findPromote(promote, '26') || { content: [] };
      var translation = findPromote(promote, '998') || { content: [] };
      var korean = findPromote(promote, '999') || { content: [] };
      var c108 = findPromote(promote, '29') || { content: [] };
      var uncensored = findPromote(promote, '30') || { content: [] };
      var library = findPromote(promote, '1001') || { content: [] };
      var novels = findPromote(promote, '1002') || { content: [] };
      var single = categoryPage(1, 'single', 'mr', 'a').items.slice(0, 10);
      var latest = paged(apiGet('/latest?page=1') || [], 1, null, 80).items.slice(0, 10);
      var week = apiGet('/week') || {};
      var weekCategory = (week.categories || [])[0];
      var weekly = weekCategory
        ? mapAlbums((apiGet('/week/filter?id=' + encodeURIComponent(weekCategory.id)) || {}).list || [], 10)
        : [];
      var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()];
      var heroManga = mapAlbums(serial.content || [], 10);
      var sections = [
        { id: 'jm_translation', title: '禁漫汉化组', items: mapAlbums(translation.content || [], 10) },
        { id: 'korean', title: '最新韩漫', items: mapAlbums(korean.content || [], 10) },
        { id: 'c108', title: 'C108 & 推荐本本', items: mapAlbums(c108.content || [], 10) },
        { id: 'uncensored_color', title: '禁漫去码 & 全彩化', items: mapAlbums(uncensored.content || [], 10) }
      ];
      if (weekly.length) {
        sections.push({ id: 'week:' + weekCategory.id, title: '每周必看 · ' + String(weekCategory.time || ''), items: weekly });
      }
      sections.push({
        id: 'community',
        title: '禁漫社区',
        items: [
          mapCommunity('dinner', '绅夜食堂', '编辑精选话题与夜间读物'),
          mapCommunity('raiders', '游戏文库', '成人游戏资讯、攻略与讨论'),
          mapCommunity('sexytalk', '西斯话题', '站内社区热门话题')
        ]
      });
      if ((library.content || []).length) {
        sections.push({
          id: 'library', title: '禁漫书库',
          items: (library.content || []).slice(0, 10).map(function (item) { return mapEditorial(item, 'library'); })
        });
      }
      if ((novels.content || []).length) {
        sections.push({
          id: 'novels', title: '禁漫小说',
          items: (novels.content || []).slice(0, 10).map(function (item) { return mapEditorial(item, 'novel'); })
        });
      }
      sections.push({ id: 'single', title: '单行本推荐', items: single });
      sections.push({ id: 'latest', title: '最新漫画', items: latest });
      return {
        heroes: heroManga.map(function (manga) { return { manga: manga, imageURL: manga.highResolutionCoverURL || manga.coverURL }; }),
        popular: [], toplist: [], editor: [], rising: [],
        hotCategories: sections,
        sectionStates: {
          featured: { state: heroManga.length ? 'loaded' : 'empty', message: weekday + '连载更新' },
          hotCategories: { state: sections.length ? 'loaded' : 'empty', message: null }
        }
      };
    },

    getPopular: function (page) {
      return categoryPage(page, '0', 'mv', 'm');
    },

    getLatest: function (page) {
      var items = apiGet('/latest?page=' + Number(page || 1)) || [];
      return paged(items, page, null, 80);
    },

    search: function (page, query, filters) {
      var homeSection = filterValue(filters, 'home_section', '');
      if (homeSection) return homeSectionResult(homeSection, page);
      var mainTags = ['0', '1', '2', '3', '4'];
      var categories = ['0', 'doujin', 'single', 'short', 'another', 'hanman', 'meiman', 'doujin_cosplay', '3D'];
      var orders = ['mr', 'mv', 'mp', 'tf'];
      var times = ['a', 't', 'w', 'm'];
      var mainTag = mainTags[Number(filterValue(filters, 'search_type', '0'))] || '0';
      var category = categories[Number(filterValue(filters, 'category', '0'))] || '0';
      var order = orders[Number(filterValue(filters, 'ordering', '0'))] || 'mr';
      var time = times[Number(filterValue(filters, 'time', '0'))] || 'a';
      return String(query || '').trim()
        ? searchPage(page, query, mainTag, order, time)
        : categoryPage(page, category, order, time);
    },

    getToplist: function (page, period) {
      var time = period === 'day' || period === '15' ? 't'
        : period === 'week' ? 'w'
        : period === 'month' || period === '13' ? 'm' : 'a';
      return categoryPage(page, '0', 'mv', time);
    },

    getMangaDetails: function (manga) {
      var kind = manga.info && manga.info.contentKind;
      if (kind === 'novel') {
        var novelID = String(manga.id || '').replace(/^novel:/, '');
        var novel = apiGet('/novel?nid=' + encodeURIComponent(novelID)) || {};
        var result = mapEditorial(novel, 'novel');
        result.id = 'novel:' + novelID;
        result.url = '/novel/' + novelID;
        result.description = String(novel.description || '');
        result.genres = ['小说'].concat(stringList(novel.tags));
        result.status = novel.is_end === '1' || novel.serial_status === 'Completed' ? 'completed' : 'ongoing';
        result.info.likes = String(novel.likes || '0');
        result.info.views = String(novel.total_views || '0');
        result.info.readingNote = '小说正文为文字内容，当前漫画阅读器仅原生展示资料。';
        return result;
      }
      if (kind === 'library' || kind === 'community') {
        var copy = {};
        Object.keys(manga).forEach(function (key) { copy[key] = manga[key]; });
        copy.description = manga.description || (kind === 'library'
          ? '禁漫书库是站内创作者作品库，与普通漫画章节体系不同。当前版本原生展示其入口与资料，不加载广告网页。'
          : '这是禁漫天堂社区栏目。当前版本只提供无广告的原生栏目入口展示。');
        return copy;
      }
      var id = albumID(manga.id || manga.url);
      return mapAlbum(apiGet('/album?id=' + encodeURIComponent(id)) || { id: id }, true);
    },

    getHighResolutionCover: function (manga) {
      var copy = {};
      Object.keys(manga).forEach(function (key) { copy[key] = manga[key]; });
      var kind = manga.info && manga.info.contentKind;
      if (!kind || kind === 'comic') copy.coverURL = albumCover(albumID(manga.id || manga.url), true);
      return copy;
    },

    getChapterList: function (manga) {
      var kind = manga.info && manga.info.contentKind;
      if (kind && kind !== 'comic') return [];
      var id = albumID(manga.id || manga.url);
      var detail = apiGet('/album?id=' + encodeURIComponent(id)) || {};
      var series = detail.series || [];
      if (!series.length) {
        return [{
          id: id, url: '/photo/' + id,
          name: detail.name || manga.title || ('JM' + id),
          number: 1,
          dateUpload: Number(detail.addtime || 0) * 1000
        }];
      }
      return series.map(function (chapter, index) {
        var chapterID = String(chapter.id || id);
        var sort = Number(chapter.sort || index + 1);
        return {
          id: chapterID,
          url: '/photo/' + chapterID,
          name: String(chapter.name || ('第 ' + sort + ' 话')),
          number: sort,
          dateUpload: Number(detail.addtime || 0) * 1000
        };
      });
    },

    getPageList: function (chapter) {
      ensureSetting();
      var id = albumID(chapter.id || chapter.url);
      var data = apiGet('/chapter?id=' + encodeURIComponent(id)) || {};
      var files = data.images || [];
      var ts = timestamp();
      var template = signedPlainGet(
        '/chapter_view_template?id=' + encodeURIComponent(id)
          + '&mode=vertical&page=0&app_img_shunt=1&express=off&v=' + ts,
        API_CONTENT_TOKEN_SECRET
      );
      var scrambleMatch = template.match(/scramble_id\s*=\s*(\d+)/i);
      var parsedScrambleID = scrambleMatch ? Number(scrambleMatch[1]) : Number(data.scramble_id || 220980);
      return files.map(function (filename, index) {
        var bare = String(filename).replace(/\.[^.]+$/, '');
        var scrambleID = parsedScrambleID;
        var photoID = Number(id);
        var segments = 0;
        if (photoID >= scrambleID) {
          if (photoID < 268850) segments = 10;
          else {
            var divisor = photoID < 421926 ? 10 : 8;
            var digest = crypto.md5(String(photoID) + bare);
            segments = digest.charCodeAt(digest.length - 1) % divisor * 2 + 2;
          }
        }
        return {
          index: index,
          imageURL: imageHost() + '/media/photos/' + id + '/' + filename,
          imageTransform: segments > 1
            ? { kind: 'reverseVerticalStrips', segmentCount: segments }
            : null,
          url: null
        };
      });
    },

    getComments: function (manga) {
      var id = albumID(manga.id || manga.url);
      var data = apiGet('/forum?aid=' + encodeURIComponent(id) + '&mode=all&page=1') || {};
      return flattenComments(data.list || []);
    },

    getFavorites: function (page, category, query) {
      var path = '/favorite?page=' + Number(page || 1);
      if (category !== null && category !== undefined && Number(category) !== 0) {
        path += '&folder_id=' + encodeURIComponent(category);
      }
      var data = apiGet(path) || {};
      var items = mapAlbums(data.list || []);
      if (query) {
        var needle = String(query).toLowerCase();
        items = items.filter(function (item) { return item.title.toLowerCase().indexOf(needle) >= 0; });
      }
      return { items: items, hasNextPage: Number(page || 1) * 20 < Number(data.total || 0) };
    },

    getHistory: function (page, query) {
      var data = apiGet('/watch_list?page=' + Number(page || 1)) || {};
      var items = mapAlbums(data.list || data || []);
      if (query) {
        var needle = String(query).toLowerCase();
        items = items.filter(function (item) { return item.title.toLowerCase().indexOf(needle) >= 0; });
      }
      return { items: items, hasNextPage: items.length >= 20 };
    },

    getAccountOverview: function () {
      var favorites = apiGet('/favorite?page=1') || {};
      var history = apiGet('/watch_list?page=1') || {};
      return {
        isSupported: true,
        sections: [
          { id: 'account', title: '账户', metrics: [
            { id: 'status', title: '登录状态', value: '已登录' },
            { id: 'api', title: '数据线路', value: storage.get('active_api_domain') || '自动选择' }
          ] },
          { id: 'library', title: '云端书架', metrics: [
            { id: 'favorites', title: '收藏漫画', value: String(favorites.total || (favorites.list || []).length || 0) },
            { id: 'history', title: '本页阅读记录', value: String((history.list || history || []).length || 0) }
          ] }
        ],
        message: '个人资料、签到和收藏夹整理依赖站点 UID；当前版本优先提供安全登录、收藏和历史读取。'
      };
    },

    getFavoriteState: function (manga) { return favoriteState(manga); },
    setFavorite: function (manga) { return setFavoriteValue(manga, true); },
    removeFavorite: function (manga) { return setFavoriteValue(manga, false); },

    getFilterList: function () {
      return [
        { key: 'search_type', name: '搜索范围', kind: 'select', values: ['全部', '作品', '作者', '标签', '角色'], defaultValue: '0', scope: 'keyword' },
        { key: 'category', name: '分类', kind: 'select', values: ['全部', '同人', '单本', '短篇', '其他', '韩漫', '美漫', 'Cosplay', '3D'], defaultValue: '0', scope: 'browse' },
        { key: 'ordering', name: '排序', kind: 'sort', values: ['最新', '最多观看', '图片最多', '最多喜欢'], defaultValue: '0', scope: 'all' },
        { key: 'time', name: '时间', kind: 'select', values: ['全部', '今日', '本周', '本月'], defaultValue: '0', scope: 'all' }
      ];
    }
  };
})();
