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

  // The native bridge executes these signed requests concurrently. This keeps
  // comprehensive comment aggregation practical for long-running series while
  // preserving the same response validation/decryption as apiGet.
  function apiGetBatch(paths) {
    paths = Array.isArray(paths) ? paths : [];
    if (!paths.length) return [];
    if (typeof requestAll !== 'function') {
      return paths.map(function (path) {
        try { return apiGet(path); } catch (_) { return null; }
      });
    }

    var domains = prioritizeDomain(savedDomains(), storage.get('active_api_domain'));
    for (var domainIndex = 0; domainIndex < domains.length; domainIndex++) {
      var host = domains[domainIndex];
      var ts = timestamp();
      var headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': API_UA,
        'token': crypto.md5(ts + API_TOKEN_SECRET),
        'tokenparam': ts + ','
      };
      var responses = requestAll(paths.map(function (path) {
        return {
          url: 'https://' + host + path,
          method: 'GET',
          headers: headers,
          timeout: 12
        };
      })) || [];
      var decoded = responses.map(function (response) {
        try {
          if (!response || response.error || Number(response.status) < 200 || Number(response.status) >= 300) return null;
          var outer = JSON.parse(response.body || '{}');
          if (Number(outer.code) !== 200) return null;
          var payload = decodedPayload(outer, ts);
          return payload && payload.error ? null : payload;
        } catch (_) {
          return null;
        }
      });
      if (decoded.some(function (value) { return value !== null; })) {
        storage.set('active_api_domain', host);
        return decoded.map(function (value, index) {
          if (value !== null) return value;
          try { return apiGet(paths[index]); } catch (_) { return null; }
        });
      }
    }
    return paths.map(function (path) {
      try { return apiGet(path); } catch (_) { return null; }
    });
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

  function absoluteUserPhoto(path) {
    var value = String(path || '').trim();
    if (!value) return null;
    if (/^https?:/i.test(value) || value.charAt(0) === '/') return absoluteMedia(value);
    return imageHost() + '/media/users/' + value;
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

  function dateText(value) {
    if (value === null || value === undefined || value === '') return null;
    var numeric = Number(value);
    if (isFinite(numeric) && numeric > 0) {
      var milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
      var date = new Date(milliseconds);
      if (!isNaN(date.getTime())) {
        var pad = function (component) { return String(component).padStart(2, '0'); };
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
          + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      }
    }
    return String(value);
  }

  function uniqueText(values) {
    var seen = {};
    return stringList(values).map(function (value) { return String(value).trim(); }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
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
    if (genres.length) info.category = genres[0];
    if (item.likes !== undefined && item.likes !== null) info.likes = String(item.likes);
    if (item.total_views !== undefined && item.total_views !== null) info.views = String(item.total_views);
    if (item.total_photos !== undefined && item.total_photos !== null) info.pages = String(item.total_photos);
    if (item.comment_total !== undefined && item.comment_total !== null) info.comments = String(item.comment_total);
    if (item.addtime) info.updatedAt = dateText(item.addtime);
    if (item.update_at) info.updatedAt = dateText(item.update_at);
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

  function aggregateSeriesMetrics(item) {
    var series = Array.isArray(item.series) ? item.series : [];
    var ids = uniqueText(series.map(function (chapter) { return chapter && chapter.id; }));
    if (ids.length <= 1) return null;
    var albums = apiGetBatch(ids.map(function (id) {
      return '/album?id=' + encodeURIComponent(id);
    })).filter(function (album) { return album && album.id; });
    if (!albums.length) return null;
    var views = 0;
    var comments = 0;
    var earliest = null;
    var latest = null;
    albums.forEach(function (album) {
      views += Math.max(0, Number(album.total_views || 0));
      comments += Math.max(0, Number(album.comment_total || 0));
      var timestamp = Number(album.addtime || album.update_at || 0);
      if (timestamp > 0) {
        earliest = earliest === null ? timestamp : Math.min(earliest, timestamp);
        latest = latest === null ? timestamp : Math.max(latest, timestamp);
      }
    });
    return {
      views: views,
      comments: comments,
      listedAt: earliest,
      updatedAt: latest,
      chapterCount: albums.length
    };
  }

  function mapDetailedAlbum(item, original) {
    item = item || {};
    original = original || {};
    var result = mapAlbum(item, true);
    var originalInfo = original.info || {};
    var originalGenres = original.genres || [];
    var category = originalInfo.category || originalGenres[0] || result.info.category;
    if (category) {
      result.info.category = String(category);
      if (result.genres.indexOf(String(category)) < 0) result.genres.unshift(String(category));
    }

    var series = Array.isArray(item.series) ? item.series : [];
    result.info.contentCount = String(Math.max(series.length, 1));
    result.info.uploader = item.uploader || item.username || '未公开';
    var aggregate = aggregateSeriesMetrics(item);
    if (aggregate) {
      result.info.listedAt = dateText(aggregate.listedAt) || '';
      result.info.updatedAt = dateText(aggregate.updatedAt) || result.info.listedAt;
      result.info.views = String(aggregate.views);
      result.info.comments = String(aggregate.comments);
      result.info.metricScope = '全系列官网聚合';
    } else {
      result.info.listedAt = dateText(item.addtime) || originalInfo.listedAt || originalInfo.posted || '';
      result.info.updatedAt = dateText(item.update_at) || originalInfo.updatedAt || originalInfo.updated || result.info.listedAt;
    }
    result.info.isLiked = item.liked === true || String(item.liked) === '1' ? 'true' : 'false';
    result.info.isFavorited = item.is_favorite === true || String(item.is_favorite) === '1' ? 'true' : 'false';
    result.info.shortVideoURL = 'https://18comic.vip/media/JmShortVideo/' + result.id + '.mp4';

    var groups = [
      { id: 'works', title: '作品', values: uniqueText(item.works) },
      { id: 'actors', title: '登场人物', values: uniqueText(item.actors) },
      { id: 'tags', title: '分类标签', values: uniqueText(item.tags) },
      { id: 'authors', title: '作者', values: uniqueText(item.author) }
    ].filter(function (group) { return group.values.length > 0; });
    result.tagGroups = groups;
    result.tags = groups.reduce(function (all, group) { return all.concat(group.values); }, []);
    result.relatedMangas = mapAlbums(item.related_list || [], 18);

    try {
      var random = apiGet('/random_recommend') || [];
      var randomItems = Array.isArray(random) ? random : (random.list || random.content || random.data || []);
      result.recommendations = mapAlbums(randomItems, 12).filter(function (manga) { return manga.id !== result.id; });
    } catch (_) {
      result.recommendations = [];
    }
    try {
      var promote = apiGet('/promote') || [];
      var library = findPromote(promote, '1001') || { content: [] };
      var editorial = Array.isArray(library.content) ? library.content : [];
      var terms = uniqueText([].concat(item.works || [], item.actors || [], item.tags || [], item.author || []))
        .map(function (value) { return value.toLowerCase(); })
        .filter(function (value) { return value.length >= 2; });
      var relatedEditorial = editorial.filter(function (entry) {
        var haystack = JSON.stringify(entry || {}).toLowerCase();
        return terms.some(function (term) { return haystack.indexOf(term) >= 0; });
      });
      if (!relatedEditorial.length) relatedEditorial = editorial;
      result.relatedArticles = relatedEditorial.slice(0, 12).map(function (entry) {
        return mapEditorial(entry, 'library');
      });
    } catch (_) {
      result.relatedArticles = [];
    }
    return result;
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

  function commentBadgeURLs(expinfo) {
    var badges = expinfo && Array.isArray(expinfo.badges) ? expinfo.badges : [];
    return badges.map(function (badge) {
      var value = typeof badge === 'string'
        ? badge
        : badge && (badge.image || badge.icon || badge.photo || badge.pic || badge.url || badge.path);
      value = String(value || '').trim();
      if (!value) return null;
      if (!/^(?:https?:|\/)/i.test(value)) {
        return 'https://18comic.vip/static/resources/files/medal%202.0/' + encodeURIComponent(value) + '.png';
      }
      if (value.indexOf('/static/') === 0) return 'https://18comic.vip' + value;
      return absoluteMedia(value);
    }).filter(Boolean);
  }

  function commentChapterContext(id) {
    var titles = {};
    var chapterIDs = [String(id)];
    try {
      var detail = apiGet('/album?id=' + encodeURIComponent(id)) || {};
      var series = Array.isArray(detail.series) ? detail.series : [];
      series.forEach(function (chapter, index) {
        var chapterID = String(chapter.id || (index === 0 ? id : ''));
        if (!chapterID) return;
        if (chapterIDs.indexOf(chapterID) < 0) chapterIDs.push(chapterID);
        titles[chapterID] = String(chapter.name || ('第 ' + Number(chapter.sort || index + 1) + ' 话'));
      });
      if (!titles[id] && series.length) {
        titles[id] = String(series[0].name || '第 1 话');
      }
    } catch (_) {}
    return { titles: titles, chapterIDs: chapterIDs };
  }

  function flattenComments(list, chapterTitles) {
    var output = [];
    function add(item, reply) {
      var body = stripHTML(item.content || item.comment || '');
      if (!body) body = '[图片评论]';
      var expinfo = item.expinfo || {};
      var chapterID = String(item.AID || item.aid || '');
      var rawChapterTitle = chapterTitles[chapterID] || item.chapter_name || item.name || '';
      var chapterTitle = /^JM\d+$/i.test(String(rawChapterTitle)) ? '' : String(rawChapterTitle);
      output.push({
        id: String(item.CID || item.id || output.length),
        author: String(item.nickname || item.username || '匿名用户'),
        dateText: item.addtime ? String(item.addtime) : null,
        body: body,
        score: null,
        isUploader: false,
        avatarURL: absoluteUserPhoto(item.photo),
        authorUsername: item.username ? String(item.username) : null,
        levelText: expinfo.level !== undefined ? 'Lv.' + String(expinfo.level) : null,
        levelTitle: expinfo.level_name ? String(expinfo.level_name) : null,
        badgeImageURLs: commentBadgeURLs(expinfo),
        isSpoiler: item.spoiler === true || String(item.spoiler) === '2',
        parentID: item.parent_CID ? String(item.parent_CID) : null,
        isReply: !!reply,
        chapterID: chapterID || null,
        chapterTitle: chapterTitle || null
      });
      (item.replys || item.replies || []).forEach(function (child) { add(child, true); });
    }
    (list || []).forEach(function (item) { add(item, false); });
    return output;
  }

  function commentsForAlbum(id) {
    var context = commentChapterContext(id);
    var chapterIDs = context.chapterIDs;
    var firstPagePaths = chapterIDs.map(function (chapterID) {
      return '/forum?aid=' + encodeURIComponent(chapterID) + '&mode=manhua&page=1';
    });
    var firstPages = apiGetBatch(firstPagePaths);
    var allLists = [];
    var remainingPaths = [];
    firstPages.forEach(function (data, index) {
      data = data || {};
      if (Array.isArray(data.list) && data.list.length) allLists.push(data.list);
      var total = Math.max(0, Number(data.total || 0));
      var pageCount = Math.min(250, Math.ceil(total / 10));
      for (var page = 2; page <= pageCount && remainingPaths.length < 500; page++) {
        remainingPaths.push('/forum?aid=' + encodeURIComponent(chapterIDs[index]) + '&mode=manhua&page=' + page);
      }
    });

    // Fetch the rest in bounded batches so one giant series cannot create an
    // unbounded native request array. The bridge itself caps active requests.
    for (var offset = 0; offset < remainingPaths.length; offset += 120) {
      apiGetBatch(remainingPaths.slice(offset, offset + 120)).forEach(function (data) {
        if (data && Array.isArray(data.list) && data.list.length) allLists.push(data.list);
      });
    }

    var seen = {};
    var output = [];
    allLists.forEach(function (list) {
      flattenComments(list, context.titles).forEach(function (comment) {
        if (seen[comment.id]) return;
        seen[comment.id] = true;
        output.push(comment);
      });
    });
    return output;
  }

  var interactionCache = {};

  function isEnabledValue(value) {
    if (value === true || value === 1) return true;
    var text = String(value === undefined || value === null ? '' : value).toLowerCase();
    return text === '1' || text === 'true' || text === 'yes' || text === 'on';
  }

  function albumInteraction(id) {
    var detail = apiGet('/album?id=' + encodeURIComponent(id)) || {};
    return {
      isLiked: isEnabledValue(detail.liked),
      likeCount: detail.likes === undefined ? null : String(detail.likes),
      isFavorited: isEnabledValue(detail.is_favorite)
    };
  }

  function trackingInteraction(id) {
    var tracking = apiGet('/album_sertracking?id=' + encodeURIComponent(id));
    if (isEnabledValue(tracking)) return true;
    tracking = tracking || {};
    return isEnabledValue(tracking.is_tracking)
      || isEnabledValue(tracking.is_tracked)
      || isEnabledValue(tracking.tracked)
      || isEnabledValue(tracking.status);
  }

  function confirmAlbumInteraction(id, field, desired) {
    var latest = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) sleep(attempt * 220);
      latest = albumInteraction(id);
      if (latest[field] === desired) break;
    }
    return latest;
  }

  function confirmTrackingInteraction(id, desired) {
    var latest = false;
    for (var attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) sleep(attempt * 220);
      latest = trackingInteraction(id);
      if (latest === desired) break;
    }
    return latest;
  }

  function interactionState(manga) {
    var id = albumID(manga.id || manga.url);
    var album = albumInteraction(id);
    var tracked = false;
    try {
      tracked = trackingInteraction(id);
    } catch (_) {}
    var state = {
      isSupported: true,
      canLike: true,
      isLiked: album.isLiked,
      likeCount: album.likeCount,
      canTrack: true,
      isTracked: tracked,
      message: null
    };
    interactionCache[id] = state;
    return state;
  }

  function accountProfile() {
    try {
      return JSON.parse(storage.get('account_profile_json') || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function profileValue(profile, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var value = profile[keys[i]];
      if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    return fallback || '';
  }

  function profileCollectionText(profile, keys) {
    var raw = profileValue(profile, keys, '');
    if (!raw) return '—';
    try { return displayValue(JSON.parse(raw)); } catch (_) { return displayValue(raw); }
  }

  function displayValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (Array.isArray(value)) return value.slice(0, 8).map(function (item) {
      if (item && typeof item === 'object') return String(item.title || item.name || item.id || '记录');
      return String(item);
    }).join('、') || '—';
    if (typeof value === 'object') {
      return String(value.title || value.name || value.msg || value.message || value.status || '已读取');
    }
    var text = stripHTML(String(value)).trim();
    return text || '—';
  }

  function metricsFromObject(value, prefix, limit) {
    var metrics = [];
    var object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    Object.keys(object).slice(0, limit || 16).forEach(function (key) {
      if (key === 's' || /token|password|secret/i.test(key)) return;
      metrics.push({ id: (prefix || 'field') + ':' + key, title: key, value: displayValue(object[key]) });
    });
    return metrics;
  }

  function listMetrics(value, prefix, limit) {
    var list = Array.isArray(value) ? value : (value && (value.list || value.content || value.data)) || [];
    if (!Array.isArray(list)) return [];
    return list.slice(0, limit || 20).map(function (item, index) {
      var title = item && typeof item === 'object'
        ? (item.title || item.name || item.subject || item.message || item.id)
        : item;
      var subtitle = item && typeof item === 'object'
        ? (item.status || item.addtime || item.update_at || item.progress || '')
        : '';
      return {
        id: (prefix || 'item') + ':' + index,
        title: String(title || ('记录 ' + (index + 1))),
        value: displayValue(subtitle || (item && item.value) || '已读取')
      };
    });
  }

  function accountToolState(kind) {
    var profile = accountProfile();
    var uid = profileValue(profile, ['uid'], '');
    if (!uid && kind !== 'safety') {
      return {
        isSupported: false,
        title: '需要刷新账号资料',
        introduction: '当前登录态来自旧版本。请在图源管理中重新登录一次，App 才能安全取得 UID 并读取个人中心。',
        sections: [], links: [], message: '缺少账号 UID'
      };
    }

    if (kind === 'profile') {
      var editable = apiGet('/useredit/' + encodeURIComponent(uid)) || {};
      return {
        isSupported: true,
        title: '个人资料',
        introduction: '可编辑站点公开资料；密码与头像上传仍保持只读，避免误覆盖账号凭据或媒体文件。',
        sections: [{ id: 'profile', title: '公开资料', metrics: metricsFromObject(editable, 'profile', 28) }],
        links: [], message: null
      };
    }
    if (kind === 'tasks') {
      var tasks = apiGet('/tasks?type=all&filter=all') || {};
      return {
        isSupported: true, title: '成就任务', introduction: '任务进度只读；领取奖励暂不自动执行。',
        sections: [{ id: 'tasks', title: '任务', metrics: listMetrics(tasks, 'task', 30).concat(metricsFromObject(tasks, 'task-field', 8)) }],
        links: [], message: null
      };
    }
    if (kind === 'daily') {
      var daily = apiGet('/daily?user_id=' + encodeURIComponent(uid)) || {};
      return {
        isSupported: true, title: '签到活动', introduction: '签到会改变账号状态，只有点击确认按钮后才会执行。',
        sections: [{ id: 'daily', title: '今日状态', metrics: metricsFromObject(daily, 'daily', 20) }],
        links: [], message: null
      };
    }
    if (kind === 'inbox') {
      var notifications = apiGet('/notifications') || {};
      var unread = {};
      try { unread = apiGet('/notifications/unreadCount') || {}; } catch (_) {}
      return {
        isSupported: true, title: '信箱', introduction: '当前仅只读，不会自动标记已读。',
        sections: [
          { id: 'unread', title: '未读', metrics: metricsFromObject(unread, 'unread', 6) },
          { id: 'messages', title: '消息', metrics: listMetrics(notifications, 'notification', 30) }
        ], links: [], message: null
      };
    }
    if (kind === 'tracking') {
      var tracking = apiPost('/album_tracking', { page: '1' }) || {};
      return {
        isSupported: true, title: '连载追踪', introduction: '只读显示官网追踪列表；详情页铃铛可开启或关闭单本追踪。',
        sections: [{ id: 'tracking', title: '追踪漫画', metrics: listMetrics(tracking, 'tracking', 30) }],
        links: [], message: null
      };
    }
    if (kind === 'comicFavorites') {
      var favoritePage = apiGet('/favorite?page=1') || {};
      return {
        isSupported: true, title: '漫画收藏', introduction: '显示官网收藏的第一页；完整分页可在在线书架的收藏模式中浏览。',
        sections: [{ id: 'favorites', title: '最近收藏', metrics: listMetrics(favoritePage, 'favorite', 30) }],
        links: [], message: null
      };
    }
    if (kind === 'comicHistory') {
      var watchPage = apiGet('/watch_list?page=1') || {};
      return {
        isSupported: true, title: '漫画观看记录', introduction: '显示官网记录的第一页；完整分页可在在线书架的历史模式中浏览。',
        sections: [{ id: 'history', title: '最近观看', metrics: listMetrics(watchPage, 'history', 30) }],
        links: [], message: null
      };
    }
    var explanations = {
      gacha: '一番赏与 JCOINS 接口包含消费语义，当前只显示登录资料中的余额，不在 App 内抽取或充值。',
      novelFavorites: '移动 API 的小说收藏结构尚未稳定验证，暂不混入漫画收藏。',
      tagBlock: '标签屏蔽写入接口尚未稳定验证，避免误覆盖账号规则。',
      novelHistory: '小说历史接口尚未稳定验证。',
      videoHistory: '小电影历史接口尚未稳定验证。'
    };
    return {
      isSupported: false, title: '暂未开放', introduction: explanations[kind] || '该模块尚未完成安全验证。',
      sections: [], links: [], message: explanations[kind] || '暂未开放'
    };
  }

  function favoriteState(manga) {
    var detail = albumInteraction(albumID(manga.id || manga.url));
    return {
      isSupported: true,
      isFavorited: detail.isFavorited,
      category: null,
      categories: [],
      note: null,
      message: null
    };
  }

  function setFavoriteValue(manga, desired) {
    var id = albumID(manga.id || manga.url);
    var state = favoriteState(manga);
    if (state.isFavorited !== desired) {
      apiPost('/favorite', { aid: id });
      var confirmed = confirmAlbumInteraction(id, 'isFavorited', desired).isFavorited;
      if (confirmed !== desired) {
        state.isSupported = false;
        state.isFavorited = confirmed;
        state.message = desired ? '官网尚未确认收藏，请稍后重试' : '官网尚未确认取消收藏，请稍后重试';
        return state;
      }
      state.isFavorited = confirmed;
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
      return mapDetailedAlbum(apiGet('/album?id=' + encodeURIComponent(id)) || { id: id }, manga);
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
      return commentsForAlbum(id);
    },

    submitCommentAdvanced: function (manga, body, spoiler, parentID) {
      var id = albumID(manga.id || manga.url);
      var text = String(body || '').trim();
      if (!text) return { isSupported: true, didSubmit: false, message: '评论不能为空。', comments: null };
      var submitted = apiPost('/comment', {
        aid: id,
        comment: text,
        status: spoiler ? 'true' : 'false',
        comment_id: parentID || '0'
      });
      if (submitted && submitted.status !== undefined) {
        var submitStatus = String(submitted.status).toLowerCase();
        if (submitStatus !== 'ok' && submitStatus !== '1' && submitStatus !== 'true') {
          return {
            isSupported: true,
            didSubmit: false,
            message: String(submitted.msg || submitted.message || '官网没有确认评论发送。'),
            comments: null
          };
        }
      }
      return {
        isSupported: true,
        didSubmit: true,
        message: spoiler ? '剧透评论已发送' : '评论已发送',
        // Do not synchronously reload hundreds of comment threads here. The
        // native UI dismisses immediately and refreshes the list in background.
        comments: null
      };
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
      var profile = accountProfile();
      var favorites = apiGet('/favorite?page=1') || {};
      var history = apiGet('/watch_list?page=1') || {};
      var progressMetrics = [
        { id: 'title', title: '称号', value: profileValue(profile, ['title', 'level_name'], '—') },
        { id: 'coin', title: 'JCOINS', value: profileValue(profile, ['coin'], '—') },
        { id: 'level', title: '等级', value: profileValue(profile, ['level'], '—') },
        { id: 'experience', title: '经验', value: profileValue(profile, ['exp'], '—') + ' / ' + profileValue(profile, ['nextLevelExp'], '—') },
        { id: 'medals', title: '勋章', value: profileCollectionText(profile, ['badges', 'medals']) },
        { id: 'favorite-capacity', title: '可收藏数', value: profileValue(profile, ['album_favorites'], '—') + ' / ' + profileValue(profile, ['album_favorites_max'], '—') },
        { id: 'charge', title: '充能', value: profileValue(profile, ['charge'], '—') },
        { id: 'energy', title: 'J罐', value: profileValue(profile, ['energy'], '—') }
      ];
      var combatPower = profileValue(profile, ['combat_power', 'battle_power'], '');
      if (combatPower) progressMetrics.push({ id: 'combat-power', title: '战斗力', value: combatPower });
      try {
        var tagStats = JSON.parse(profileValue(profile, ['tag_stats', 'tag_power'], '{}'));
        progressMetrics = progressMetrics.concat(metricsFromObject(tagStats, 'tag-power', 12));
      } catch (_) {}
      return {
        isSupported: true,
        sections: [
          { id: 'identity', title: '个人资料', metrics: [
            { id: 'nickname', title: '昵称', value: profileValue(profile, ['nickname', 'nickName', 'fname', 'username'], '已登录用户') },
            { id: 'status', title: '状态', value: profileValue(profile, ['status', 'message'], '已登录') },
            { id: 'uid', title: 'UID', value: profileValue(profile, ['uid'], '重新登录后显示') },
            { id: 'invite', title: '邀请码', value: profileValue(profile, ['invite_code'], '未公开') },
            { id: 'api', title: '数据线路', value: storage.get('active_api_domain') || '自动选择' }
          ] },
          { id: 'progress', title: '等级与资产', metrics: progressMetrics },
          { id: 'library', title: '云端书架', metrics: [
            { id: 'favorites', title: '收藏漫画', value: String(favorites.total || (favorites.list || []).length || 0) },
            { id: 'history', title: '本页阅读记录', value: String((history.list || history || []).length || 0) }
          ] }
        ],
        message: profileValue(profile, ['uid'], '') ? null : '当前为旧登录态；重新登录一次后可显示完整资料与签到。'
      };
    },

    getAccountToolState: function (kind) { return accountToolState(String(kind || '')); },
    performAccountAction: function (kind, payload) {
      var profile = accountProfile();
      var uid = profileValue(profile, ['uid'], '');
      if (kind === 'updateProfile' && uid) {
        var allowed = [
          'nickName', 'lastName', 'firstName', 'birthday', 'relations', 'sexuality',
          'website', 'birthPlace', 'city', 'country', 'occupation', 'company',
          'school', 'aboutMe', 'infoHere', 'collections', 'ideal', 'erogenic',
          'favorite', 'hate'
        ];
        var fields = {};
        payload = payload || {};
        allowed.forEach(function (key) {
          if (payload[key] !== undefined && payload[key] !== null) fields[key] = String(payload[key]);
        });
        if (!Object.keys(fields).length) {
          var emptyState = accountToolState('profile');
          emptyState.message = '没有需要保存的资料字段。';
          return emptyState;
        }
        apiPost('/useredit/' + encodeURIComponent(uid), fields);
        var updatedState = accountToolState('profile');
        updatedState.message = '个人资料已保存并重新读取。';
        return updatedState;
      }
      if (kind !== 'dailyCheckIn' || !uid) return accountToolState('daily');
      var daily = apiGet('/daily?user_id=' + encodeURIComponent(uid)) || {};
      var dailyID = daily.daily_id || daily.id || daily.DID || daily.activity_id;
      if (!dailyID && Array.isArray(daily.list) && daily.list.length) {
        dailyID = daily.list[0].daily_id || daily.list[0].id;
      }
      if (!dailyID) {
        return {
          isSupported: true, title: '签到活动', introduction: '站点没有返回可用的签到活动编号。',
          sections: [{ id: 'daily', title: '今日状态', metrics: metricsFromObject(daily, 'daily', 20) }],
          links: [], message: '无法确认签到活动编号，未执行写入。'
        };
      }
      apiPost('/daily_chk', { user_id: uid, daily_id: String(dailyID) });
      return accountToolState('daily');
    },

    getFavoriteState: function (manga) { return favoriteState(manga); },
    setFavorite: function (manga) { return setFavoriteValue(manga, true); },
    removeFavorite: function (manga) { return setFavoriteValue(manga, false); },

    getInteractionState: function (manga) { return interactionState(manga); },
    setLiked: function (manga, desired) {
      var id = albumID(manga.id || manga.url);
      var state = interactionCache[id] || interactionState(manga);
      if (state.isLiked !== !!desired) apiPost('/like', { id: albumID(manga.id || manga.url) });
      var verified = confirmAlbumInteraction(id, 'isLiked', !!desired);
      state = {
        isSupported: verified.isLiked === !!desired,
        canLike: true,
        isLiked: verified.isLiked,
        likeCount: verified.likeCount,
        canTrack: true,
        isTracked: state.isTracked,
        message: null
      };
      interactionCache[id] = state;
      if (!state.isSupported) {
        state.message = desired ? '官网尚未确认点赞，请稍后重试' : '官网尚未确认取消点赞，请稍后重试';
        return state;
      }
      state.message = state.isLiked ? '已喜欢这部漫画' : '已取消喜欢';
      return state;
    },
    setTracking: function (manga, desired) {
      var id = albumID(manga.id || manga.url);
      var state = interactionCache[id] || interactionState(manga);
      if (state.isTracked !== !!desired) apiPost('/album_sertracking', { id: albumID(manga.id || manga.url) });
      var verified = confirmTrackingInteraction(id, !!desired);
      state = {
        isSupported: verified === !!desired,
        canLike: true,
        isLiked: state.isLiked,
        likeCount: state.likeCount,
        canTrack: true,
        isTracked: verified,
        message: null
      };
      interactionCache[id] = state;
      if (!state.isSupported) {
        state.message = desired ? '官网尚未确认追更，请稍后重试' : '官网尚未确认关闭追更，请稍后重试';
        return state;
      }
      state.message = state.isTracked ? '已开启连载追踪' : '已关闭连载追踪';
      return state;
    },

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
