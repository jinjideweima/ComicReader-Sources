// Kmoe official website adapter. Credentials and file transfers belong to the host.
// Website scripts are parsed as data, never evaluated.
(function () {
  var BASE = 'https://kzo.moe';
  var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  var categories = '幽默 愛情 競技 熱血 格鬥 冒險 恐怖 生存 懸疑 偵探 歷史 戰爭 生活 勵志 校園 職場 美食 音樂 機戰 科幻 魔幻 魔法 奇幻 神鬼 武俠 仙俠 治癒 萌系 宅系 青年 少年 少女 後宮 百合 偽娘 性轉 青戀 耽美 轉生 穿越 童話 東方 四格 繪本 藝術 雜誌 輕改 連環畫'.split(' ');
  var definitions = [
    ['category', '分类（替换关键词）', ['全部'].concat(categories), [''].concat(categories.map(function (x) { return 'CAT*' + x; }))],
    ['region', '地区', ['全部', '日本', '欧美', '港台', '大陆', '韩国'], ['all', '日本', '歐美', '港臺', '大陸', '韓國']],
    ['status', '状态', ['全部', '完结', '连载'], ['all', '完結', '連載']],
    ['sort', '排序', ['综合排序', '评价排名', '热度排序', '最近热门', '随机列表', '最近收录', '最近更新'], ['sortpoint', 'score', 'count_push', 'count_rise', 'random', 'newadd', 'lastupdate']],
    ['language', '语言', ['全部', '中文', '繁体', '简体', '日文', '英文', '其他'], ['all', 'chn', 'cht', 'chs', 'jpn', 'eng', 'oth']],
    ['length', '篇幅', ['全部', '短篇', '中篇', '长篇'], ['all', 's', 'm', 'l']],
    ['ignore', '隐藏分类', ['跟随官网', '不隐藏', '隐藏耽美'], ['', 'none', 'BL']],
    ['color', '色彩', ['全部', '彩色'], ['0', '1']],
    ['hd', '画质', ['全部', '高清'], ['0', '1']]
  ];
  var errors = { e400: '官网暂不支持下载此文件', e401: '请先登录 Kmoe；会话失效时请重新登录', e402: '官网账号权限不足', e403: 'Kmoe 下载额度不足', e404: '官网暂时无法推送至 Kindle', e405: '请先在官网验证 Kindle 推送地址', e412: '官网要求两篇书评间隔至少 10 分钟', e430: '官网没有收到有效的卷选择，请刷新卷列表后重试；若仍失败，请在官网核对该卷是否已完成制作', e480: '请先激活 KOOBONE 账号', e481: 'KOOBONE 空间不足', e491: '官网验证失败，请重新打开作品或完成官网验证', e499: '官网系统错误', lv02: '本卷需要 Lv2', lv03: '本卷需要 Lv3', vip: '此功能需要官网 VIP' };
  function str(x) { return String(x == null ? '' : x); }
  function text(x) { return parseHTML('<div>' + str(x) + '</div>', BASE).text().replace(/\s+/g, ' ').trim(); }
  function match(html, re, fallback) { var m = str(html).match(re); return m ? m[1] : (fallback || ''); }
  function variable(html, name) {
    // Read literal assignments only. Do not evaluate website JavaScript.
    var re = new RegExp('(?:^|[\\s;,{}])(?:(?:var|let|const)\\s+|window\\.)?' + name + '\\s*=(?!=)\\s*(?:parseInt\\(\\s*)?["\x27]?([^"\x27;\\)\\s<]+)', 'g');
    var found, value = '';
    while ((found = re.exec(str(html)))) value = found[1];
    return value;
  }
  function url(path) {
    if (/^https:\/\/kzo\.moe(?:\/|$)/i.test(path)) return path;
    if (/^\/(?!\/)/.test(path)) return BASE + path;
    throw new Error('无效的官网地址');
  }
  var publicPageCache = {};
  function request(path, fields) {
    path = url(path).slice(BASE.length);
    var cacheable = !fields && /^\/c\/[a-z0-9]+\.htm$/i.test(path);
    var cached = publicPageCache[path];
    if (cacheable && cached && Date.now() - cached.time < 15000) return cached.body;
    if (fields || /(?:_do|_reply|_like|_score|_fav|_read|_follow)\.php/.test(path)) publicPageCache = {};
    var options = { timeout: 30, cachePolicy: 'reloadIgnoringLocalCacheData', headers: { 'User-Agent': UA, 'Referer': BASE + '/', 'Accept': 'text/html,application/json' } };
    if (fields) {
      options.method = 'POST'; options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = Object.keys(fields).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]); }).join('&');
    }
    var r;
    try { r = fetch(url(path), options); }
    catch (error) {
      if (/redirect.*allow-list/i.test(str(error))) throw new Error('官网将当前访问重定向到站外，请打开官网检查访问限制');
      throw error;
    }
    if (r.status >= 400) throw new Error('Kmoe HTTP ' + r.status);
    var body = str(r.body);
    if (r.url && !/^https:\/\/kzo\.moe(?:\/|$)/i.test(r.url)) throw new Error('官网将当前访问重定向到站外，请在官网确认访问状态后重试');
    if (!body.trim()) throw new Error('官网返回空白内容，请稍后重试');
    var publicPage = /disp_divinfo\s*\(/.test(body) || /^\d+$/.test(variable(body, 'bookid')) || /class=["'][^"']*text_bglight_big/.test(body);
    if (!publicPage && /id=["']ipt_passwd["']/.test(body)) throw new Error(errors.e401);
    if (/<title[^>]*>\s*Google(?:\s|<)/i.test(body) || /(?:location(?:\.href)?\s*=|url\s*=)\s*["']?https?:\/\/(?:www\.)?google\.com/i.test(body)) throw new Error('官网将当前访问重定向到站外，请打开官网检查访问限制；这不是下载额度不足');
    // Match actual response callbacks, never the error dictionary in a full page.
    // Full catalogue/detail pages contain dormant display_codeinfo("e430")
    // branches. Only compact action responses represent an error callback.
    var code = !publicPage && body.length < 2048 ? match(body, /(?:display_codeinfo|disp_codeinfo)\(\s*["'](e\d+|lv\d+|vip)["']/) : '';
    if (code) throw new Error(errors[code] || '官网拒绝此操作：' + code);
    if (cacheable && publicPage) {
      if (Object.keys(publicPageCache).length >= 16) publicPageCache = {};
      publicPageCache[path] = { time: Date.now(), body: body };
    }
    return body;
  }
  function json(path) { var body = request(path); try { return JSON.parse(body); } catch (_) { throw new Error('官网接口未返回有效数据，请检查登录或完成官网验证'); } }
  function quotedArgs(body, functionName) {
    var result = [], start = new RegExp('(?:parent\\.)?' + functionName + '\\s*\\(\\s*["\x27]', 'g'), m;
    while ((m = start.exec(body))) {
      var i = start.lastIndex - 1, args = [], quote = null, value = '', escaped = false;
      for (; i < body.length; i++) {
        var c = body.charAt(i);
        if (quote) {
          if (escaped) { value += c === 'n' ? '\n' : c === 'r' ? '\r' : c; escaped = false; }
          else if (c === '\\') escaped = true;
          else if (c === quote) { args.push(value); value = ''; quote = null; }
          else value += c;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ')') break;
      }
      if (!quote && i < body.length) result.push(args);
      start.lastIndex = i + 1;
    }
    return result;
  }
  function cards(body) {
    var seen = {}, result = [];
    quotedArgs(body, 'disp_divinfo').forEach(function (a) {
      // First argument is a DOM id expression containing two string literals.
      var offset = a[1] && /^https:\/\//.test(a[1]) ? 1 : 2;
      var link = a[offset];
      if (!/^https:\/\/kzo\.moe\/c\/[a-z0-9]+\.htm$/i.test(link || '') || seen[link]) return;
      seen[link] = true;
      result.push({ id: match(link, /\/c\/([a-z0-9]+)\.htm/i), url: link, title: text(a[offset + 8]), coverURL: a[offset + 1], author: text(a[offset + 9]), genres: [], status: 'unknown', info: { rating: a[offset + 7], delivery: 'downloadOnly' } });
    });
    return result;
  }
  function listing(page, query, filters) {
    var chosen = {}, parts = [];
    if (!str(query).trim() && !(filters || []).length) {
      var home = request('/l/--/' + Math.max(1, page || 1) + '.htm');
      var homePages = quotedArgs(home, 'disp_divpage');
      var homeTotal = homePages.length ? Number(homePages[0][2]) : 0;
      return { items: cards(home), hasNextPage: homeTotal > (page || 1), metadata: { page: str(Math.max(1, page || 1)), totalPages: str(homeTotal), pageSize: '21' } };
    }
    (filters || []).forEach(function (f) { chosen[f.key] = f.value; });
    definitions.forEach(function (d, i) {
      var n = parseInt(chosen[d[0]] || '0', 10);
      var value = d[3][n] == null ? d[3][0] : d[3][n];
      parts.push(i === 0 && !value ? str(query).trim() || 'all' : value);
    });
    if (!parts[6]) {
      var defaults = request('/');
      parts[6] = match(defaults, /\/l\/all,all,all,sortpoint,all,all,([^,]+),0,0\//, 'BL');
    }
    var body = request('/l/' + parts.map(encodeURIComponent).join(',') + '/' + Math.max(1, page || 1) + '.htm');
    var items = cards(body);
    var pages = quotedArgs(body, 'disp_divpage');
    var total = pages.length ? parseInt(pages[0][2], 10) : 0;
    return { items: items, hasNextPage: total > (page || 1), metadata: { page: str(Math.max(1, page || 1)), totalPages: str(total), pageSize: '21' } };
  }
  function labeled(source, label, next) {
    var re = new RegExp('(?:' + label + ')\\s*[：:]\\s*([\\s\\S]*?)' + (next ? '(?=(?:' + next + ')\\s*[：:])' : '$'));
    return text(match(source, re));
  }
  function resolveTitleCards(titles, limit) {
    var output = [], seen = {};
    (titles || []).slice(0, limit || 6).forEach(function (title) {
      try {
        var matches = listing(1, title, []).items;
        var normalized = text(title);
        var item = matches.filter(function (m) { return text(m.title) === normalized; })[0];
        if (item && !seen[item.id]) { seen[item.id] = true; output.push(item); }
      } catch (error) { throw error; }
    });
    return output;
  }
  function detail(manga) {
    var body = request(manga.url), doc = parseHTML(body, BASE);
    var id = variable(body, 'bookid');
    if (!/^\d+$/.test(id)) {
      var input = doc.selectFirst('input[name="bookid"], input[name="book_id"], #bookid');
      id = input ? str(input.attr('value')) : '';
    }
    if (!/^\d+$/.test(id)) id = match(body, /(?:book_score|book_comm_list|book_comm)\.php\?b=(\d+)(?:&|["'])/);
    if (!/^\d+$/.test(id)) throw new Error('官网作品页面未返回可识别的作品编号，请刷新详情；若仍失败，请检查官网是否打开了登录或验证页面');
    var titleNode = doc.selectFirst('.text_bglight_big'), authorBox = doc.selectFirst('td.author');
    var summary = authorBox ? authorBox.text().replace(/\s+/g, ' ').trim() : '';
    var title = titleNode ? titleNode.text() : manga.title;
    var aliases = summary.indexOf(title) === 0 ? summary.slice(title.length).replace(/^\s+/, '') : '';
    aliases = match(aliases, /^(.+?)(?=作者\s*[：:])/);
    var author = '';
    if (authorBox) authorBox.select('a[href*="list.php?s="]').forEach(function (node) {
      if (!author && node.text().trim()) author = node.text().trim();
    });
    if (!author) author = text(match(summary, /作者\s*[：:]\s*([\s\S]*?)(?=(?:狀態|状态)\s*[：:])/));
    var categoriesText = labeled(summary, '分類|分类', '');
    var categoryValues = [], cm, categoryRe = /([^\s()]+)\s*\((\d+)\)/g;
    while ((cm = categoryRe.exec(categoriesText))) categoryValues.push(text(cm[1]));
    var scoreNode = doc.selectFirst('.book_score'), scoreText = scoreNode ? scoreNode.text().replace(/\s+/g, ' ').trim() : '';
    function visible(id) {
      var node = doc.selectFirst('#' + id);
      return !!node && !/display\s*:\s*none/i.test(node.attr('style') || '');
    }
    var info = Object.assign({}, manga.info || {}, {
      bookID: id,
      author: author,
      delivery: 'downloadOnly',
      quota: variable(body, 'quota_now') + ' M',
      format: 'EPUB / MOBI',
      category: categoryValues.join(' · '),
      region: labeled(summary, '地區|地区', '語言|语言'),
      language: labeled(summary, '語言|语言', '最後出版|最后出版'),
      lastPublication: labeled(summary, '最後出版|最后出版', '更新'),
      update: labeled(summary, '更新', '版本'),
      version: labeled(summary, '版本', '掃者|扫者'),
      scanner: labeled(summary, '掃者|扫者', '維護者|维护者'),
      maintainer: labeled(summary, '維護者|维护者', '訂閱|订阅'),
      subscriptions: labeled(summary, '訂閱|订阅', '收藏'),
      favorites: labeled(summary, '收藏', '讀過|读过'),
      readCount: labeled(summary, '讀過|读过', '熱度|热度'),
      heat: labeled(summary, '熱度|热度', '分類|分类'),
      rating: match(scoreText, /(\d+(?:\.\d+)?)/),
      ratingCount: match(scoreText, /(\d+)\s*人評價/),
      ratingScale: '10',
      userRatingScale: '5',
      isRead: (function () { var link = doc.selectFirst('a[title="取消已讀"] img'); return link && !/display\s*:\s*none/i.test(link.attr('style') || '') ? '1' : '0'; })(),
      isFavorited: variable(body, 'can_do_fav') === '0' ? '1' : '0',
      isKoobSubscribed: visible('ftokoob_button_no') ? '1' : '0'
    });
    var description = match(body, /getElementById\("div_desc_content"\)\.innerHTML\s*=\s*"((?:\\.|[^"\\])*)"/);
    var related = [], recommendations = [];
    var dataKey = match(body, /data_book\(\s*["']([a-z0-9]+)["']\s*\)/i);
    if (manga.info && manga.info.loadRelated === '1') {
      try {
        if (!(Number(variable(body, 'uin')) > 0)) throw new Error('登录 Kmoe 后可读取官网相关推荐');
        if (!dataKey) throw new Error('官网相关推荐接口未出现在当前作品页面');
        var bookData = json('/data_book.php?h=' + encodeURIComponent(dataKey));
        if (bookData.linkbook) {
          var linked = str(bookData.linkbook).split(',');
          for (var li = 0; li + 1 < linked.length && related.length < 4; li += 2) {
            if (!/^[a-z0-9]+$/i.test(linked[li])) continue;
            var ref = bookRef(linked[li]); ref.title = text(linked[li + 1]);
            var item = detail(ref).manga;
            if (!related.some(function (m) { return m.id === item.id; })) related.push(item);
          }
        }
        if (Number(bookData.needrec) >= 1 && bookData.hash && bookData.bookname) {
          var recData = json('/data_recbook.php?h=' + encodeURIComponent(bookData.hash) + '&n=' + encodeURIComponent(bookData.bookname));
          recommendations = resolveTitleCards(Array.isArray(recData.recbook) ? recData.recbook : [], 4);
        }
        info.relatedStatus = 'loaded';
      } catch (error) { info.relatedStatus = 'failed'; info.relatedError = str(error.message || error); }
    }
    var cover = doc.selectFirst('img.img_book, img#book_cover, img[src*="/book/"]');
    if (!cover) cover = doc.selectFirst('td.author img') || doc.selectFirst('img[width="200"]');
    var metadataCover = doc.selectFirst('meta[property="og:image"], meta[name="og:image"]');
    var coverURL = manga.coverURL || (cover ? cover.attr('src') : metadataCover ? metadataCover.attr('content') : null);
    return { html: body, manga: Object.assign({}, manga, { coverURL: coverURL, title: title, author: author || manga.author, description: text(description), genres: categoryValues, tagGroups: categoryValues.length ? [{id:'categories',title:'分类',values:categoryValues}] : [], relatedMangas: related, recommendations: recommendations, status: variable(body, 'bookstatus') === '完結' ? 'completed' : 'ongoing', info: info, highResolutionCoverURL: coverURL }) };
  }
  function volumes(manga) {
    var d = detail(manga), h = d.html;
    if (!(Number(variable(h, 'uin')) > 0)) throw new Error(errors.e401);
    var key = match(h, /data_book\(\s*["']([a-z0-9]+)["']\s*\)/i);
    if (!key) throw new Error('官网卷列表接口已变化');
    var data = json('/data_book.php?h=' + encodeURIComponent(key));
    if (!Array.isArray(data.voldata)) throw new Error('官网未返回卷列表');
    return { detail: d, rows: data.voldata };
  }
  function archiveOptions(manga) {
    var v = volumes(manga), h = v.detail.html, options = [];
    var level = Number(variable(h, 'ulevel')), vip = Number(variable(h, 'is_vip')), restriction = Number(variable(h, 'is_r18'));
    if (!vip && ((restriction >= 2 && level < 3) || (restriction >= 1 && level < 2))) throw new Error(restriction >= 2 ? errors.lv03 : errors.lv02);
    if (!vip && Number(variable(h, 'need_vphone')) >= 1) throw new Error('请先完成官网账号激活');
    v.rows.forEach(function (row) {
      [['epub', 2, 11], ['mobi', 1, 9]].forEach(function (format) {
        if (!(Number(row[format[2]]) > 0)) return;
        options.push({ mode: str(row[0]) + ':' + format[1] + ':0', title: text(row[3]) + ' · ' + text(row[5]) + ' · ' + format[0].toUpperCase(), subtitle: str(row[7]) + ' 页' + (format[0] === 'mobi' ? ' · 下载后导出' : ' · 下载后离线阅读'), size: row[format[2]] + ' M', cost: '使用官网账号额度', requiresGPConfirmation: false, fileExtension: format[0] });
      });
    });
    return { isSupported: true, options: options, accountFunds: variable(h, 'quota_now') + ' M', message: options.length ? '额度、权限与重复下载计费均由官网决定' : '官网文件正在制作中' };
  }
  function archive(manga, mode) {
    var options = archiveOptions(manga);
    if (!options.options.some(function (o) { return o.mode === mode; })) throw new Error('此卷格式当前不可下载，请刷新');
    var d = detail(manga), parts = mode.split(':');
    var data = json('/getdownurl.php?b=' + d.manga.info.bookID + '&v=' + parts[0] + '&mobi=' + parts[1] + '&vip=' + parts[2] + '&json=1');
    if (!data.url || !/^https:\/\//i.test(data.url)) throw new Error(errors[data.code] || text(data.message || data.msg || '官网未生成下载链接'));
    return { isSupported: true, options: [], downloadURL: data.url, message: text(data.disp || data.name), fileName: str(data.name), fileExtension: parts[1] === '2' ? 'epub' : 'mobi' };
  }
  function overview() {
    var body = request('/my.php'), doc = parseHTML(body, BASE);
    var nickname = doc.selectFirst('#div_nickname_display');
    if (!nickname) throw new Error(errors.e401);
    var level = variable(body, 'user_level'), vip = Number(variable(body, 'is_vip'));
    var node = doc.selectFirst(vip ? '#div_user_vip' : Number(level) <= 1 ? '#div_user_lv1' : '#div_user_nor');
    return { isSupported: true, sections: [{ id: 'account', title: '官网账号与额度', metrics: [
      { id: 'level', title: '等级', value: 'Lv' + level + (vip ? ' · VIP' : '') },
      { id: 'quota', title: '额度与重置规则', value: node ? node.text().replace(/\s+/g, ' ').trim() : '请在官网账号页面查看' }
    ] }], message: '每个账号独立计费；当前剩余额度以下载时官网结果为准。' };
  }
  var tools = { overview: ['/my.php', '账号与额度'], records: ['/myrecord.php', '官网下载与推送记录'], subscriptions: ['/myfollow.php', '站点收藏与订阅'], devices: ['/mydevice.php', 'Kindle 推送设置'], activation: ['/myphone.php', 'KOOBONE 激活与等级'], comments: ['/mybookcomm.php', '账号相关书评'], uploads: ['/mycomic.php', '我的上传'], vip: ['/donate.php', 'VIP'], profile: ['/my.php', '资料与官网偏好'] };
  function field(id, title, value, options) { return { id: id, title: title, value: str(value), options: options || null, multiline: id === 'body' }; }
  function option(id, title) { return { id: str(id), title: title }; }
  function action(id, title, fields, confirmation) { return { id: id, title: title, fields: fields, confirmation: confirmation || null }; }
  function selectFields(doc, id) {
    return doc.select('#' + id + ' option').map(function (n) { return option(n.attr('value'), n.text()); });
  }
  function selected(doc, id) {
    var selected = doc.selectFirst('#' + id + ' option[selected]');
    var first = doc.selectFirst('#' + id + ' option');
    return selected ? selected.attr('value') : first ? first.attr('value') : '';
  }
  function tool(kind) {
    if (kind.indexOf('category:') === 0) {
      var slug = kind.slice(9), d = detail(bookRef(slug));
      if (!(Number(variable(d.html, 'uin')) > 0)) throw new Error(errors.e401);
      return { isSupported: true, title: '分类投票', sections: [], links: [], actions: [categoryAction(slug)] };
    }
    if (kind.indexOf('comments:') === 0) { var parts = kind.split(':'); return commentsTool(parts[1],parts[2],parts[3]); }
    if (kind.indexOf('book:') === 0) return bookTool(kind.slice(5));
    var t = tools[kind]; if (!t) throw new Error('未知账号功能');
    var body = request(t[0]), doc = parseHTML(body, BASE), sections = [], actions = [];
    if (kind === 'overview') sections = overview().sections;
    else if (kind === 'profile') {
      var nickname = doc.selectFirst('input[name=nickname]');
      actions.push(action('profile:nickname', '保存昵称', [field('nickname', '昵称', nickname ? nickname.attr('value') : '')]));
      [['10', 'sel_uhometab', '主页默认分类'], ['1', 'sel_deffile', '漫画默认分页']].forEach(function (d) {
        actions.push(action('profile:setting:' + d[0], '保存' + d[2], [field('value', d[2], selected(doc, d[1]), selectFields(doc, d[1]))]));
      });
      actions.push(action('profile:ignore', '保存官网过滤分类', [field('value', '过滤分类', selected(doc, 'sel_ignorecate'), selectFields(doc, 'sel_ignorecate'))]));
    } else {
      var metrics = [];
      doc.select('tr').forEach(function (row, index) {
        var cells = row.select('td');
        if (cells.length >= 2 && cells.length <= 8) {
          var values = cells.map(function (c) { return c.text().replace(/\s+/g, ' ').trim(); });
          if (values[0] && values.join(' ').length < 1000) metrics.push({ id: 'row-' + index, title: values[0], value: values.slice(1).join(' · ') });
        }
      });
      sections = [{ id: 'content', title: t[1], metrics: metrics }];
    }
    return { isSupported: true, title: t[1], sections: sections, actions: actions, links: [{ id: kind, title: '在官网管理' + t[1], url: BASE + t[0] }], message: actions.length || kind === 'overview' ? '数据来自当前登录账号。' : '此处显示官网记录摘要；完整管理、验证及分页可打开对应官网页面。' };
  }
  function bookRef(slug) {
    if (!/^[a-z0-9]+$/i.test(slug)) throw new Error('无效作品编号');
    return { id: slug, url: BASE + '/c/' + slug + '.htm', title: '' };
  }
  function commentsPage(manga, page, sort) {
    var d = detail(manga), order = sort === 'latest' ? 2 : sort === 'reply' ? 3 : 1;
    var h = request('/book_comm_list.php?b=' + d.manga.info.bookID + '&p=' + Math.max(1, page || 1) + '&o=' + order);
    var rows = quotedArgs(h, 'disp_book_comm_item2'), pagination = quotedArgs(h, 'disp_book_comm_title');
    var comments = [];
    rows.forEach(function (r) {
      var rootID = r[7];
      comments.push({ id: rootID, author: text(r[2]), avatarURL: r[3], dateText: r[10], body: text((r[9] ? r[9] + '\n' : '') + r[13]), score: r[8], likes: Number(r[11]), userVote: Number(r[12]), isUploader: false, parentID: null, isReply: false, threadDepth: 0, chapterID: str(Math.max(1, page || 1)) });
      var replyDoc = parseHTML('<div id="replies">' + str(r[14]) + '</div>', BASE);
      replyDoc.select('#replies > div').forEach(function (node, index) {
        var raw = node.text().replace(/\s+/g, ' ').trim();
        var authorNode = node.selectFirst('a b');
        var authorName = authorNode ? authorNode.text().trim() : '回复';
        var replyDate = text(match(node.html(), /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/));
        var replyBody = raw.replace(new RegExp('^' + authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*回覆\\s*[：:]\\s*'), '').replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*$/, '').trim();
        comments.push({ id: rootID + '-reply-' + (index + 1), author: authorName, dateText: replyDate, body: replyBody, parentID: rootID, isReply: true, replyToAuthor: text(r[2]), threadDepth: 1, isUploader: false, chapterID: str(Math.max(1, page || 1)) });
      });
    });
    return { comments: comments, hasNextPage: pagination.length > 0 && Number(pagination[0][1]) > (page || 1), total: pagination.length ? Number(pagination[0][0]) : null };
  }
  function categoryAction(slug) {
    return action('book:' + slug + ':category', '提交分类投票', [1,2,3].map(function(n) {return field('tag_cate_' + n, '分类 ' + n, '', [option('', '不选择')].concat(categories.map(function(c) { return option(c,c); })));}));
  }
  function bookTool(slug, includeVolumes) {
    var d = detail(bookRef(slug)), h = d.html, actions = [], prefix = 'book:' + slug + ':';
    if (!(Number(variable(h, 'uin')) > 0)) throw new Error(errors.e401);
    actions.push(action(prefix + 'favorite', '更新官网收藏', [field('value', '收藏', variable(h, 'can_do_fav') === '0' ? '0' : '1', [option('1', '收藏'), option('0', '取消收藏')])]));
    actions.push(action(prefix + 'follow', '更新官网订阅', [field('target', '推送目标', '9', [option('9', 'KOOBONE'), option('1', 'Kindle')]), field('value', '订阅', d.manga.info.isKoobSubscribed === '1' ? '0' : '1', [option('1', '订阅'), option('0', '取消订阅')])], '官网订阅会在作品更新时自动推送到所选设备。'));
    actions.push(action(prefix + 'rating', '提交评分', [field('score', '评分', '5', [1,2,3,4,5].map(function (n) { return option(n, n + ' 星'); }))]));
    actions.push(action(prefix + 'read', '更新已读状态', [field('value', '已读', '1', [option('1', '设为已读'), option('0', '取消已读')])], '此处同步官网已读标记，不代表文件已下载到本机。'));
    actions.push(action(prefix + 'review', '发表书评', [field('body', '书评正文', ''), field('score', '评分', '5', [1,2,3,4,5].map(function (n) { return option(n, n + ' 星'); })), field('spoiler', '包含剧透', '0', [option('0', '否'), option('1', '是')])], '将公开发布到 Kmoe 官网，官网要求两篇书评间隔至少 10 分钟。'));
    actions.push(categoryAction(slug));
    var vol = includeVolumes ? volumes(d.manga).rows : [];
    
    // Push targets are exposed by the book's official form; do not invent a bound device.
    var targets = [option('2', 'KOOBONE（需已激活）')];
    if (variable(h, 'device_mailto')) targets.push(option('0','官网已验证 Kindle'));
    if (targets.length && vol.length) actions.push(action(prefix + 'push', '推送所选卷', [field('volume','卷',str(vol[0][0]),vol.map(function(r){return option(r[0],text(r[3])+' · '+text(r[5]));})),field('target','官网已绑定目标',targets[0].id,targets)], '将通过官网推送此卷并按官网规则扣除额度。'));
    return { isSupported: true, title: d.manga.title, sections: [{id:'quota',title:'官网状态',metrics:[{id:'remaining',title:'剩余额度',value:variable(h,'quota_now')+' M'}]}], actions: actions, links: [{id:'book',title:'官网作品详情与全部书评',url:d.manga.url}], message: '收藏、订阅、评分、已读和推送均同步官网。' };
  }
  function commentsTool(slug, page, sort) {
    page = Math.max(1, Number(page) || 1); sort = ['hot','latest','reply'].indexOf(sort)>=0 ? sort : 'hot';
    var d = detail(bookRef(slug)), order = sort === 'latest' ? 2 : sort === 'reply' ? 3 : 1;
    var h = request('/book_comm_list.php?b='+d.manga.info.bookID+'&p='+page+'&o='+order);
    var rows = quotedArgs(h,'disp_book_comm_item2'), pages = quotedArgs(h,'disp_book_comm_title');
    var totalPages = pages.length ? Number(pages[0][1]) : 1, actions=[], sections=[], links=[{id:'report',title:'举报书评',url:BASE+'/book_comm.php?b='+d.manga.info.bookID+'&t=2'}];
    actions.push(action('browse:comments:'+slug+':1:'+sort,'切换书评排序',[field('sort','排序',sort,[option('hot','点赞最多'),option('latest','最新发布'),option('reply','最近回复')])]));
    rows.forEach(function(r){
      sections.push({id:r[7],title:text(r[2])+' · '+r[10]+' · '+r[11]+' 赞',metrics:[{id:'body',title:r[8]+' 星',value:text(r[13])},{id:'replies',title:'回复',value:text(r[14])||'暂无回复'}]});
      if(Number(variable(d.html,'uin'))>0){
        var prefix='comment:'+slug+':'+r[7]+':'+page+':'+sort+':';
        actions.push(action(prefix+'like',Number(r[12]) ? '取消赞 · '+text(r[2]) : '点赞 · '+text(r[2]),[]));
        actions.push(action(prefix+'reply','回复 · '+text(r[2]),[field('body','回复内容','')],'将公开回复到官网此条书评下。'));
        if(Number(r[17])>0){
          actions.push(action(prefix+'delete','删除我的书评',[],'将从官网删除这条书评，此操作无法撤销。'));
          links.push({id:'edit-'+r[7],title:'编辑我的书评',url:BASE+'/book_comm.php?b='+d.manga.info.bookID+'&c='+r[7]});
        }
      }
    });
    if(page>1)actions.push(action('browse:comments:'+slug+':'+(page-1)+':'+sort,'上一页',[]));
    if(page<totalPages)actions.push(action('browse:comments:'+slug+':'+(page+1)+':'+sort,'下一页',[]));
    return {isSupported:true,title:'书评与回复',sections:sections,actions:actions,links:links,message:'第 '+page+' / '+totalPages+' 页 · '+(pages.length?pages[0][0]:rows.length)+' 条书评'};
  }
  function perform(kind, payload) {
    payload = payload || {};
    if (kind.indexOf('browse:comments:') === 0) {
      var route = kind.slice(7).split(':');
      return commentsTool(route[1],route[2],payload.sort || route[3]);
    }
    if (kind.indexOf('comment:') === 0) {
      var args=kind.split(':'), d=detail(bookRef(args[1]));
      if(!(Number(variable(d.html,'uin'))>0))throw new Error(errors.e401);
      var state=commentsTool(args[1],args[3],args[4]);
      if(!state.actions.some(function(a){return a.id===kind;}))throw new Error('这条评论当前不允许此操作，请刷新');
      if(!/^\d+$/.test(args[2]))throw new Error('无效评论编号');
      if(args[5]==='reply'){
        if(str(payload.body).trim().length<3)throw new Error('回复至少三个字');
        request('/book_comm_reply.php?c='+args[2]+'&r='+encodeURIComponent(payload.body));
      }else if(args[5]==='like'){
        var entry=state.actions.filter(function(a){return a.id===kind;})[0];
        request('/book_comm_like.php?b='+d.manga.info.bookID+'&c='+args[2]+'&l='+(entry.title.indexOf('取消')===0?'0':'1'));
      }else if(args[5]==='delete')request('/book_comm_del.php?c='+args[2]);
      else throw new Error('不支持此评论操作');
      return commentsTool(args[1],args[3],args[4]);
    }
    if (kind.indexOf('profile:') === 0) {
      var current = tool('profile'), allowed = current.actions.filter(function(a){return a.id === kind;})[0];
      if (!allowed) throw new Error('官网当前不支持此设置');
      var f = allowed.fields[0], value = str(payload[f.id]);
      if (f.options && !f.options.some(function(o){return o.id === value;})) throw new Error('无效设置值');
      if (kind === 'profile:nickname') { if (!value.trim()) throw new Error('昵称不能为空'); request('/my_do.php', {nickname:value}); }
      else if (kind === 'profile:ignore') request('/my_ignorecate.php?t=1&v='+encodeURIComponent(value));
      else request('/my_set.php?t='+kind.split(':')[2]+'&v='+encodeURIComponent(value));
      var refreshed = tool('profile');
      var readback = refreshed.actions.filter(function(a){return a.id===kind;})[0];
      if (!readback || readback.fields[0].value !== value) throw new Error('官网回读与提交值不同，请检查官网状态');
      refreshed.message = '已保存并从官网核对'; return refreshed;
    }
    var parts = kind.split(':');
    if (parts[0] !== 'book' || parts.length !== 3) throw new Error('未知操作');
    var manga = bookRef(parts[1]), d = detail(manga), id = d.manga.info.bookID, op = parts[2];
    if (!(Number(variable(d.html,'uin')) > 0)) throw new Error(errors.e401);
    if (op === 'favorite' || op === 'follow') {
      if (payload.value !== '0' && payload.value !== '1') throw new Error('无效状态');
      var target = op === 'favorite' ? '0' : payload.target;
      if (['0','1','9'].indexOf(target) < 0) throw new Error('无效订阅目标');
      request('/book_follow.php',{follow_bookid:id,follow_type:target,follow_act:payload.value});
    } else if (op === 'rating' || op === 'read') {
      if (op === 'rating' && !/^[1-5]$/.test(payload.score)) throw new Error('评分需为 1 至 5 星');
      if (op === 'read' && !/^[01]$/.test(payload.value)) throw new Error('无效已读状态');
      request('/book_score.php?b='+id+'&s='+(op==='rating'?payload.score:'0')+'&t='+(op==='read'?payload.value:'-1'));
    } else if (op === 'review') {
      if (str(payload.body).trim().length < 20 || !/^[1-5]$/.test(payload.score)) throw new Error('请填写至少二十个字的书评并选择评分');
      request('/book_comm_do.php',{bookid:id,comm_content:payload.body,comm_spoiler:payload.spoiler==='1'?'1':'0',book_score:payload.score});
    } else if (op === 'category') {
      var fields = {bookid:id};
      [1,2,3].forEach(function(n){var key='tag_cate_'+n,value=str(payload[key]);if(value && categories.indexOf(value)<0)throw new Error('无效分类');fields[key]=value;});
      request('/tag_cate_do.php',fields);
    } else if (op === 'push') {
      var available = bookTool(parts[1], true).actions.filter(function(a){return a.id===kind;})[0];
      if (!available || !available.fields.every(function(f){return f.options.some(function(o){return o.id===payload[f.id];});})) throw new Error('官网当前没有此卷或绑定目标');
      request('/book_push.php',{push_bookid:id,push_vol_list:payload.volume,pushto:payload.target});
    } else throw new Error('未开放的官网操作');
    // A successful write must not be reported as a failed write because an
    // unrelated volume request or subsequent readback failed. Never resend it.
    try {
      var result = op === 'category' ? tool('category:' + parts[1]) : bookTool(parts[1]);
      result.message = '已提交官网并重新读取作品状态'; return result;
    } catch (error) {
      return { isSupported: true, title: '已提交，状态待刷新', sections: [], actions: [], links: [{ id: 'book', title: '在官网核对作品状态', url: manga.url }], message: '官网已收到操作，但状态刷新失败：' + str(error.message || error) + '。请刷新状态，无需重复提交。' };
    }
  }
  function favorite(manga) {
    var h = detail(manga).html;
    if (!(Number(variable(h, 'uin')) > 0)) return { isSupported: true, isFavorited: false, categories: [], category: 0, message: '登录后可同步官网收藏' };
    return { isSupported: true, isFavorited: variable(h, 'can_do_fav') === '0', categories: [], category: 0 };
  }
  function follow(manga, type, on) {
    var d = detail(manga);
    if (!(Number(variable(d.html, 'uin')) > 0)) throw new Error(errors.e401);
    request('/book_follow.php', { follow_bookid: d.manga.info.bookID, follow_type: type, follow_act: on ? '1' : '0' });
    return favorite(manga);
  }
  function ratingState(manga) {
    var d = detail(manga), node = parseHTML(d.html, BASE).selectFirst('.book_score');
    var value = node ? node.text().replace(/\s+/g, ' ') : '';
    return { isSupported: true, average: d.manga.info.rating || null, count: d.manga.info.ratingCount || null, userRating: Number(variable(d.html, 'my_score')) || null, message: '评分与评价人数来自 Kmoe 官网' };
  }
  function setRating(manga, rating) {
    var d = detail(manga), value = Math.round(Number(rating));
    if (!(Number(variable(d.html, 'uin')) > 0)) throw new Error(errors.e401);
    if (value < 1 || value > 5) throw new Error('评分需为 1 至 5 星');
    request('/book_score.php?b=' + d.manga.info.bookID + '&s=' + value + '&t=-1');
    var result = ratingState(manga); result.userRating = value; result.message = '评分已提交官网并重新读取'; return result;
  }
  function submitComment(manga, body) {
    var d = detail(manga), value = str(body).trim();
    if (!(Number(variable(d.html, 'uin')) > 0)) throw new Error(errors.e401);
    if (value.length < 20) throw new Error('Kmoe 书评至少需要二十个字；评分与剧透设置可在“官网功能”中选择');
    request('/book_comm_do.php', {bookid:d.manga.info.bookID,comm_content:value,comm_spoiler:'0',book_score:'5'});
    return {isSupported:true,didSubmit:true,message:'书评已发布到 Kmoe 官网',comments:commentsPage(manga,1,'latest').comments};
  }
  globalThis.__source = {
    getPopular: function (p) { return listing(p, '', []); },
    getLatest: function (p) { return listing(p, '', []); },
    search: listing,
    getFilterList: function () { return definitions.map(function (d) { return { key: d[0], name: d[1], kind: d[0] === 'sort' ? 'sort' : 'select', values: d[2], defaultValue: '0', scope: 'always' }; }); },
    getHome: function () { var items = listing(1, '', []).items; return { heroes: [], popular: items, toplist: [], editor: [], rising: [], hotCategories: [] }; },
    getMangaDetails: function (m) { return detail(m).manga; },
    getChapterList: function () { return []; },
    getPageList: function () { throw new Error('Kmoe 提供整卷文件，请下载 EPUB 后离线阅读'); },
    getArchiveOptions: archiveOptions,
    requestArchive: archive,
    getAccountOverview: overview,
    getAccountToolState: tool,
    performAccountAction: perform,
    getComments: function(m) { return commentsPage(m,1).comments; },
    getCommentsPage: commentsPage,
    submitComment: submitComment,
    submitCommentAdvanced: function(m, body, spoiler, parentID) {
      var d = detail(m), value = str(body).trim();
      if (!(Number(variable(d.html, 'uin')) > 0)) throw new Error(errors.e401);
      if (parentID) {
        if (!/^\d+$/.test(parentID) || value.length < 3) throw new Error('回复至少三个字');
        request('/book_comm_reply.php?c=' + parentID + '&r=' + encodeURIComponent(value));
        return {isSupported:true,didSubmit:true,message:'回复已发布到 Kmoe 官网',comments:commentsPage(m,1,'hot').comments};
      }
      if (value.length < 20) throw new Error('Kmoe 书评至少需要二十个字');
      request('/book_comm_do.php', {bookid:d.manga.info.bookID,comm_content:value,comm_spoiler:spoiler?'1':'0',book_score:'5'});
      return {isSupported:true,didSubmit:true,message:'书评已发布到 Kmoe 官网',comments:commentsPage(m,1,'latest').comments};
    },
    getFavoriteState: favorite,
    setFavorite: function (m) { return follow(m, 0, true); },
    removeFavorite: function (m) { return follow(m, 0, false); },
    getRatingState: ratingState,
    setRating: setRating,
    getFavorites: function (p) { var body = request('/myfollow.php'); return { items: p <= 1 ? cards(body) : [], hasNextPage: false }; }
  };
})();
