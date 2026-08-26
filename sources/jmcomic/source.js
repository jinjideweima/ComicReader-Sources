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
  var WEBSITE_BASE = 'https://18comic.vip';
  var LIBRARY_MEDIA_BASE = 'https://cdn-msp.18comic.vip';
  var runtimeImageHost = null;
  var runtimeAppVersion = null;
  var settingLoaded = false;
  var websiteHTMLCache = {};
  // A mirror can stay in persistent storage after it starts redirecting or
  // stops serving the signed mobile API. Keep short runtime cooldowns so one
  // stale mirror cannot add its full timeout to every detail subrequest.
  var apiDomainCooldowns = {};
  // A detail screen asks for the album and its chapter list separately. Keep
  // successful GET payloads for this source runtime so the same album is not
  // downloaded and decrypted twice while opening one screen.
  var apiGETCache = {};

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

  function usableDomains(domains) {
    var now = Date.now();
    var usable = (domains || []).filter(function (host) {
      return !apiDomainCooldowns[host] || apiDomainCooldowns[host] <= now;
    });
    return usable.length ? usable : (domains || []);
  }

  function markDomainFailure(host, error) {
    if (!host) return;
    var message = String(error && error.message ? error.message : error || '');
    // Redirecting mirrors are migrations, not momentary packet loss. Keep
    // those out for longer; transient TLS/timeouts get a short cooldown.
    apiDomainCooldowns[host] = Date.now() + (/HTTP 3\d\d/.test(message) ? 5 * 60 * 1000 : 15 * 1000);
    if (storage.get('active_api_domain') === host) storage.set('active_api_domain', '');
  }

  function markDomainSuccess(host) {
    if (!host) return;
    delete apiDomainCooldowns[host];
    storage.set('active_api_domain', host);
  }

  function refreshDomains() {
    var key = crypto.md5(DOMAIN_SERVER_SECRET);
    if (typeof requestAll === 'function') {
      var responses = requestAll(DOMAIN_SERVERS.map(function (url) {
        return { url: url, method: 'GET', timeout: 4, cachePolicy: 'reloadIgnoringLocalCacheData' };
      })) || [];
      for (var responseIndex = 0; responseIndex < responses.length; responseIndex++) {
        try {
          var candidate = responses[responseIndex];
          if (!candidate || candidate.error || Number(candidate.status) < 200 || Number(candidate.status) >= 300) continue;
          var concurrentDecoded = crypto.aes256ECBDecryptBase64(String(candidate.body || '').trim(), key);
          var concurrentPayload = JSON.parse(concurrentDecoded);
          var concurrentDomains = unique((concurrentPayload.Setting || []).concat(concurrentPayload.Server || []));
          if (concurrentDomains.length) {
            storage.set('api_domains', JSON.stringify(concurrentDomains));
            return concurrentDomains;
          }
        } catch (_) {}
      }
      return [];
    }
    for (var i = 0; i < DOMAIN_SERVERS.length; i++) {
      try {
        var response = fetch(DOMAIN_SERVERS[i], { timeout: 4, cachePolicy: 'reloadIgnoringLocalCacheData' });
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

  function requestOnce(host, path, method, fields, tokenSecret, tokenVersion, timeoutSeconds) {
    var ts = timestamp();
    var headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': API_UA,
      'token': crypto.md5(ts + tokenSecret),
      'tokenparam': ts + ',' + (tokenVersion || '')
    };
    var options = { method: method, headers: headers, timeout: Number(timeoutSeconds || 6) };
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
    markDomainSuccess(host);
    return { data: payload, host: host, response: response };
  }

  function apiRequest(path, method, fields, tokenSecret, tokenVersion) {
    method = method || 'GET';
    var domains = usableDomains(prioritizeDomain(savedDomains(), storage.get('active_api_domain')));
    var lastError = null;
    var activeDomain = storage.get('active_api_domain');

    // On a cold start (or after the remembered host dies), probing old JM API
    // mirrors one-by-one turns a six-second timeout into a minute. The native
    // bridge can probe them concurrently and still returns results in the
    // preferred order. Once a winner is remembered, the normal path remains a
    // single request to that host.
    function concurrentGET(list) {
      if (method !== 'GET' || typeof requestAll !== 'function' || !list.length) return null;
      var ts = timestamp();
      var secret = tokenSecret || API_TOKEN_SECRET;
      var version = tokenVersion === undefined ? '' : tokenVersion;
      var headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': API_UA,
        'token': crypto.md5(ts + secret),
        'tokenparam': ts + ',' + version
      };
      var responses = requestAll(list.map(function (host) {
        return { url: 'https://' + host + path, method: 'GET', headers: headers, timeout: 6 };
      })) || [];
      for (var responseIndex = 0; responseIndex < responses.length; responseIndex++) {
        try {
          var response = responses[responseIndex];
          if (!response || response.error || Number(response.status) < 200 || Number(response.status) >= 300) continue;
          var outer = JSON.parse(response.body || '{}');
          if (Number(outer.code) !== 200) continue;
          var payload = decodedPayload(outer, ts);
          if (payload && payload.error) continue;
          markDomainSuccess(list[responseIndex]);
          return { data: payload, host: list[responseIndex], response: response };
        } catch (error) {
          lastError = error;
        }
      }
      list.forEach(function (host) { markDomainFailure(host, lastError || new Error('API probe failed')); });
      return null;
    }

    function attempt(list, timeoutSeconds) {
      for (var i = 0; i < list.length; i++) {
        try {
          return requestOnce(
            list[i], path, method, fields,
            tokenSecret || API_TOKEN_SECRET,
            tokenVersion === undefined ? (method === 'POST' ? appVersion() : '') : tokenVersion,
            timeoutSeconds
          );
        } catch (error) {
          lastError = error;
          markDomainFailure(list[i], error);
        }
      }
      return null;
    }
    var result = null;
    if (method === 'GET' && typeof requestAll === 'function') {
      if (activeDomain && domains[0] === activeDomain) {
        // A remembered host gets a fast chance, then all alternatives race.
        // This bounds a migrated 301/half-dead mirror to three seconds.
        result = attempt([activeDomain], 3);
        if (!result) result = concurrentGET(domains.slice(1));
      } else {
        result = concurrentGET(domains);
      }
    } else {
      // Mutations cannot safely race. Bound sequential fallback so a single
      // action never waits through every historical mirror.
      result = attempt(domains.slice(0, 4), 4);
    }
    if (!result) {
      var refreshed = refreshDomains();
      if (refreshed.length) {
        var refreshedCandidates = usableDomains(unique(refreshed.concat(domains)));
        result = method === 'GET' && typeof requestAll === 'function'
          ? concurrentGET(refreshedCandidates)
          : attempt(refreshedCandidates.slice(0, 4), 4);
      }
    }
    if (!result) {
      var reason = String(lastError && lastError.message ? lastError.message : lastError || '线路探测失败');
      if (/HTTP 3\d\d/.test(reason)) reason = '旧线路已迁移，自动刷新暂未取得可用线路';
      throw new Error('禁漫天堂移动 API 暂时无法连接：' + reason);
    }
    return result;
  }

  function apiGet(path) {
    var cacheable = /^\/(?:album|chapter)\?id=/.test(path) || path === '/setting';
    if (cacheable && Object.prototype.hasOwnProperty.call(apiGETCache, path)) return apiGETCache[path];
    var data = apiRequest(path, 'GET', null, API_TOKEN_SECRET, '').data;
    if (cacheable) apiGETCache[path] = data;
    return data;
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

    var domains = usableDomains(prioritizeDomain(savedDomains(), storage.get('active_api_domain')));
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
        markDomainSuccess(host);
        return decoded.map(function (value, index) {
          if (value !== null) return value;
          try { return apiGet(paths[index]); } catch (_) { return null; }
        });
      }
      markDomainFailure(host, new Error('API batch failed'));
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
      '.jmapiproxy2.cc', '.jmapiproxy3.cc', '.jmapinodeudzn.net', '.18comic.vip'
    ];
    if (suffixes.some(function (suffix) { return host === suffix.slice(1) || host.slice(-suffix.length) === suffix; })) {
      return value;
    }
    return null;
  }

  function ensureSetting() {
    if (settingLoaded) return;
    settingLoaded = true;
    var savedImageHost = allowedDynamicImageHost(storage.get('image_host'));
    runtimeImageHost = savedImageHost || FALLBACK_IMAGE_HOST;
    runtimeAppVersion = storage.get('app_version') || DEFAULT_APP_VERSION;
    // Existing installations already have the most recently working image
    // host. Do not put another API request in front of every cover and reader
    // image during normal navigation. A fresh install still performs the
    // setting lookup once so it can discover the current CDN.
    if (savedImageHost) return;
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

  function websiteURL(path) {
    var value = String(path || '').trim();
    if (!value) return WEBSITE_BASE + '/';
    if (/^https?:\/\//i.test(value)) {
      var match = value.match(/^https?:\/\/([^/]+)(\/.*)?$/i);
      var host = match ? String(match[1]).toLowerCase() : '';
      if (host === '18comic.vip' || /\.18comic\.vip$/.test(host)) {
        return value.replace(/^http:/i, 'https:');
      }
      return null;
    }
    return WEBSITE_BASE + (value.charAt(0) === '/' ? value : '/' + value);
  }

  function articleLinkURL(path) {
    var value = String(path || '').trim();
    if (!value || /^javascript:/i.test(value) || /^data:/i.test(value)) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return websiteURL(value);
  }

  function websiteGet(path, timeoutSeconds) {
    var url = websiteURL(path);
    if (!url) throw new Error('禁漫天堂网页地址不受信任');
    if (websiteHTMLCache[url]) return websiteHTMLCache[url];
    var response = fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': WEBSITE_BASE + '/',
        'User-Agent': API_UA
      },
      timeout: Math.max(2, Number(timeoutSeconds || 15))
    });
    if (response.status < 200 || response.status >= 300 || !String(response.body || '').trim()) {
      throw new Error('禁漫天堂网页内容暂时不可用（HTTP ' + response.status + '）');
    }
    websiteHTMLCache[url] = String(response.body);
    return websiteHTMLCache[url];
  }

  function websitePost(path, fields, refererPath) {
    var url = websiteURL(path);
    if (!url) throw new Error('禁漫天堂网页地址不受信任');
    var referer = websiteURL(refererPath || '/');
    var response = fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': WEBSITE_BASE,
        'Referer': referer || (WEBSITE_BASE + '/'),
        'User-Agent': API_UA,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: encodeForm(fields || {}),
      timeout: 15
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error('禁漫天堂网页操作暂时不可用（HTTP ' + response.status + '）');
    }
    var body = String(response.body || '').trim();
    if (!body) throw new Error('官网没有返回操作结果');
    try {
      return JSON.parse(body);
    } catch (_) {
      if (/login|登入|登录/i.test(body)) throw new Error('禁漫天堂登录状态已失效，请重新登录');
      throw new Error('官网返回了无法识别的操作结果');
    }
  }

  function websiteDocument(path, timeoutSeconds) {
    var url = websiteURL(path);
    return parseHTML(websiteGet(path, timeoutSeconds), url || WEBSITE_BASE);
  }

  function webImageURL(element) {
    if (!element) return null;
    var value = element.attr('data-src') || element.attr('data-original')
      || element.attr('abs:src') || element.attr('src') || '';
    if (value.indexOf('//') === 0) value = 'https:' + value;
    var resolved = websiteURL(value);
    return resolved || null;
  }

  // Article bodies are allowed to embed images from JM's rotating CDN as well
  // as an author's own platform (for example Fanbox).  websiteURL deliberately
  // rejects those hosts, so using it for body images made the native article
  // reader silently discard every non-18comic image.
  function contentImageURL(element) {
    if (!element) return null;
    var value = String(element.attr('data-src') || element.attr('data-original')
      || element.attr('abs:src') || element.attr('src') || '').trim();
    if (!value || value === '/' || /^data:/i.test(value) || /^javascript:/i.test(value)) return null;
    if (value.indexOf('//') === 0) value = 'https:' + value;
    if (/^https?:\/\//i.test(value)) {
      var absolute = value.replace(/^http:/i, 'https:');
      var absoluteMatch = absolute.match(/^https:\/\/[^/]+(\/[^?#]*)?(?:[?#].*)?$/i);
      if (!absoluteMatch || !absoluteMatch[1] || absoluteMatch[1] === '/') return null;
      return absolute;
    }
    return absoluteMedia(value);
  }

  function libraryMedia(path) {
    var value = String(path || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) {
      var parsed = value.replace(/^http:/i, 'https:').match(/^(https:\/\/[^/]+)(\/[^?#]*)?(?:[?#].*)?$/i);
      if (!parsed || !parsed[2] || parsed[2] === '/') return null;
      var trustedOrigin = allowedDynamicImageHost(parsed[1]);
      if (!trustedOrigin) return null;
      return trustedOrigin + parsed[2];
    }
    return LIBRARY_MEDIA_BASE + (value.charAt(0) === '/' ? value : '/' + value);
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
      // A JM portrait URL is a different crop, not a transparent quality
      // upgrade. Only callers that explicitly requested that composition may
      // publish it; ordinary list records keep one stable cover identity.
      highResolutionCoverURL: highResolution ? albumCover(id, true) : null,
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
    // Keep the exact cover that the user tapped in the list. Replacing it with
    // the portrait CDN variant after the detail request completes makes the
    // visible cover jump to a tighter crop about a second after navigation.
    // Detail metadata does not require a second cover identity.
    var result = mapAlbum(item, false);
    var stableCover = original.coverURL || result.coverURL;
    result.coverURL = stableCover;
    result.highResolutionCoverURL = stableCover;
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
    // The album endpoint already supplies the values shown by the official
    // detail page. The old implementation requested every item in `series`
    // before returning merely to calculate aggregate counters. A 116-chapter
    // album therefore generated 116 extra requests and blocked the UI for
    // about a minute. Keep the detail path to this single album response.
    result.info.listedAt = dateText(item.addtime) || originalInfo.listedAt || originalInfo.posted || '';
    result.info.updatedAt = dateText(item.update_at) || originalInfo.updatedAt || originalInfo.updated || result.info.listedAt;
    result.info.metricScope = '当前作品';
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
    result.relatedMangas = mapAlbums(item.related_list || [], 18).filter(function (manga) {
      return manga.id !== result.id;
    });

    // Recommendations already arrive with the album payload. Optional website
    // scraping and a second random-recommend API used to block the entire
    // detail screen when either host was slow; render the available data now.
    result.recommendations = result.relatedMangas.slice(0, 12);
    result.relatedArticles = [];
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
    var authorID = String(item.author_id || '');
    var path = kind === 'novel' ? '/novel/' + id
      : (authorID ? '/library/' + authorID + '/' + id : '/library/item/' + id);
    var info = { contentKind: kind };
    if (item.likes !== undefined) info.likes = String(item.likes);
    if (item.update_at) info.updatedAt = String(item.update_at);
    if (item.work_date) info.updatedAt = String(item.work_date);
    if (item.platform_name) info.platform = String(item.platform_name);
    if (authorID) info.authorID = authorID;
    return {
      id: kind + ':' + id,
      url: path,
      title: String(item.work_title || item.name || item.title || id).replace(/\s+/g, ' ').trim(),
      coverURL: kind === 'library'
        ? libraryMedia(item.work_image || item.image || item.pic_s || item.cover || '')
        : absoluteMedia(item.image || item.pic_s || ''),
      author: firstText(item.author_name || item.author),
      genres: [kind === 'novel' ? '小说' : '禁漫书库'],
      status: 'unknown',
      info: info
    };
  }

  function editorialChannelTitle(channel) {
    if (channel === 'raiders') return '游戏文库';
    if (channel === 'sexytalk') return '西斯话题';
    return '绅夜食堂';
  }

  function blogChannel(item, fallback) {
    var category = item && item.category && typeof item.category === 'object' ? item.category : {};
    var channel = String(category.slug || fallback || 'dinner').trim();
    return channel === 'raiders' || channel === 'sexytalk' ? channel : 'dinner';
  }

  function blogCover(item) {
    var value = String((item && item.photo) || '').trim();
    if (!value || (!/^https?:\/\//i.test(value) && value.charAt(0) !== '/')) return null;
    return absoluteMedia(value);
  }

  function mapBlogEditorial(item, fallbackChannel) {
    item = item || {};
    var id = String(item.id || '');
    var channel = blogChannel(item, fallbackChannel);
    var tags = stringList(item.tags).filter(function (tag) { return !!String(tag || '').trim(); });
    var plain = stripHTML(String(item.content || '')).replace(/\s+/g, ' ').trim();
    var info = {
      contentKind: 'article',
      editorialChannel: channel,
      editorialTitle: editorialChannelTitle(channel),
      blogID: id
    };
    if (item.date) info.listedAt = String(item.date);
    if (item.total_views !== undefined) info.views = String(item.total_views);
    if (item.total_comments !== undefined) info.comments = String(item.total_comments);
    if (item.total_likes !== undefined) info.likes = String(item.total_likes);
    var authorAvatarURL = absoluteUserPhoto(item.photo || item.avatar || item.user_photo);
    if (authorAvatarURL) info.authorAvatarURL = authorAvatarURL;
    if (item.username) info.authorProfileURL = WEBSITE_BASE + '/user/' + encodeURIComponent(String(item.username)) + '/blog';
    return {
      id: 'article:' + id,
      url: '/blog/' + id,
      title: String(item.title || id).replace(/\s+/g, ' ').trim(),
      coverURL: blogCover(item),
      author: firstText(item.nickname || item.username),
      description: plain ? plain.slice(0, 280) : null,
      genres: [editorialChannelTitle(channel)].concat(tags),
      status: 'unknown',
      info: info
    };
  }

  function blogListResult(data, channel, page) {
    data = data && typeof data === 'object' ? data : {};
    var rawItems = Array.isArray(data.list) ? data.list : [];
    if (channel === 'sexytalk') {
      rawItems = rawItems.filter(function (item) { return blogChannel(item, '') === 'sexytalk'; });
    }
    var count = Math.max(0, Number(data.count || data.total || 0));
    return {
      items: rawItems.map(function (item) { return mapBlogEditorial(item, channel); }),
      hasNextPage: Number(page || 1) * 12 < count,
      total: count
    };
  }

  function editorialWebsitePage(channel, page) {
    page = Math.max(1, Number(page || 1));
    var path = '/blogs/' + channel + (page > 1 ? '?page=' + page : '');
    var doc = websiteDocument(path);
    var items = parseEditorialCards(doc, channel);
    var hasNext = false;
    if (doc && typeof doc.select === 'function') {
      doc.select('a[href*="?page="]').forEach(function (anchor) {
        var href = anchor.attr('abs:href') || anchor.attr('href') || '';
        if (new RegExp('[?&]page=' + (page + 1) + '(?:&|$)').test(String(href))) hasNext = true;
      });
    }
    return { items: items, hasNextPage: hasNext };
  }

  function parseEditorialCards(root, channel, limit) {
    if (!root || typeof root.select !== 'function') return [];
    var seen = {};
    var output = [];
    root.select('a[href*="/blog/"]').forEach(function (anchor) {
      if (limit && output.length >= limit) return;
      var href = anchor.attr('abs:href') || anchor.attr('href') || '';
      var match = String(href).match(/\/blog\/(\d+)(?:[/?#]|$)/);
      var image = anchor.selectFirst('img');
      if (!match || !image || seen[match[1]]) return;
      var titleElement = anchor.selectFirst('.title') || anchor.selectFirst('.card-title');
      var title = titleElement ? titleElement.text().trim() : '';
      if (!title) title = String(image.attr('title') || image.attr('alt') || '').trim();
      if (!title) {
        title = anchor.text().trim();
        var channelTitle = editorialChannelTitle(channel);
        if (title.indexOf(channelTitle) === 0) title = title.slice(channelTitle.length).trim();
      }
      if (!title) return;
      seen[match[1]] = true;
      output.push({
        id: 'article:' + match[1],
        url: '/blog/' + match[1],
        title: title,
        coverURL: webImageURL(image),
        genres: [editorialChannelTitle(channel)],
        status: 'unknown',
        info: {
          contentKind: 'article',
          editorialChannel: channel,
          editorialTitle: editorialChannelTitle(channel),
          blogID: match[1]
        }
      });
    });
    return output;
  }

  function editorialPage(channel, page) {
    page = Math.max(1, Number(page || 1));
    try {
      if (channel === 'dinner' || channel === 'raiders') {
        var direct = apiGet('/blogs?page=' + page + '&blog_type=' + encodeURIComponent(channel)) || {};
        return blogListResult(direct, channel, page);
      }

      // The current mobile client has no dedicated 西斯话题 tab. Its API
      // returns dinner + sexytalk together for an unrecognised blog_type, so
      // scan a small, non-overlapping three-page window and retain only the
      // official sexytalk category. This keeps pagination incremental while
      // avoiding the Cloudflare-protected website list.
      var firstRemotePage = (page - 1) * 3 + 1;
      var paths = [firstRemotePage, firstRemotePage + 1, firstRemotePage + 2].map(function (remotePage) {
        return '/blogs?page=' + remotePage + '&blog_type=all';
      });
      var payloads = apiGetBatch(paths);
      var rawItems = [];
      var total = 0;
      payloads.forEach(function (payload) {
        if (!payload || typeof payload !== 'object') return;
        total = Math.max(total, Number(payload.count || payload.total || 0));
        (payload.list || []).forEach(function (item) {
          if (blogChannel(item, '') === 'sexytalk') rawItems.push(item);
        });
      });
      return {
        items: rawItems.map(function (item) { return mapBlogEditorial(item, 'sexytalk'); }),
        hasNextPage: (firstRemotePage + 2) * 12 < total
      };
    } catch (_) {
      return editorialWebsitePage(channel, page);
    }
  }

  function creatorWorkPage(page) {
    page = Math.max(1, Number(page || 1));
    var payload = apiGet('/creator_work?page=' + page + '&search_value=&lang=&source=') || {};
    if (payload && payload.data && typeof payload.data === 'object') payload = payload.data;
    var rawItems = Array.isArray(payload.content) ? payload.content : [];
    var total = Math.max(0, Number(payload.total || 0));
    return {
      items: rawItems.map(function (item) { return mapEditorial(item, 'library'); }),
      hasNextPage: page * 30 < total
    };
  }

  function editorialPromotePage(kind, promoteID, page) {
    if (kind === 'library') return creatorWorkPage(page);
    var data = apiGet('/promote_list?id=' + encodeURIComponent(promoteID) + '&page=' + Number(page || 1)) || {};
    var rawItems = Array.isArray(data) ? data : (data.list || data.content || []);
    var items = rawItems.map(function (item) { return mapEditorial(item, kind); });
    var total = Number(data.total || 0);
    return {
      items: items,
      hasNextPage: total > 0 ? Number(page || 1) * 27 < total : items.length >= 27
    };
  }

  function articleBodyBlocks(root) {
    if (!root || typeof root.html !== 'function') return [];
    var html = String(root.html() || '');
    var pattern = /<(p|h[1-6]|blockquote|figure)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*>/gi;
    var blocks = [];
    var match;
    var index = 0;
    function push(kind, text, url) {
      var cleanText = text === null || text === undefined ? null : String(text).replace(/\s+/g, ' ').trim();
      if (!cleanText && !url) return;
      blocks.push({ id: 'block-' + index++, kind: kind, text: cleanText || null, url: url || null });
    }
    function pushText(fragment, kind) {
      var text = stripHTML(fragment).replace(/\s+/g, ' ').trim();
      if (text) push(kind || 'paragraph', text, null);
    }
    while ((match = pattern.exec(html)) !== null && blocks.length < 300) {
      var fragment = String(match[0] || '');
      if (/^<h[1-6]\b/i.test(fragment)) {
        pushText(fragment, 'heading');
        continue;
      }

      // Keep paragraphs, inline images and explicit links in their source
      // order. JM game-library posts commonly place a launch link before and
      // after the article; flattening the whole <p> first used to lose those
      // actions and move images away from the surrounding prose.
      var inlinePattern = /<a\b[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>/gi;
      var inlineMatch;
      var cursor = 0;
      while ((inlineMatch = inlinePattern.exec(fragment)) !== null && blocks.length < 300) {
        pushText(fragment.slice(cursor, inlineMatch.index), 'paragraph');
        var token = String(inlineMatch[0] || '');
        var tokenDoc = parseHTML('<div>' + token + '</div>', WEBSITE_BASE);
        if (/^<a\b/i.test(token)) {
          var anchor = tokenDoc.selectFirst ? tokenDoc.selectFirst('a[href]') : null;
          if (anchor) {
            var image = anchor.selectFirst('img');
            if (image) {
              var linkedImageURL = contentImageURL(image);
              if (linkedImageURL) push('image', image.attr('alt') || null, linkedImageURL);
            }
            var href = anchor.attr('abs:href') || anchor.attr('href') || '';
            var linkText = anchor.text().replace(/\s+/g, ' ').trim();
            var resolvedLink = articleLinkURL(href);
            if (resolvedLink && linkText) push('link', linkText, resolvedLink);
          } else {
            // The command-line smoke harness intentionally exposes only a
            // minimal HTML bridge. Keep a conservative attribute fallback so
            // the parser and its external-link policy are still testable.
            var rawHrefMatch = token.match(/\bhref\s*=\s*["']([^"']+)["']/i);
            var rawImageMatch = token.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
            if (rawImageMatch) {
              var rawImageValue = String(rawImageMatch[1] || '').trim();
              if (/^https?:\/\//i.test(rawImageValue)) {
                if (!/^https?:\/\/[^/]+\/?(?:[?#].*)?$/i.test(rawImageValue)) {
                  push('image', null, rawImageValue.replace(/^http:/i, 'https:'));
                }
              } else if (rawImageValue && rawImageValue !== '/') {
                push('image', null, absoluteMedia(rawImageValue));
              }
            }
            var rawLinkText = stripHTML(token).replace(/\s+/g, ' ').trim();
            var rawResolvedLink = articleLinkURL(rawHrefMatch && rawHrefMatch[1]);
            if (rawResolvedLink && rawLinkText) push('link', rawLinkText, rawResolvedLink);
          }
        } else {
          var standaloneImage = tokenDoc.selectFirst ? tokenDoc.selectFirst('img') : null;
          var imageURL = contentImageURL(standaloneImage);
          if (!imageURL) {
            var standaloneImageMatch = token.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
            if (standaloneImageMatch) {
              var standaloneValue = String(standaloneImageMatch[1] || '').trim();
              if (/^https?:\/\//i.test(standaloneValue)) {
                if (!/^https?:\/\/[^/]+\/?(?:[?#].*)?$/i.test(standaloneValue)) {
                  imageURL = standaloneValue.replace(/^http:/i, 'https:');
                }
              } else if (standaloneValue && standaloneValue !== '/') {
                imageURL = absoluteMedia(standaloneValue);
              }
            }
          }
          if (imageURL) push('image', standaloneImage ? (standaloneImage.attr('alt') || null) : null, imageURL);
        }
        cursor = inlinePattern.lastIndex;
      }
      pushText(fragment.slice(cursor), 'paragraph');
    }
    return blocks;
  }

  function parseAlbumCards(root, limit) {
    if (!root || typeof root.select !== 'function') return [];
    var seen = {};
    var output = [];
    root.select('a[href*="/album/"]').forEach(function (anchor) {
      if (limit && output.length >= limit) return;
      var href = anchor.attr('abs:href') || anchor.attr('href') || '';
      var match = String(href).match(/\/album\/(\d+)(?:[/?#]|$)/);
      var image = anchor.selectFirst('img');
      if (!match || !image || seen[match[1]]) return;
      var title = String(image.attr('title') || image.attr('alt') || anchor.text() || '').trim();
      if (!title) return;
      seen[match[1]] = true;
      var manga = mapAlbum({ id: match[1], name: title }, false);
      manga.coverURL = webImageURL(image) || manga.coverURL;
      output.push(manga);
    });
    return output;
  }

  function parseArticleDetails(manga) {
    var id = String(manga.id || manga.url || '').replace(/^article:/, '').replace(/\D/g, '');
    try {
      var payload = apiGet('/blog?id=' + encodeURIComponent(id)) || {};
      var apiInfo = payload.info || {};
      if (apiInfo.id || apiInfo.title || apiInfo.content) {
        var apiResult = {};
        Object.keys(manga).forEach(function (key) { apiResult[key] = manga[key]; });
        var channel = blogChannel(apiInfo, (manga.info || {}).editorialChannel || 'dinner');
        var tags = stringList(apiInfo.tags).filter(function (tag) { return !!String(tag || '').trim(); });
        var content = String(apiInfo.content || '');
        var contentRoot = parseHTML('<div>' + content + '</div>', WEBSITE_BASE);
        var apiBlocks = articleBodyBlocks(contentRoot);
        apiResult.id = 'article:' + id;
        apiResult.url = '/blog/' + id;
        apiResult.title = String(apiInfo.title || manga.title || id).replace(/\s+/g, ' ').trim();
        apiResult.author = firstText(apiInfo.nickname || apiInfo.username || manga.author);
        apiResult.genres = [editorialChannelTitle(channel)].concat(tags);
        apiResult.articleBlocks = apiBlocks;
        var apiDescription = stripHTML(content).replace(/\s+/g, ' ').trim();
        apiResult.description = apiDescription ? apiDescription.slice(0, 500) : manga.description;
        apiResult.info = apiResult.info || {};
        apiResult.info.contentKind = 'article';
        apiResult.info.blogID = id;
        apiResult.info.editorialChannel = channel;
        apiResult.info.editorialTitle = editorialChannelTitle(channel);
        var authorAvatarURL = absoluteUserPhoto(apiInfo.photo || apiInfo.avatar || apiInfo.user_photo);
        if (authorAvatarURL) apiResult.info.authorAvatarURL = authorAvatarURL;
        if (apiInfo.username) {
          apiResult.info.authorProfileURL = WEBSITE_BASE + '/user/' + encodeURIComponent(String(apiInfo.username)) + '/blog';
        }
        var experience = apiInfo.expInfo || apiInfo.expinfo || {};
        var authorLevel = apiInfo.level_name || experience.level_name;
        if (authorLevel) apiResult.info.authorLevel = String(authorLevel);
        if (apiInfo.date) apiResult.info.listedAt = String(apiInfo.date);
        if (apiInfo.total_views !== undefined) apiResult.info.views = String(apiInfo.total_views);
        if (apiInfo.total_comments !== undefined) apiResult.info.comments = String(apiInfo.total_comments);
        if (apiInfo.total_likes !== undefined) apiResult.info.likes = String(apiInfo.total_likes);
        apiResult.info.isLiked = isEnabledValue(apiInfo.is_liked) ? 'true' : 'false';
        apiResult.relatedMangas = mapAlbums(payload.related_comics || [], 12);
        apiResult.relatedArticles = (payload.related_blogs || []).map(function (item) {
          return mapBlogEditorial(item, channel);
        }).filter(function (item) { return item.id !== apiResult.id; }).slice(0, 12);
        return apiResult;
      }
    } catch (_) {}

    var doc = websiteDocument('/blog/' + id);
    var article = doc.selectFirst('article');
    if (!article) throw new Error('官网没有返回文章正文');
    var bodyRoot = article.selectFirst('.blog_content .p-t-10') || article.selectFirst('.p-t-10') || article;
    var blocks = articleBodyBlocks(bodyRoot);
    var titleElement = article.selectFirst('h1');
    var channelAnchor = article.selectFirst('a[href*="/blogs/"]');
    var channelMatch = channelAnchor
      ? String(channelAnchor.attr('href') || '').match(/\/blogs\/([^/?#]+)/)
      : null;
    var channel = channelMatch ? channelMatch[1] : String((manga.info || {}).editorialChannel || 'dinner');
    var authorAnchor = doc.selectFirst('a[href*="/user/"][href*="/blog"]');
    var authorImage = (authorAnchor && authorAnchor.selectFirst('img'))
      || doc.selectFirst('.blog_id_main img.comment-avatar')
      || doc.selectFirst('img.comment-avatar');
    var headerText = article.text();
    var dateMatch = headerText.match(/上架日期[：:]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    var commentsAnchor = doc.selectFirst('.gotoComments') || doc.selectFirst('a[href="#comments"]');
    var commentMatch = commentsAnchor ? commentsAnchor.text().match(/(\d+)/) : null;
    var likesElement = doc.selectFirst('[id^="total_likes_"]');
    var likesMatch = likesElement ? likesElement.text().match(/(\d+)/) : null;
    var result = {};
    Object.keys(manga).forEach(function (key) { result[key] = manga[key]; });
    result.id = 'article:' + id;
    result.url = '/blog/' + id;
    result.title = titleElement ? titleElement.text().trim() : manga.title;
    result.author = authorAnchor ? authorAnchor.text().trim() : manga.author;
    var fallbackTags = [];
    article.select('a[href*="/search/photos?search_query="]').forEach(function (anchor) {
      var tag = anchor.text().replace(/\s+/g, ' ').trim();
      if (tag && fallbackTags.indexOf(tag) < 0) fallbackTags.push(tag);
    });
    result.genres = [editorialChannelTitle(channel)].concat(fallbackTags);
    result.articleBlocks = blocks;
    result.description = blocks.filter(function (block) { return block.kind === 'paragraph' && block.text; })[0]
      ? blocks.filter(function (block) { return block.kind === 'paragraph' && block.text; })[0].text
      : manga.description;
    result.info = result.info || {};
    result.info.contentKind = 'article';
    result.info.blogID = id;
    result.info.editorialChannel = channel;
    result.info.editorialTitle = editorialChannelTitle(channel);
    var fallbackAvatarURL = webImageURL(authorImage);
    if (fallbackAvatarURL) result.info.authorAvatarURL = fallbackAvatarURL;
    if (authorAnchor) {
      var authorHref = authorAnchor.attr('abs:href') || authorAnchor.attr('href') || '';
      var authorProfileURL = websiteURL(authorHref);
      if (authorProfileURL) result.info.authorProfileURL = authorProfileURL;
    }
    var authorLevelElement = doc.selectFirst('.blog_name');
    if (authorLevelElement) {
      var authorLevelText = authorLevelElement.text().replace(/\s+/g, ' ').trim();
      if (authorLevelText && authorLevelText !== result.author) result.info.authorLevel = authorLevelText;
    }
    if (dateMatch) result.info.listedAt = dateMatch[1];
    if (commentMatch) result.info.comments = commentMatch[1];
    if (likesMatch) result.info.likes = likesMatch[1];
    var relatedRoot = doc.selectFirst('#related_comics');
    result.relatedArticles = parseEditorialCards(relatedRoot, channel, 12).filter(function (item) {
      return item.id !== result.id;
    });
    result.relatedMangas = parseAlbumCards(doc, 12);
    return result;
  }

  function parseLibraryDetails(manga) {
    var id = String(manga.id || manga.url || '').replace(/^library:/, '').replace(/\D/g, '');
    var authorID = String((manga.info || {}).authorID || '');
    var libraryPath = authorID ? '/library/' + authorID + '/' + id : '/library/item/' + id;
    try {
      var apiPayload = apiGet('/creator_work_info_detail?id=' + encodeURIComponent(id)) || {};
      if (apiPayload && apiPayload.data && typeof apiPayload.data === 'object') apiPayload = apiPayload.data;
      if (apiPayload.id || apiPayload.name || Array.isArray(apiPayload.images)) {
        var apiResult = {};
        Object.keys(manga).forEach(function (key) { apiResult[key] = manga[key]; });
        var apiBlocks = [];
        var content = String(apiPayload.content || '');
        if (content) {
          apiBlocks = articleBodyBlocks(parseHTML('<div>' + content + '</div>', WEBSITE_BASE));
        }
        var seenImages = {};
        apiBlocks.forEach(function (block) {
          if (block.kind === 'image' && block.url) seenImages[block.url] = true;
        });
        (apiPayload.images || []).forEach(function (image, index) {
          var imageURL = libraryMedia(image && image.image);
          if (!imageURL || seenImages[imageURL]) return;
          seenImages[imageURL] = true;
          apiBlocks.push({
            id: 'library-image-' + String((image && image.page) || index),
            kind: 'image',
            text: null,
            url: imageURL
          });
        });
        apiResult.id = 'library:' + id;
        apiResult.url = libraryPath;
        apiResult.title = String(apiPayload.name || manga.title || id).replace(/\s+/g, ' ').trim();
        apiResult.author = firstText(apiPayload.author_name || apiPayload.author || manga.author);
        apiResult.genres = ['禁漫书库'];
        apiResult.articleBlocks = apiBlocks;
        var apiDescription = stripHTML(content).replace(/\s+/g, ' ').trim();
        apiResult.description = apiDescription ? apiDescription.slice(0, 500) : manga.description;
        apiResult.info = apiResult.info || {};
        apiResult.info.contentKind = 'library';
        apiResult.info.workID = id;
        apiResult.info.contentCount = String(apiBlocks.filter(function (block) { return block.kind === 'image'; }).length);
        if (apiPayload.adddt) apiResult.info.listedAt = String(apiPayload.adddt);
        else if (apiPayload.addtime) apiResult.info.listedAt = String(apiPayload.addtime);
        apiResult.relatedArticles = [];
        return apiResult;
      }
    } catch (_) {}

    var doc = websiteDocument(libraryPath);
    var article = doc.selectFirst('article.library-works') || doc.selectFirst('article');
    if (!article) throw new Error('官网没有返回书库作品正文');
    var titleElement = article.selectFirst('h1') || doc.selectFirst('h1');
    var authorHeader = doc.selectFirst('.author-header.works') || doc.selectFirst('.author-header');
    var authorAnchor = (authorHeader && authorHeader.selectFirst('a[href*="/library/"]'))
      || doc.selectFirst('a[href*="/library/"]');
    var bodyRoot = article.selectFirst('section') || article;
    var blocks = articleBodyBlocks(bodyRoot);
    var result = {};
    Object.keys(manga).forEach(function (key) { result[key] = manga[key]; });
    result.id = 'library:' + id;
    result.url = libraryPath;
    result.title = titleElement ? titleElement.text().trim() : manga.title;
    result.author = authorAnchor ? authorAnchor.text().trim() : manga.author;
    result.genres = ['禁漫书库'];
    result.articleBlocks = blocks;
    result.info = result.info || {};
    result.info.contentKind = 'library';
    result.info.workID = id;
    var authorAvatar = authorHeader && authorHeader.selectFirst('img');
    var authorAvatarURL = contentImageURL(authorAvatar);
    if (authorAvatarURL) result.info.authorAvatarURL = authorAvatarURL;
    if (authorAnchor) {
      var authorProfileURL = websiteURL(authorAnchor.attr('abs:href') || authorAnchor.attr('href') || '');
      if (authorProfileURL) result.info.authorProfileURL = authorProfileURL;
    }
    var platformAnchor = authorHeader && authorHeader.selectFirst('a[href^="http"]');
    if (platformAnchor) {
      var platformURL = articleLinkURL(platformAnchor.attr('abs:href') || platformAnchor.attr('href') || '');
      if (platformURL) result.info.authorPlatformURL = platformURL;
      var platformName = platformAnchor.text().replace(/\s+/g, ' ').trim();
      if (platformName) result.info.platform = platformName;
    }
    var dateMatch = article.text().match(/([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9:]+)?)/);
    if (dateMatch) result.info.listedAt = dateMatch[1];

    var seen = {};
    var related = [];
    doc.select('a[href*="/library/"]').forEach(function (anchor) {
      var href = anchor.attr('abs:href') || anchor.attr('href') || '';
      var match = String(href).match(/\/library\/(\d+)\/(\d+)(?:[/?#]|$)/);
      var image = anchor.selectFirst('img');
      if (!match || !image || seen[match[2]] || match[2] === id) return;
      var title = String(image.attr('title') || image.attr('alt') || anchor.text() || match[2]).trim();
      seen[match[2]] = true;
      related.push({
        id: 'library:' + match[2], url: '/library/' + match[1] + '/' + match[2], title: title,
        coverURL: contentImageURL(image), author: result.author, genres: ['禁漫书库'], status: 'unknown',
        info: { contentKind: 'library', authorID: match[1] }
      });
    });
    result.relatedArticles = related.slice(0, 12);
    return result;
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
    if (id.indexOf('community:') === 0) return editorialPage(id.slice('community:'.length), page);
    if (id === 'library') return editorialPromotePage('library', '1001', page);
    if (id === 'novels') return editorialPromotePage('novel', '1002', page);
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
        : badge && (badge.image || badge.icon || badge.photo || badge.pic || badge.url || badge.path || badge.content);
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

  var commentPagingCache = {};
  var COMMENT_PAGE_SIZE = 30;
  var COMMENT_PREVIEW_SIZE = 10;
  var COMMENT_FETCH_BATCH_SIZE = 8;

  function numericCommentTotal(manga) {
    var raw = manga && manga.info ? manga.info.comments : null;
    var value = Number(String(raw || '').replace(/,/g, ''));
    return isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }

  function appendCommentList(state, list) {
    flattenComments(list || [], state.titles).forEach(function (comment) {
      if (state.seen[comment.id]) return;
      state.seen[comment.id] = true;
      state.pending.push(comment);
    });
  }

  function scheduleForumRemainder(state, chapterID, data) {
    var total = Math.max(0, Number((data || {}).total || 0));
    var pageCount = Math.min(250, Math.ceil(total / 10));
    for (var page = 2; page <= pageCount && state.remainingPaths.length < 800; page++) {
      state.remainingPaths.push('/forum?aid=' + encodeURIComponent(chapterID) + '&mode=manhua&page=' + page);
    }
  }

  function fillCommentPending(state, targetCount, maximumPasses) {
    targetCount = Math.max(1, Number(targetCount || COMMENT_PAGE_SIZE));
    maximumPasses = Math.max(1, Number(maximumPasses || 30));
    var guard = 0;
    while (state.pending.length < targetCount && guard++ < maximumPasses) {
      if (state.remainingPaths.length) {
        var paths = state.remainingPaths.splice(0, COMMENT_FETCH_BATCH_SIZE);
        apiGetBatch(paths).forEach(function (data) {
          if (data && Array.isArray(data.list)) appendCommentList(state, data.list);
        });
        continue;
      }
      if (!state.contextLoaded) {
        var context = commentChapterContext(state.rootID);
        state.titles = context.titles;
        state.chapterIDs = context.chapterIDs.filter(function (chapterID) {
          return String(chapterID) !== String(state.rootID);
        });
        state.contextLoaded = true;
        continue;
      }
      if (state.chapterIndex < state.chapterIDs.length) {
        var chapterBatch = state.chapterIDs.slice(
          state.chapterIndex,
          state.chapterIndex + COMMENT_FETCH_BATCH_SIZE
        );
        state.chapterIndex += chapterBatch.length;
        var firstPaths = chapterBatch.map(function (chapterID) {
          return '/forum?aid=' + encodeURIComponent(chapterID) + '&mode=manhua&page=1';
        });
        apiGetBatch(firstPaths).forEach(function (data, index) {
          if (!data) return;
          if (Array.isArray(data.list)) appendCommentList(state, data.list);
          scheduleForumRemainder(state, chapterBatch[index], data);
        });
        continue;
      }
      break;
    }
  }

  function albumCommentPage(manga, page) {
    var id = albumID(manga.id || manga.url);
    page = Math.max(1, Number(page || 1));
    var state = commentPagingCache[id];
    if (page === 1 || !state) {
      var root = apiGet('/forum?aid=' + encodeURIComponent(id) + '&mode=manhua&page=1') || {};
      state = {
        rootID: id,
        titles: {},
        chapterIDs: [],
        contextLoaded: false,
        chapterIndex: 0,
        remainingPaths: [],
        pending: [],
        seen: {},
        pages: {},
        total: numericCommentTotal(manga)
      };
      appendCommentList(state, root.list || []);
      scheduleForumRemainder(state, id, root);
      // The album total includes comments attached to individual chapters.
      // When the root page is empty, fetch a bounded preview immediately so
      // the detail card does not claim there are hundreds of comments while
      // rendering an empty preview. Full pagination remains incremental.
      if (state.pending.length < COMMENT_PREVIEW_SIZE) {
        fillCommentPending(state, COMMENT_PREVIEW_SIZE, 4);
      }
      var firstComments = state.pending.splice(0, COMMENT_PAGE_SIZE);
      state.pages[1] = {
        comments: firstComments,
        hasNextPage: state.pending.length > 0
          || state.remainingPaths.length > 0
          || !state.contextLoaded
          || state.chapterIndex < state.chapterIDs.length,
        total: state.total
      };
      commentPagingCache[id] = state;
      if (page === 1) return state.pages[1];
    }
    if (state.pages[page]) return state.pages[page];
    var highest = 1;
    Object.keys(state.pages).forEach(function (key) { highest = Math.max(highest, Number(key || 1)); });
    while (highest < page) {
      fillCommentPending(state, COMMENT_PAGE_SIZE, 30);
      highest += 1;
      var comments = state.pending.splice(0, COMMENT_PAGE_SIZE);
      state.pages[highest] = {
        comments: comments,
        hasNextPage: state.pending.length > 0
          || state.remainingPaths.length > 0
          || state.chapterIndex < state.chapterIDs.length,
        total: state.total
      };
      if (!comments.length && !state.pages[highest].hasNextPage) break;
    }
    return state.pages[page] || { comments: [], hasNextPage: false, total: state.total };
  }

  function articleCommentPage(manga, page) {
    var id = String(manga.id || manga.url || '').replace(/^article:/, '').replace(/\D/g, '');
    page = Math.max(1, Number(page || 1));
    var data = apiGet('/forum?bid=' + encodeURIComponent(id) + '&mode=all&page=' + page) || {};
    var total = Math.max(0, Number(data.total || numericCommentTotal(manga) || 0));
    return {
      comments: flattenComments(data.list || [], {}),
      hasNextPage: page * 10 < total,
      total: total
    };
  }

  function commentPageForManga(manga, page) {
    var kind = manga && manga.info ? manga.info.contentKind : 'comic';
    if (kind === 'article') return articleCommentPage(manga, page);
    if (kind && kind !== 'comic') return { comments: [], hasNextPage: false, total: 0 };
    return albumCommentPage(manga, page);
  }

  var interactionCache = {};
  var favoriteCache = {};

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

  function articleInteraction(id) {
    var payload = apiGet('/blog?id=' + encodeURIComponent(id)) || {};
    var detail = payload.info || {};
    return {
      isLiked: isEnabledValue(detail.is_liked),
      likeCount: detail.total_likes === undefined ? null : String(detail.total_likes)
    };
  }

  function confirmArticleInteraction(id, predicate) {
    var latest = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) sleep(180);
      latest = articleInteraction(id);
      if (predicate(latest)) break;
    }
    return latest;
  }

  function confirmAlbumInteraction(id, predicate) {
    var latest = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) sleep(180);
      latest = albumInteraction(id);
      if (predicate(latest)) break;
    }
    return latest;
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

  function confirmTrackingInteraction(id, desired) {
    var latest = false;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) sleep(180);
      latest = trackingInteraction(id);
      if (latest === desired) break;
    }
    return latest;
  }

  function hasBusinessStatus(payload, expected) {
    if (!payload || typeof payload !== 'object') return false;
    var status = String(payload.status === undefined ? '' : payload.status).toLowerCase();
    return (expected || []).some(function (value) { return status === value; });
  }

  function adjustedCount(value, delta) {
    var text = String(value === undefined || value === null ? '' : value);
    var numeric = Number(text.replace(/,/g, ''));
    if (!isFinite(numeric)) return value;
    return String(Math.max(0, Math.floor(numeric + delta)));
  }

  function interactionState(manga) {
    var kind = manga && manga.info ? manga.info.contentKind : 'comic';
    if (kind === 'article') {
      var articleID = String(manga.id || manga.url || '').replace(/^article:/, '').replace(/\D/g, '');
      var article = articleInteraction(articleID);
      var articleState = {
        isSupported: true,
        canLike: !article.isLiked,
        isLiked: article.isLiked,
        likeCount: article.likeCount,
        canTrack: false,
        isTracked: false,
        message: null
      };
      interactionCache['article:' + articleID] = articleState;
      return articleState;
    }
    if (kind && kind !== 'comic') {
      return {
        isSupported: false, canLike: false, isLiked: false, likeCount: null,
        canTrack: false, isTracked: false, message: null
      };
    }
    var id = albumID(manga.id || manga.url);
    var album = albumInteraction(id);
    var tracked = false;
    try {
      tracked = trackingInteraction(id);
    } catch (_) {}
    var state = {
      isSupported: true,
      // JM's like endpoint is one-way. Once liked, neither the website nor
      // the mobile API provides a real unlike operation.
      canLike: !album.isLiked,
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

  function accountUsername(profile) {
    return profileValue(profile, ['username', 'nickname', 'nickName', 'fname', 'uid'], '');
  }

  function accountWebsitePath(kind, profile) {
    var username = accountUsername(profile);
    var encoded = encodeURIComponent(username);
    if (kind === 'profile') return '/user/edit';
    if (kind === 'avatar') return '/user/avatar';
    if (!username) return null;
    var paths = {
      overview: '/user/' + encoded,
      tasks: '/user/' + encoded + '/achievements',
      daily: '/user/' + encoded + '/daily',
      gacha: '/user/' + encoded + '/bonus',
      inbox: '/user/' + encoded + '/notice',
      comicFavorites: '/user/' + encoded + '/favorite/albums',
      novelFavorites: '/user/' + encoded + '/favorite/novels',
      tracking: '/user/' + encoded + '/tracking',
      tagBlock: '/user/' + encoded + '/tag_block',
      comicHistory: '/user/' + encoded + '/favorite/watchlist',
      novelHistory: '/user/' + encoded + '/favorite/novel_watchlist',
      videoHistory: '/user/' + encoded + '/playlist'
    };
    return paths[kind] || null;
  }

  function accountWebsiteLinks(kind, profile) {
    var path = accountWebsitePath(kind, profile);
    if (!path) return [];
    var titles = {
      profile: '打开官网完整资料编辑',
      avatar: '打开官网头像上传',
      tasks: '打开官网成就与任务',
      daily: '打开官网签到活动',
      gacha: '打开官网一番赏记录',
      inbox: '打开官网信箱',
      comicFavorites: '打开官网漫画收藏',
      novelFavorites: '打开官网小说收藏',
      tracking: '打开官网连载追踪',
      tagBlock: '打开官网标签屏蔽',
      comicHistory: '打开官网漫画观看记录',
      novelHistory: '打开官网小说观看记录',
      videoHistory: '打开官网小电影记录'
    };
    return [{ id: 'official:' + kind, title: titles[kind] || '打开官网完整页面', url: WEBSITE_BASE + path }];
  }

  function accountWebListMetrics(path, hrefFragment, prefix, limit) {
    var doc = websiteDocument(path);
    var seen = {};
    var metrics = [];
    doc.select('a[href*="' + hrefFragment + '"]').forEach(function (anchor) {
      if (metrics.length >= (limit || 30)) return;
      var href = String(anchor.attr('href') || anchor.attr('abs:href') || '');
      var title = String(anchor.text() || '').replace(/\s+/g, ' ').trim();
      var image = anchor.selectFirst('img');
      if (!title && image) title = String(image.attr('title') || image.attr('alt') || '').trim();
      if (!title || title.length > 160 || seen[href + '|' + title]) return;
      seen[href + '|' + title] = true;
      metrics.push({ id: (prefix || 'web') + ':' + metrics.length, title: title, value: '官网记录' });
    });
    return metrics;
  }

  function tagBlockMetrics(profile) {
    var path = accountWebsitePath('tagBlock', profile);
    if (!path) return [];
    var doc = websiteDocument(path);
    var metrics = [];
    doc.select('.tag-block-table tbody tr').forEach(function (row, index) {
      var cells = row.select('td');
      var title = cells.length ? String(cells[0].text() || '').trim() : '';
      var control = row.selectFirst('input[name="tag_block[]"]');
      if (!title || !control) return;
      var disabled = typeof control.hasAttr === 'function'
        ? control.hasAttr('disabled')
        : String(control.attr('disabled') || '').length > 0;
      var checked = typeof control.hasAttr === 'function'
        ? control.hasAttr('checked')
        : String(control.attr('checked') || '').length > 0;
      metrics.push({
        id: 'tag-block:' + index,
        title: title,
        value: disabled ? '当前等级未开放' : (checked ? '已屏蔽' : '未屏蔽')
      });
    });
    return metrics;
  }

  function websiteAccountSnapshot(profile) {
    var path = accountWebsitePath('overview', profile);
    if (!path) return { progress: [], battle: [], invitation: [] };
    var doc = websiteDocument(path);
    var known = {
      '稱號': '称号', '称号': '称号', '等級': '等级', '等级': '等级',
      '可收藏數': '可收藏数', '可收藏数': '可收藏数',
      'J Coins': 'JCOINS', 'JCOINS': 'JCOINS', '勳章': '勋章', '勋章': '勋章'
    };
    var progress = [];
    var battle = [];
    var seen = {};
    doc.select('.header-profile-row').forEach(function (row) {
      var nameElement = row.selectFirst('.header-profile-row-name');
      var valueElement = row.selectFirst('.header-profile-row-value');
      var rawName = nameElement ? String(nameElement.text() || '').trim() : '';
      var value = valueElement ? String(valueElement.text() || '').trim() : '';
      if (!rawName || !value) return;
      var name = known[rawName] || rawName;
      if (seen[name]) return;
      seen[name] = true;
      var metric = { id: 'website:' + name, title: name, value: value };
      if (known[rawName]) progress.push(metric);
      else battle.push(metric);
    });
    var charge = doc.selectFirst('.header-info-charge:not(.hidden-lg)') || doc.selectFirst('.header-info-charge');
    if (charge) {
      var chargeText = String(charge.text() || '').replace(/\s+/g, ' ').trim();
      var chargeMatch = chargeText.match(/([0-9]+\s*\/\s*[0-9]+)\s*充能/);
      var jarMatch = chargeText.match(/([0-9]+\s*\/\s*[0-9]+)\s*J罐/i);
      if (chargeMatch) progress.push({ id: 'website:charge', title: '充能', value: chargeMatch[1].replace(/\s+/g, '') });
      if (jarMatch) progress.push({ id: 'website:jar', title: 'J罐', value: jarMatch[1].replace(/\s+/g, '') });
    }
    var invitation = [];
    var username = accountUsername(profile);
    if (username) invitation.push({ id: 'invite-code', title: '邀请码', value: username });
    var inviteRoot = doc.selectFirst('.user-qrcode-main');
    if (inviteRoot) {
      var invited = String(inviteRoot.text() || '').match(/已邀請人數[：:]\s*([0-9]+\s*\/\s*[0-9]+)/);
      if (invited) invitation.push({ id: 'invite-count', title: '已邀请人数', value: invited[1].replace(/\s+/g, '') });
    }
    return { progress: progress, battle: battle, invitation: invitation };
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
        introduction: '原生编辑移动端支持的公开资料；性别、密码和头像等官网专属字段可在下方安全网页中完成。',
        sections: [{ id: 'profile', title: '公开资料', metrics: metricsFromObject(editable, 'profile', 28) }],
        links: accountWebsiteLinks('profile', profile).concat(accountWebsiteLinks('avatar', profile)), message: null
      };
    }
    if (kind === 'tasks') {
      var tasks = apiGet('/tasks?type=all&filter=all') || {};
      return {
        isSupported: true, title: '成就任务', introduction: '任务进度只读；领取奖励暂不自动执行。',
        sections: [{ id: 'tasks', title: '任务', metrics: listMetrics(tasks, 'task', 30).concat(metricsFromObject(tasks, 'task-field', 8)) }],
        links: accountWebsiteLinks('tasks', profile), message: null
      };
    }
    if (kind === 'daily') {
      var daily = apiGet('/daily?user_id=' + encodeURIComponent(uid)) || {};
      return {
        isSupported: true, title: '签到活动', introduction: '签到会改变账号状态，只有点击确认按钮后才会执行。',
        sections: [{ id: 'daily', title: '今日状态', metrics: metricsFromObject(daily, 'daily', 20) }],
        links: accountWebsiteLinks('daily', profile), message: null
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
        ], links: accountWebsiteLinks('inbox', profile), message: null
      };
    }
    if (kind === 'tracking') {
      var tracking = apiPost('/album_tracking', { page: '1' }) || {};
      return {
        isSupported: true, title: '连载追踪', introduction: '只读显示官网追踪列表；详情页铃铛可开启或关闭单本追踪。',
        sections: [{ id: 'tracking', title: '追踪漫画', metrics: listMetrics(tracking, 'tracking', 30) }],
        links: accountWebsiteLinks('tracking', profile), message: null
      };
    }
    if (kind === 'comicFavorites') {
      var favoritePage = apiGet('/favorite?page=1') || {};
      return {
        isSupported: true, title: '漫画收藏', introduction: '显示官网收藏的第一页；完整分页可在在线书架的收藏模式中浏览。',
        sections: [{ id: 'favorites', title: '最近收藏', metrics: listMetrics(favoritePage, 'favorite', 30) }],
        links: accountWebsiteLinks('comicFavorites', profile), message: null
      };
    }
    if (kind === 'comicHistory') {
      var watchPage = apiGet('/watch_list?page=1') || {};
      return {
        isSupported: true, title: '漫画观看记录', introduction: '显示官网记录的第一页；完整分页可在在线书架的历史模式中浏览。',
        sections: [{ id: 'history', title: '最近观看', metrics: listMetrics(watchPage, 'history', 30) }],
        links: accountWebsiteLinks('comicHistory', profile), message: null
      };
    }
    if (kind === 'novelFavorites') {
      var novels = apiGet('/novel_favorites?page=1&o=') || {};
      return {
        isSupported: true, title: '小说收藏', introduction: '显示官网小说收藏第一页，并保留独立的小说资料夹语义。',
        sections: [{ id: 'novel-favorites', title: '最近收藏', metrics: listMetrics(novels, 'novel-favorite', 30) }],
        links: accountWebsiteLinks('novelFavorites', profile), message: null
      };
    }
    if (kind === 'tagBlock') {
      var blockedTags = [];
      var tagMessage = null;
      try { blockedTags = tagBlockMetrics(profile); } catch (error) { tagMessage = String(error && error.message || error); }
      return {
        isSupported: true, title: '标签屏蔽', introduction: '逐项显示官网的屏蔽状态与等级限制；修改时进入受限的官网页面并由你确认。',
        sections: [{ id: 'tag-block', title: '屏蔽状态', metrics: blockedTags }],
        links: accountWebsiteLinks('tagBlock', profile), message: tagMessage
      };
    }
    if (kind === 'novelHistory' || kind === 'videoHistory') {
      var historyPath = accountWebsitePath(kind, profile);
      var fragment = kind === 'novelHistory' ? '/novel/' : '/video/';
      var webHistory = [];
      var historyMessage = null;
      try { webHistory = accountWebListMetrics(historyPath, fragment, kind, 30); }
      catch (historyError) { historyMessage = String(historyError && historyError.message || historyError); }
      return {
        isSupported: true,
        title: kind === 'novelHistory' ? '小说观看记录' : '小电影观看记录',
        introduction: '只读同步官网最近记录；清空操作仅在官网完整页面中由你手动确认。',
        sections: [{ id: kind, title: '最近观看', metrics: webHistory }],
        links: accountWebsiteLinks(kind, profile), message: historyMessage
      };
    }
    if (kind === 'gacha') {
      return {
        isSupported: true, title: '一番赏记录',
        introduction: '一番赏涉及 JCOINS 消费；App 展示余额并提供官网记录入口，不会自动抽取或购买。',
        sections: [{ id: 'gacha-balance', title: '当前资产', metrics: [
          { id: 'gacha-coin', title: 'JCOINS', value: profileValue(profile, ['coin'], '—') }
        ] }],
        links: accountWebsiteLinks('gacha', profile), message: null
      };
    }
    return {
      isSupported: false, title: '暂未开放', introduction: '该模块尚未完成安全验证。',
      sections: [], links: [], message: '暂未开放'
    };
  }

  function favoriteState(manga) {
    var id = albumID(manga.id || manga.url);
    var detail = albumInteraction(id);
    var state = {
      isSupported: true,
      isFavorited: detail.isFavorited,
      category: null,
      categories: [],
      note: null,
      message: null
    };
    favoriteCache[id] = state;
    return state;
  }

  function setFavoriteValue(manga, desired) {
    var id = albumID(manga.id || manga.url);
    var state = favoriteCache[id] || favoriteState(manga);
    if (state.isFavorited !== desired) {
      var result = apiPost('/favorite', { aid: id });
      if (!hasBusinessStatus(result, ['ok'])) {
        state.isSupported = false;
        state.message = String((result && (result.msg || result.message))
          || (desired ? '官网尚未确认收藏，请稍后重试' : '官网尚未确认取消收藏，请稍后重试'));
        return state;
      }
      var verified = confirmAlbumInteraction(id, function (latest) {
        return latest.isFavorited === desired;
      });
      state.isFavorited = !!(verified && verified.isFavorited);
      if (state.isFavorited !== desired) {
        state.isSupported = false;
        state.message = desired
          ? '官网尚未同步收藏状态，已恢复原状态'
          : '官网尚未同步取消收藏状态，已恢复原状态';
        favoriteCache[id] = state;
        return state;
      }
    }
    state.message = desired ? '已加入禁漫天堂收藏' : '已从禁漫天堂收藏移除';
    favoriteCache[id] = state;
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
      var novels = findPromote(promote, '1002') || { content: [] };
      var libraryPage = creatorWorkPage(1);
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
      var sectionStates = {
        featured: { state: heroManga.length ? 'loaded' : 'empty', message: weekday + '连载更新' }
      };
      [
        { id: 'dinner', title: '绅夜食堂' },
        { id: 'raiders', title: '游戏文库' },
        { id: 'sexytalk', title: '西斯话题' }
      ].forEach(function (channel) {
        var items = [];
        var state = 'empty';
        var message = null;
        try {
          items = editorialPage(channel.id, 1).items.slice(0, 10);
          state = items.length ? 'loaded' : 'empty';
        } catch (error) {
          state = 'failed';
          message = String(error && error.message ? error.message : error);
        }
        var sectionID = 'community:' + channel.id;
        sections.push({ id: sectionID, title: channel.title, items: items });
        sectionStates['hotCategory.' + sectionID] = { state: state, message: message };
      });
      if (libraryPage.items.length) {
        sections.push({
          id: 'library', title: '禁漫书库',
          items: libraryPage.items.slice(0, 10)
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
        sectionStates: (function () {
          sectionStates.hotCategories = { state: sections.length ? 'loaded' : 'empty', message: null };
          return sectionStates;
        })()
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
      if (kind === 'article') {
        try { return parseArticleDetails(manga); }
        catch (_) {
          var articleFallback = {};
          Object.keys(manga).forEach(function (key) { articleFallback[key] = manga[key]; });
          articleFallback.description = manga.description || '文章正文暂时无法读取，请稍后重试。';
          return articleFallback;
        }
      }
      if (kind === 'library') {
        try { return parseLibraryDetails(manga); }
        catch (_) {
          var libraryFallback = {};
          Object.keys(manga).forEach(function (key) { libraryFallback[key] = manga[key]; });
          libraryFallback.description = manga.description || '禁漫书库正文暂时无法读取，请稍后重试。';
          return libraryFallback;
        }
      }
      if (kind === 'community') {
        var copy = {};
        Object.keys(manga).forEach(function (key) { copy[key] = manga[key]; });
        copy.description = manga.description || '这是禁漫天堂文章栏目。';
        return copy;
      }
      var id = albumID(manga.id || manga.url);
      return mapDetailedAlbum(apiGet('/album?id=' + encodeURIComponent(id)) || { id: id }, manga);
    },

    getHighResolutionCover: function (manga) {
      var copy = {};
      Object.keys(manga).forEach(function (key) { copy[key] = manga[key]; });
      // JM's alternate portrait URL uses a different crop rather than merely
      // a higher-resolution copy. Preserve the list/detail cover identity so
      // native clients never replace the visible composition after navigation.
      copy.highResolutionCoverURL = copy.coverURL || null;
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
      // Modern chapter responses carry scramble_id. Prefer it and avoid a
      // second signed HTML request before the reader can display anything.
      // The official historical threshold remains the safe fallback.
      var parsedScrambleID = Number(data.scramble_id || 220980);
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
      return commentPageForManga(manga, 1).comments;
    },

    getCommentsPage: function (manga, page) {
      return commentPageForManga(manga, page);
    },

    submitCommentAdvanced: function (manga, body, spoiler, parentID) {
      var kind = manga.info && manga.info.contentKind;
      var id = kind === 'article'
        ? String(manga.id || manga.url || '').replace(/^article:/, '').replace(/\D/g, '')
        : albumID(manga.id || manga.url);
      var text = String(body || '').trim();
      if (!text) return { isSupported: true, didSubmit: false, message: '评论不能为空。', comments: null };
      if (kind === 'article') return {
        isSupported: false,
        didSubmit: false,
        message: '文章评论发送接口尚未完成官网验证。',
        comments: null
      };

      // The mobile API exposes comment reads but does not support writes. The
      // official website posts root comments to /ajax/album_comment; replies
      // use the same route with the three reply-specific fields below.
      var webFields = {
        video_id: id,
        comment: text,
        originator: ''
      };
      if (parentID) {
        webFields.comment_id = String(parentID);
        webFields.is_reply = '1';
        webFields.forum_subject = '1';
      } else {
        webFields.status = spoiler ? 'true' : 'false';
      }
      var submitted = websitePost('/ajax/album_comment', webFields, '/album/' + id + '/');
      var submitStatus = String(submitted && submitted.status !== undefined ? submitted.status : '').toLowerCase();
      var didSubmit = submitted && submitted.err === false
        && (submitted.cid !== undefined || (submitted.data && submitted.data.cid !== undefined));
      if (!didSubmit && (submitStatus === 'ok' || submitStatus === '1' || submitStatus === 'true')) didSubmit = true;
      if (!didSubmit) {
        return {
          isSupported: true,
          didSubmit: false,
          message: String((submitted && (submitted.msg || submitted.message || submitted.error)) || '官网没有确认评论发送。'),
          comments: null
        };
      }
      delete commentPagingCache[id];
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
      var favorites = {};
      var history = {};
      try { favorites = apiGet('/favorite?page=1') || {}; } catch (_) {}
      try { history = apiGet('/watch_list?page=1') || {}; } catch (_) {}
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
      var websiteSnapshot = { progress: [], battle: [], invitation: [] };
      try { websiteSnapshot = websiteAccountSnapshot(profile); } catch (_) {}
      if (websiteSnapshot.progress.length) progressMetrics = websiteSnapshot.progress;
      var username = accountUsername(profile);
      return {
        isSupported: true,
        sections: [
          { id: 'identity', title: '个人资料', metrics: [
            { id: 'nickname', title: '昵称', value: profileValue(profile, ['nickname', 'nickName', 'fname', 'username'], '已登录用户') },
            { id: 'status', title: '状态', value: profileValue(profile, ['status', 'message'], '已登录') },
            { id: 'uid', title: 'UID', value: profileValue(profile, ['uid'], '重新登录后显示') },
            { id: 'invite', title: '邀请码', value: profileValue(profile, ['invite_code'], username || '未公开') },
            { id: 'api', title: '数据线路', value: storage.get('active_api_domain') || '自动选择' }
          ] },
          { id: 'progress', title: '等级与资产', metrics: progressMetrics },
          { id: 'battle', title: '战斗力', metrics: websiteSnapshot.battle },
          { id: 'invitation', title: '邀请', metrics: websiteSnapshot.invitation },
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
      var kind = manga && manga.info ? manga.info.contentKind : 'comic';
      if (kind === 'article') {
        var articleID = String(manga.id || manga.url || '').replace(/^article:/, '').replace(/\D/g, '');
        var articleKey = 'article:' + articleID;
        var articleState = interactionCache[articleKey] || interactionState(manga);
        if (!desired || articleState.isLiked) {
          articleState.message = articleState.isLiked ? '这篇文章已经喜欢过了' : null;
          interactionCache[articleKey] = articleState;
          return articleState;
        }
        apiPost('/blog_like', { id: articleID });
        var verifiedArticle = confirmArticleInteraction(articleID, function (latest) { return latest.isLiked; });
        if (!verifiedArticle || !verifiedArticle.isLiked) {
          articleState.isSupported = false;
          articleState.message = '官网尚未确认文章喜欢状态，请稍后重试';
          interactionCache[articleKey] = articleState;
          return articleState;
        }
        articleState = {
          isSupported: true, canLike: false, isLiked: true,
          likeCount: verifiedArticle.likeCount || adjustedCount(articleState.likeCount, 1),
          canTrack: false, isTracked: false, message: '已喜欢这篇文章'
        };
        interactionCache[articleKey] = articleState;
        return articleState;
      }
      if (kind && kind !== 'comic') return interactionState(manga);
      var id = albumID(manga.id || manga.url);
      var state = interactionCache[id] || interactionState(manga);
      if (!desired) {
        state = {
          isSupported: !state.isLiked,
          canLike: !state.isLiked,
          isLiked: state.isLiked,
          likeCount: state.likeCount,
          canTrack: true,
          isTracked: state.isTracked,
          message: state.isLiked
            ? '禁漫天堂的喜欢是单向操作，官网暂不支持取消喜欢'
            : null
        };
        interactionCache[id] = state;
        return state;
      }
      if (!state.isLiked) {
        var result = apiPost('/like', { id: id });
        if (!hasBusinessStatus(result, ['success'])) {
          state.isSupported = false;
          state.message = String((result && (result.msg || result.message)) || '官网尚未确认点赞，请稍后重试');
          return state;
        }
        var verified = confirmAlbumInteraction(id, function (latest) { return latest.isLiked; });
        if (!verified || !verified.isLiked) {
          state.isSupported = false;
          state.message = '官网尚未同步喜欢状态，已恢复原状态';
          interactionCache[id] = state;
          return state;
        }
        state.likeCount = verified.likeCount || adjustedCount(state.likeCount, 1);
      }
      state = {
        isSupported: true,
        canLike: false,
        isLiked: true,
        likeCount: state.likeCount,
        canTrack: true,
        isTracked: state.isTracked,
        message: null
      };
      interactionCache[id] = state;
      state.message = '已喜欢这部漫画';
      return state;
    },
    setTracking: function (manga, desired) {
      var kind = manga && manga.info ? manga.info.contentKind : 'comic';
      if (kind && kind !== 'comic') return interactionState(manga);
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
