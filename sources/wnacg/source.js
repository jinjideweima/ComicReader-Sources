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

  function formEncode(fields) {
    return Object.keys(fields || {}).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(fields[key] == null ? '' : fields[key]));
    }).join('&');
  }

  function formValues(form) {
    var values = {};
    if (!form) return values;
    form.select('input[name]').forEach(function (input) {
      var type = String(input.attr('type') || 'text').toLowerCase();
      var name = trim(input.attr('name'));
      if (!name || type === 'button' || type === 'submit' || type === 'file') return;
      values[name] = input.attr('value') || '';
    });
    return values;
  }

  // Account traffic intentionally stays on the canonical host. Authentication
  // cookies belong to wnacg.com and must never be replayed to a mirror.
  function accountRequest(path, options) {
    var base = SITES[0].base;
    var settings = options || {};
    var requestHeaders = headers(base);
    Object.keys(settings.headers || {}).forEach(function (key) { requestHeaders[key] = settings.headers[key]; });
    var response = fetch(base + pathOnly(path), {
      method: settings.method || 'GET',
      headers: requestHeaders,
      body: settings.body,
      bodyBase64: settings.bodyBase64,
      cachePolicy: 'reloadIgnoringLocalCacheData',
      timeout: 25
    });
    var status = Number(response.status || 0);
    if (status >= 400 || !String(response.body || '').trim()) throw new Error('HTTP ' + status);
    var result = { response: response, base: base, doc: parseHTML(response.body, base) };
    if (settings.requireLogin !== false && (
      result.doc.selectFirst('form[action*="users-check_login"]')
      || result.doc.selectFirst('input[name="login_name"]')
    )) {
      throw new Error('绅士漫画登录状态已失效，请重新登录');
    }
    return result;
  }

  function accountIdentity(doc) {
    if (!doc) return '';
    // The account pages contain several /users.html links ("关注更新", "我的空间"
    // and "关注推送").  Only the desktop header link carries the real username.
    var account = doc.selectFirst('.top_utab.ui > a[title][href="/users.html"]')
      || doc.selectFirst('a[title*="我的資料"][href="/users.html"]')
      || doc.selectFirst('a[title*="我的资料"][href="/users.html"]');
    var value = account ? trim(account.text()) : '';
    if (value && value !== '我的空间' && value !== '我的空間') return value;
    if (doc.selectFirst('form[action*="users-check_login"]') || doc.selectFirst('input[name="login_name"]')) return '';
    return value;
  }

  function metric(id, title, value) {
    return { id: String(id), title: String(title), value: trim(value) || '—' };
  }

  function section(id, title, metrics) {
    return { id: id, title: title, metrics: (metrics || []).filter(function (item) { return item && item.value; }) };
  }

  function officialLink(id, title, path) {
    return { id: id, title: title, url: SITES[0].base + pathOnly(path) };
  }

  function textMetricFromPage(doc, selectors, id, title) {
    for (var i = 0; i < selectors.length; i++) {
      var value = textOf(doc, selectors[i]);
      if (value) return metric(id, title, value);
    }
    return null;
  }

  function countFromText(text, patterns) {
    var source = trim(text);
    for (var i = 0; i < patterns.length; i++) {
      var match = source.match(patterns[i]);
      if (match) return match[1].replace(/,/g, '');
    }
    return '0';
  }

  function overviewState() {
    var result = accountRequest('/users.html');
    var username = accountIdentity(result.doc) || '绅士漫画用户';
    var avatar = result.doc.selectFirst('.user_pic img') || result.doc.selectFirst('.top_utab img');
    var metrics = [metric('username', '用户名', username)];
    try {
      var profile = accountRequest('/users-users_edit.html').doc;
      metrics.push(metric('nickname', '昵称', inputValue(profile, 'nicename')));
    } catch (_) {}
    if (avatar) metrics.push(metric('avatarURL', '头像', absoluteURL(avatar.attr('src') || avatar.attr('data-original'), result.base)));
    var exact = {};
    result.doc.select('.ui_box li').forEach(function (item) {
      var label = item.selectFirst('label');
      if (!label) return;
      var title = trim(label.text()).replace(/[：:]\s*$/, '');
      var value = trim(item.text()).replace(trim(label.text()), '').trim();
      if (title) exact[title] = value;
    });
    var profile = [
      metric('level', '会员等级', exact['會員等級'] || exact['会员等级']),
      metric('gender', '性别', exact['性別'] || exact['性别']),
      metric('currency', '秀吉', exact['秀吉']),
      metric('experience', '经验', exact['經驗'] || exact['经验'])
    ];
    var activity = [
      metric('works', '我的投稿', exact['我的投稿']),
      metric('following', '我的关注', exact['我的關注'] || exact['我的关注']),
      metric('followers', '我的粉丝', exact['我的粉絲'] || exact['我的粉丝']),
      metric('bookshelf', '我的书架', exact['我的書架'] || exact['我的书架'])
    ];
    return {
      isSupported: true,
      sections: [section('identity', '账号', metrics), section('profile', '会员信息', profile), section('activity', '账号内容', activity)],
      message: null
    };
  }

  function inputValue(doc, name) {
    var input = doc.selectFirst('input[name="' + name + '"]') || doc.selectFirst('textarea[name="' + name + '"]');
    if (!input) return '';
    return trim(input.attr('value') || input.text());
  }

  function currentGender(doc) {
    var selected = doc.selectFirst('.e_sex span.cur');
    return selected ? trim(selected.text()) : '';
  }

  function currentGenderValue(doc) {
    var label = currentGender(doc);
    return label === '女' ? '2' : (label === '秀吉' ? '3' : '1');
  }

  function profileState(message, overrides) {
    var result = accountRequest('/users-users_edit.html');
    var doc = result.doc;
    var pageText = trim(doc.text());
    var username = accountIdentity(doc) || '';
    var emailMatch = pageText.match(/Email[：:]?\s*([^\s*]+@[^\s*]+)/i);
    var values = overrides || {};
    return {
      isSupported: true,
      title: '我的资料',
      introduction: null,
      sections: [
        section('profile', '个人资料', [
          metric('username', '用户名', username),
          metric('nickname', '昵称', values.nickname != null ? values.nickname : inputValue(doc, 'nicename')),
          metric('gender', '性别', values.genderLabel != null ? values.genderLabel : currentGender(doc)),
          metric('birthday', '出生年月', values.birthday != null ? values.birthday : inputValue(doc, 'birthday')),
          metric('signature', '个性签名', values.signature != null ? values.signature : inputValue(doc, 'psign'))
        ]),
        section('security', '安全设置', [metric('email', 'Email', emailMatch ? emailMatch[1] : '')])
      ],
      links: [],
      message: message || null
    };
  }

  function avatarState(message) {
    var result = accountRequest('/users-userpic.html');
    var image = result.doc.selectFirst('#avatar') || result.doc.selectFirst('.user_pic img') || result.doc.selectFirst('img[src*="avatar"]');
    return {
      isSupported: true,
      title: '上传头像',
      introduction: null,
      sections: [section('avatar', '当前头像', [
        metric('avatarURL', '头像', image ? absoluteURL(image.attr('src') || image.attr('data-original'), result.base) : '')
      ])],
      links: [],
      message: message || null
    };
  }

  function blockLists(doc) {
    var uploaders = [];
    var tags = [];
    doc.select('script').forEach(function (script) {
      var source = script.text();
      var up = source.match(/var\s+uploaders\s*=\s*(\[[\s\S]*?\])\s*\|\|\s*\[\]/);
      var tg = source.match(/var\s+tags\s*=\s*(\[[\s\S]*?\])\s*\|\|\s*\[\]/);
      if (up) { try { uploaders = JSON.parse(up[1]); } catch (_) {} }
      if (tg) { try { tags = JSON.parse(tg[1]); } catch (_) {} }
    });
    return { uploaders: Array.isArray(uploaders) ? uploaders : [], tags: Array.isArray(tags) ? tags : [] };
  }

  function blockState(message, resolvedUploader, canonicalLists) {
    var lists = canonicalLists;
    if (!lists) {
      var result = accountRequest('/users-block.html');
      lists = blockLists(result.doc);
    }
    var sections = [section('limits', '屏蔽额度', [
      metric('uploaders-limit', '投稿者', String(lists.uploaders.length) + '/10'),
      metric('tags-limit', '标签', String(lists.tags.length) + '/20')
    ])];
    if (lists.uploaders.length) sections.push(section('uploaders', '已屏蔽投稿者', lists.uploaders.map(function (item) {
      return metric('uploader:' + item.uid, item.name || ('用户 ' + item.uid), String(item.uid));
    })));
    if (lists.tags.length) sections.push(section('tags', '已屏蔽标签', lists.tags.map(function (tag) {
      return metric('tag:' + encodeURIComponent(tag), tag, tag);
    })));
    if (resolvedUploader) sections.push(section('resolvedUploader', '检索结果', [
      metric('resolved:' + resolvedUploader.uid, resolvedUploader.name, String(resolvedUploader.uid))
    ]));
    return { isSupported: true, title: '内容屏蔽', introduction: null, sections: sections, links: [], message: message || null };
  }

  function listMetrics(doc, selector, prefix, limit) {
    var output = [];
    var seen = {};
    doc.select(selector).forEach(function (node) {
      if (output.length >= (limit || 30)) return;
      var anchor = node.selectFirst('a') || (String(node.attr('href') || '') ? node : null);
      var title = trim((anchor && (anchor.attr('title') || anchor.text())) || node.text());
      if (!title || title.length > 220 || seen[title]) return;
      seen[title] = true;
      var subtitle = textOf(node, '.info_col') || textOf(node, '.date') || textOf(node, '.time') || '官网记录';
      output.push(metric(prefix + ':' + output.length, title, subtitle));
    });
    return output;
  }

  function messageMetrics(doc, prefix, limit) {
    var output = [];
    var seen = {};
    doc.select('tr, .msg_list li, .sixin_list li, .notice_list li, .userlist li').forEach(function (node) {
      if (output.length >= (limit || 50)) return;
      var checkbox = node.selectFirst('input[name^="chkval"]');
      var rawID = checkbox ? trim(checkbox.attr('value')) : '';
      var action = node.selectFirst('a[href*="delmsg"], a[onclick*="delmsg"]');
      if (!rawID && action) {
        var actionText = String(action.attr('href') || '') + ' ' + String(action.attr('onclick') || '');
        var actionMatch = actionText.match(/[?&]id[=-](\d+)/i) || actionText.match(/(?:id-|id=)(\d+)/i);
        if (actionMatch) rawID = actionMatch[1];
      }
      if (!/^\d+$/.test(rawID) || seen[rawID]) return;
      var cells = node.select('td');
      var title = textOf(node, '.msg_con') || textOf(node, '.title') || textOf(node, '.content');
      if (!title && cells.length) title = trim(cells[0].text());
      title = title || trim(node.text()).replace(/\s+/g, ' ');
      var subtitle = textOf(node, '.time') || textOf(node, '.date');
      if (!subtitle && cells.length > 1) subtitle = trim(cells[cells.length - 2].text());
      seen[rawID] = true;
      output.push(metric(prefix + ':' + rawID, title || ('记录 ' + rawID), subtitle || '官网记录'));
    });
    return output;
  }

  function accountToolState(kind) {
    var requestedKind = String(kind || '');
    var worksPaths = {
      pending: '/users-albums-chk-0.html',
      approved: '/users-albums-chk-1.html',
      rejected: '/users-albums-chk-2.html'
    };
    var worksFilter = requestedKind.match(/^works\.(pending|approved|rejected)$/);
    if (worksFilter) kind = 'works';
    var definitions = {
      space: ['/users.html', '我的空间', '账号概况只读同步；涉及资料或内容变更时会进入官网确认。'],
      profile: ['/users-users_edit.html', '我的资料', null],
      avatar: ['/users-userpic.html', '上传头像', null],
      block: ['/users-block.html', '内容屏蔽', null],
      bookshelf: ['/users-users_fav.html', '我的书架', '书架列表、分类和详情页收藏由 App 与官网双向同步。'],
      messages: ['/users-users_sixin.html', '私信管理', '同步我的私信和系统通知，并支持发送私信与删除所选记录。'],
      notifications: ['/users-users_notify.html', '评论通知', '评论通知只读同步，不会自动标记已读。'],
      works: ['/users-albums.html', '作品管理', '作品及审核状态只读同步；上传、编辑和删除保留在官网确认。'],
      following: ['/users.html', '关注推送', '只读显示官网个人空间中的关注推送，不会自动标记已读。'],
      followingList: ['/users-users_guanz.html', '我的关注', '只读显示关注列表。'],
      followers: ['/users-users_fensi.html', '我的粉丝', '只读显示粉丝列表。']
    };
    var definition = definitions[kind];
    if (!definition) return { isSupported: false, title: '暂未开放', introduction: null, sections: [], links: [], message: '未知账号模块' };
    if (kind === 'space') {
      var overview = overviewState();
      return { isSupported: true, title: definition[1], introduction: definition[2], sections: overview.sections, links: [officialLink('official-space', '打开官网我的空间', definition[0])], message: overview.message };
    }
    if (kind === 'profile') return profileState();
    if (kind === 'avatar') return avatarState();
    if (kind === 'block') return blockState();
    var targetPath = worksFilter ? worksPaths[worksFilter[1]] : definition[0];
    var result = accountRequest(targetPath);
    var doc = result.doc;
    var pageText = trim(doc.text());
    var sections = [];
    var links = [officialLink('official-' + kind, '打开官网' + definition[1], definition[0])];
    if (kind === 'bookshelf') {
      var categories = favoriteCategories(doc);
      sections.push(section('bookshelf', '书架', [
        metric('count', '容量', countFromText(pageText, [/([0-9,]+\s*\/\s*5000)/i])),
        metric('categories', '分类', String(Math.max(0, categories.length - 1)))
      ]));
      var records = favoriteCategoryRecords();
      sections.push(section('categories', '书架分类', records.map(function (record) {
        return metric('category:' + record.id, record.name, record.createdAt || '—');
      })));
      links.push(officialLink('official-favorite-categories', '管理官网书架分类', '/?ctl=users&act=favclass'));
    } else if (kind === 'messages') {
      var inbox = messageMetrics(doc, 'message', 50);
      var systemDoc = accountRequest('/users-users_sysnotice.html').doc;
      var notices = messageMetrics(systemDoc, 'system', 50);
      sections.push(section('summary', '私信容量', [metric('capacity', '收件箱', countFromText(pageText, [/([0-9,]+\s*\/\s*50)/i]))]));
      if (inbox.length) sections.push(section('messages', '我的私信', inbox));
      if (notices.length) sections.push(section('system', '系统通知', notices));
      links.push(officialLink('official-system-notices', '打开官网系统通知', '/users-users_sysnotice.html'));
      links.push(officialLink('official-send-message', '打开官网发送私信', '/users-users_sxsend.html'));
    } else if (kind === 'notifications') {
      var notifications = listMetrics(doc, '.notify_list li, .comment_list li, .userlist li, table tr', 'notification', 40);
      sections.push(section('notifications', '评论通知', notifications));
    } else if (kind === 'works') {
      var works = parseCards(doc, result.base, 40);
      var workMetrics = works.map(function (manga, index) { return metric('work:' + index, manga.title, manga.info && manga.info.updatedAt ? manga.info.updatedAt : '官网作品'); });
      sections.push(section('status', '审核状态', [
        metric('all', '全部', countFromText(pageText, [/全部[^0-9]{0,8}([0-9,]+)/i])),
        metric('pending', '未审核', countFromText(pageText, [/未審核[^0-9]{0,8}([0-9,]+)/i, /未审核[^0-9]{0,8}([0-9,]+)/i])),
        metric('approved', '已审核', countFromText(pageText, [/已審核[^0-9]{0,8}([0-9,]+)/i, /已审核[^0-9]{0,8}([0-9,]+)/i])),
        metric('rejected', '未通过', countFromText(pageText, [/未通過[^0-9]{0,8}([0-9,]+)/i, /未通过[^0-9]{0,8}([0-9,]+)/i]))
      ]));
      if (workMetrics.length) sections.push(section('works', '最近作品', workMetrics));
      links.push({ id: 'submission-guide', title: '投稿必看', url: 'https://wnbbs.cc/thread-1-1-1.html' });
    } else {
      var social = listMetrics(doc, '.user_list li, .userlist li, .notice_list li, .follow_list li, table tr', kind, 40);
      sections.push(section(kind, definition[1], social));
    }
    var hasContent = sections.some(function (value) { return value.metrics.length; });
    return { isSupported: true, title: definition[1], introduction: definition[2], sections: sections, links: links, message: hasContent ? null : '官网当前没有相关记录' };
  }

  function parseJSONResponse(response) {
    try { return JSON.parse(String(response && response.body || '{}')); }
    catch (_) { return {}; }
  }

  function responseFailure(json) {
    if (!json || !Object.keys(json).length) return '';
    if (json.ok === false || json.success === false || json.status === false || json.ret === false) {
      return trim(json.msg || json.message || json.error) || '官网拒绝了本次操作';
    }
    if (typeof json.code === 'number' && json.code < 0) {
      return trim(json.msg || json.message || json.error) || '官网拒绝了本次操作';
    }
    return '';
  }

  function profileForm() {
    var result = accountRequest('/users-users_edit.html');
    var form = result.doc.selectFirst('form[action*="users-save_useredit"]');
    if (!form) throw new Error('官网没有返回资料保存表单');
    return { result: result, action: pathOnly(form.attr('action')), doc: result.doc };
  }

  function updateProfile(payload) {
    var nickname = trim(payload.nickname);
    var birthday = trim(payload.birthday);
    var signature = trim(payload.signature);
    var gender = String(payload.gender || '1');
    if (!nickname) throw new Error('昵称不能为空');
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new Error('出生年月需要使用 YYYY-MM-DD 格式');
    if (['1', '2', '3'].indexOf(gender) < 0) throw new Error('性别选项无效');
    var current = profileForm();
    var result = accountRequest(current.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/users-users_edit.html' },
      body: formEncode({ nicename: nickname, u_sex: gender, birthday: birthday, psign: signature, opass: '', npass: '', rpass: '' }),
      requireLogin: false
    });
    var json = parseJSONResponse(result.response);
    var failure = responseFailure(json);
    if (failure) throw new Error(failure);

    // The official page treats the POST response as authoritative. A following
    // GET can briefly return the old profile through an edge cache, so never turn
    // an accepted write into a false error merely because every field is not yet
    // byte-for-byte identical on an immediate readback.
    var genderLabels = { '1': '男', '2': '女', '3': '秀吉' };
    return profileState('个人资料已同步到官网', {
      nickname: nickname,
      genderLabel: genderLabels[gender],
      birthday: birthday,
      signature: signature
    });
  }

  function resolveBlockedUploader(payload) {
    var name = trim(payload.name);
    if (!name) throw new Error('请输入投稿者昵称');
    var result = accountRequest('/?ctl=users&act=block_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base },
      body: formEncode({ name: name }),
      requireLogin: false
    });
    var json = parseJSONResponse(result.response);
    if (!json.ok || !json.uid) throw new Error(json.msg || '没有找到这个投稿者');
    return blockState(null, { uid: json.uid, name: json.name || name });
  }

  function saveBlocks(payload) {
    var uploaders;
    var tags;
    try { uploaders = JSON.parse(String(payload.uploaders || '[]')); } catch (_) { throw new Error('投稿者屏蔽列表格式无效'); }
    try { tags = JSON.parse(String(payload.tags || '[]')); } catch (_) { throw new Error('标签屏蔽列表格式无效'); }
    if (!Array.isArray(uploaders) || uploaders.length > 10) throw new Error('最多屏蔽 10 个投稿者');
    if (!Array.isArray(tags) || tags.length > 20) throw new Error('最多屏蔽 20 个标签');
    uploaders = uploaders.map(function (item) { return { uid: Number(item.uid), name: trim(item.name) }; })
      .filter(function (item) { return isFinite(item.uid) && item.uid > 0 && item.name; });
    tags = tags.map(trim).filter(function (tag, index, all) { return tag && all.indexOf(tag) === index; });
    var result = accountRequest('/?ctl=users&act=block_save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base },
      body: formEncode({ uploaders: JSON.stringify(uploaders), tags: JSON.stringify(tags) }),
      requireLogin: false
    });
    var json = parseJSONResponse(result.response);
    if (!json.ok) throw new Error(json.msg || '官网没有保存屏蔽设置');
    // Match the official client: the save response may return canonicalized
    // names/tags and is the source of truth. Immediate page readback is allowed
    // to lag and must not convert an accepted save into an error.
    var canonical = {
      uploaders: Array.isArray(json.uploaders) ? json.uploaders : uploaders,
      tags: Array.isArray(json.tags) ? json.tags : tags
    };
    return blockState('内容屏蔽已同步到官网', null, canonical);
  }

  function createFavoriteCategory(payload) {
    var name = trim(payload.name);
    if (!name) throw new Error('书架分类名称不能为空');
    if (name.length > 40) throw new Error('书架分类名称不能超过 40 个字符');
    var formPage = accountRequest('/users-favclass_edit.html');
    var form = formPage.doc.selectFirst('form[action*="users-favc_save"]');
    if (!form) throw new Error('官网没有返回新增书架分类表单');
    accountRequest(pathOnly(form.attr('action')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/?ctl=users&act=favclass' },
      body: formEncode({ favc_name: name, submit: '保存' }),
      requireLogin: false
    });
    var categories = favoriteCategories(accountRequest('/users-users_fav.html').doc);
    if (!categories.some(function (category) { return category.id > 0 && category.name === name; })) {
      throw new Error('官网没有确认新增书架分类');
    }
    return accountToolState('bookshelf');
  }

  function favoriteCategoryRecords() {
    var result = accountRequest('/?ctl=users&act=favclass');
    var records = [];
    result.doc.select('table.datalist tbody tr, table.datalist tr').forEach(function (row) {
      var cells = row.select('td');
      if (cells.length < 3) return;
      var id = Number(trim(cells[0].text()));
      var name = trim(cells[1].text());
      if (!isFinite(id) || id <= 0 || !name) return;
      records.push({ id: id, name: name, createdAt: trim(cells[2].text()) });
    });
    return records;
  }

  function favoriteCategoryEditForm(id) {
    var numericID = Number(id);
    if (!isFinite(numericID) || numericID <= 0) throw new Error('书架分类 ID 无效');
    var path = '/users-favclass_edit-id-' + Math.floor(numericID) + '.html';
    var result = accountRequest(path);
    var form = result.doc.selectFirst('form[action*="users-favc_save"]');
    if (!form) throw new Error('官网没有返回书架分类编辑表单');
    return { path: path, action: pathOnly(form.attr('action')) };
  }

  function updateFavoriteCategory(payload) {
    var id = Number(payload.id);
    var name = trim(payload.name);
    if (!isFinite(id) || id <= 0) throw new Error('书架分类 ID 无效');
    if (!name) throw new Error('书架分类名称不能为空');
    if (name.length > 40) throw new Error('书架分类名称不能超过 40 个字符');
    var form = favoriteCategoryEditForm(id);
    accountRequest(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + form.path },
      body: formEncode({ favc_name: name, submit: '保存' }),
      requireLogin: false
    });
    if (!favoriteCategoryRecords().some(function (record) { return record.id === id && record.name === name; })) {
      throw new Error('官网没有确认书架分类修改');
    }
    return accountToolState('bookshelf');
  }

  function deleteFavoriteCategory(payload) {
    var id = Number(payload.id);
    if (!isFinite(id) || id <= 0) throw new Error('书架分类 ID 无效');
    var path = '/users-favclass_del-id-' + Math.floor(id) + '.html';
    var result = accountRequest(path, { requireLogin: false });
    var form = result.doc.selectFirst('form');
    if (form) {
      var deleteFields = formValues(form);
      deleteFields.submit = '删除';
      accountRequest(pathOnly(form.attr('action') || path), {
        method: String(form.attr('method') || 'POST').toUpperCase(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/?ctl=users&act=favclass' },
        body: formEncode(deleteFields),
        requireLogin: false
      });
    }
    if (favoriteCategoryRecords().some(function (record) { return record.id === id; })) {
      throw new Error('官网没有删除该书架分类；请先确认分类内没有收藏');
    }
    return accountToolState('bookshelf');
  }

  function sendPrivateMessage(payload) {
    var recipient = trim(payload.recipient);
    var content = trim(payload.content);
    if (!recipient) throw new Error('请输入收件人');
    if (!content) throw new Error('请输入私信内容');
    var result = accountRequest('/users-dosxsend.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/users-users_sxsend.html' },
      body: formEncode({ touser: recipient, tosay: content }),
      requireLogin: false
    });
    var json = parseJSONResponse(result.response);
    var text = trim(result.doc.text());
    if (json.ret === false || json.ok === false || /(?:失敗|失败|不存在|不能|錯誤|错误)/.test(json.html || json.msg || text)) {
      throw new Error(json.html || json.msg || '官网没有发送这条私信');
    }
    var state = accountToolState('messages');
    state.message = '私信已发送';
    return state;
  }

  function deleteAccountMessages(payload) {
    var ids = String(payload.ids || '').split(',').map(function (value) { return trim(value); })
      .filter(function (value, index, all) { return /^\d+$/.test(value) && all.indexOf(value) === index; });
    if (!ids.length) throw new Error('请选择要删除的记录');
    var path = '/users-delmsg.html&id=' + ids.join(',');
    var result = accountRequest(path, { requireLogin: false });
    var form = result.doc.selectFirst('form');
    if (form) {
      var messageDeleteFields = formValues(form);
      messageDeleteFields.submit = '删除';
      accountRequest(pathOnly(form.attr('action') || path), {
        method: String(form.attr('method') || 'POST').toUpperCase(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/users-users_sysnotice.html' },
        body: formEncode(messageDeleteFields),
        requireLogin: false
      });
    }
    var state = accountToolState('messages');
    var remaining = state.sections.filter(function (value) { return value.id === 'messages' || value.id === 'system'; })
      .reduce(function (all, value) { return all.concat(value.metrics || []); }, [])
      .map(function (item) { return String(item.id || '').split(':').pop(); });
    if (ids.some(function (id) { return remaining.indexOf(id) >= 0; })) {
      throw new Error('官网没有删除全部所选记录，请刷新后重试');
    }
    state.message = '所选记录已删除';
    return state;
  }

  function uploadAvatar(payload) {
    var boundary = String(payload.boundary || '');
    var bodyBase64 = String(payload.bodyBase64 || '');
    if (!/^ComicReader[A-Za-z0-9-]{8,80}$/.test(boundary) || !bodyBase64) throw new Error('头像文件格式无效');
    if (bodyBase64.length > 4 * 1024 * 1024) throw new Error('头像文件过大');
    var response = accountRequest('/users-saveavatar.html', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/users-userpic.html' },
      bodyBase64: bodyBase64,
      requireLogin: false
    });
    var json = parseJSONResponse(response.response);
    if (!json.ok) throw new Error(json.msg || '官网没有保存头像');
    return avatarState('头像已同步到官网');
  }

  function performAccountAction(kind, payload) {
    var action = String(kind || '');
    var values = payload || {};
    if (action === 'profile.update') return updateProfile(values);
    if (action === 'block.resolveUploader') return resolveBlockedUploader(values);
    if (action === 'block.save') return saveBlocks(values);
    if (action === 'favoriteCategory.create') return createFavoriteCategory(values);
    if (action === 'favoriteCategory.update') return updateFavoriteCategory(values);
    if (action === 'favoriteCategory.delete') return deleteFavoriteCategory(values);
    if (action === 'message.send') return sendPrivateMessage(values);
    if (action === 'message.delete') return deleteAccountMessages(values);
    if (action === 'avatar.upload') return uploadAvatar(values);
    if (action === 'comment.vote') return voteComment(values);
    throw new Error('不支持的账号操作');
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

  function favoriteCategories(doc) {
    var categories = [{ id: 0, name: '全部', count: null }];
    var seen = { 0: true };
    doc.select('a[href*="users-users_fav-c-"]').forEach(function (anchor) {
      var href = anchor.attr('href') || anchor.attr('abs:href') || '';
      var match = href.match(/users-users_fav-c-(\d+)/i);
      if (!match) return;
      var id = Number(match[1]);
      if (!isFinite(id) || seen[id]) return;
      var raw = trim(anchor.text());
      var countMatch = raw.match(/\(([0-9,]+)\)\s*$/);
      var name = trim(raw.replace(/\s*\([0-9,]+\)\s*$/, '')) || ('分类 ' + id);
      seen[id] = true;
      categories.push({ id: id, name: name, count: countMatch ? Number(countMatch[1].replace(/,/g, '')) : null });
    });
    return categories;
  }

  function favoritePagePath(page, category) {
    var p = Math.max(1, Number(page || 1));
    var id = Number(category || 0);
    var path = '/users-users_fav';
    if (p > 1) path += '-page-' + p;
    if (isFinite(id) && id > 0) path += '-c-' + Math.floor(id);
    return path + '.html';
  }

  function favoriteMetadata(categories) {
    var metadata = {};
    var ids = [];
    (categories || []).forEach(function (category) {
      ids.push(String(category.id));
      metadata['favoriteCategoryName' + category.id] = category.name;
      if (category.count !== null && category.count !== undefined) metadata['favoriteCategoryCount' + category.id] = String(category.count);
    });
    metadata.favoriteCategoryIDs = ids.join(',');
    return metadata;
  }

  function favoriteListing(page, category, query) {
    var result = accountRequest(favoritePagePath(page, category));
    var categories = favoriteCategories(result.doc);
    var items = parseFavoriteCards(result.doc, result.base);
    var needle = trim(query).toLowerCase();
    if (needle) items = items.filter(function (manga) { return String(manga.title || '').toLowerCase().indexOf(needle) >= 0; });
    return {
      items: items,
      hasNextPage: hasNextPage(result.doc),
      metadata: favoriteMetadata(categories)
    };
  }

  function favoriteActionPath(node) {
    if (!node) return '';
    var candidates = node.select('a');
    for (var i = 0; i < candidates.length; i++) {
      var anchor = candidates[i];
      var href = String(anchor.attr('href') || '');
      var onclick = String(anchor.attr('onclick') || '');
      var raw = href;
      var match = onclick.match(/Mui\.box\.show\(['"]([^'"]+)/i);
      if (match) raw = match[1];
      if (/users-(?:fav[^/]*(?:del|remove)|[^/]*(?:del|remove)[^/]*fav)/i.test(raw)) return pathOnly(raw);
    }
    return '';
  }

  function mangaFromFavoriteCard(card, base) {
    var anchor = card.selectFirst('.l_title a[href*="aid-"]');
    if (!anchor) return null;
    var href = anchor.attr('href') || anchor.attr('abs:href') || '';
    var id = albumID(href);
    var title = trim(anchor.attr('title') || anchor.text());
    if (!id || !title) return null;
    var image = card.selectFirst('.thumb img') || card.selectFirst('img');
    var details = textOf(card, '.l_detla');
    var pages = details.match(/(?:頁數|页数)[：:]?\s*([0-9,]+)/i);
    var categoryAnchor = card.selectFirst('.l_catg a[href*="users-users_fav-c-"]');
    var categoryMatch = categoryAnchor ? String(categoryAnchor.attr('href') || '').match(/-c-(\d+)/i) : null;
    var info = {};
    if (pages) info.pages = pages[1].replace(/,/g, '');
    if (categoryAnchor) info.category = trim(categoryAnchor.text());
    if (categoryMatch) info.favoriteCategoryID = categoryMatch[1];
    return {
      id: id,
      url: pathOnly(href),
      title: title,
      coverURL: image ? absoluteURL(image.attr('data-original') || image.attr('data-src') || image.attr('src'), base) : null,
      author: null,
      genres: [],
      status: 'completed',
      info: info
    };
  }

  function parseFavoriteCards(doc, base) {
    var output = [];
    var seen = {};
    doc.select('.asTB').forEach(function (card) {
      var manga = mangaFromFavoriteCard(card, base);
      if (!manga || seen[manga.id]) return;
      seen[manga.id] = true;
      output.push(manga);
    });
    return output;
  }

  function locateFavorite(manga, preferredCategory) {
    var target = albumID(manga.id || manga.url);
    var first = accountRequest(favoritePagePath(1, preferredCategory));
    var categories = favoriteCategories(first.doc);
    var ordered = [];
    if (Number(preferredCategory || 0) > 0) ordered.push(Number(preferredCategory));
    ordered.push(0);
    categories.forEach(function (category) { if (category.id > 0 && ordered.indexOf(category.id) < 0) ordered.push(category.id); });
    for (var ci = 0; ci < ordered.length; ci++) {
      var category = ordered[ci];
      for (var page = 1; page <= 3; page++) {
        var result = (ci === 0 && page === 1 && category === Number(preferredCategory || 0))
          ? first
          : accountRequest(favoritePagePath(page, category));
        var cards = result.doc.select('.asTB');
        for (var i = 0; i < cards.length; i++) {
          var parsed = mangaFromFavoriteCard(cards[i], result.base);
          if (parsed && parsed.id === target) {
            var cardCategory = parsed.info && Number(parsed.info.favoriteCategoryID);
            return { found: true, category: cardCategory || category, categories: categories, actionPath: favoriteActionPath(cards[i]) };
          }
        }
        if (!hasNextPage(result.doc)) break;
      }
    }
    return { found: false, category: null, categories: categories, actionPath: '' };
  }

  function favoriteState(manga) {
    var location = locateFavorite(manga, 0);
    return {
      isSupported: true,
      isFavorited: location.found,
      category: location.found ? location.category : null,
      categories: location.categories,
      note: null,
      message: location.found ? null : '尚未加入官网书架'
    };
  }

  function setFavorite(manga, category) {
    var id = albumID(manga.id || manga.url);
    var selected = Number(category || 0);
    var form = accountRequest('/users-addfav-id-' + id + '.html');
    var categories = favoriteCategories(accountRequest('/users-users_fav.html').doc);
    var optionIDs = [];
    form.doc.select('select[name="favc_id"] option').forEach(function (option) {
      var value = Number(option.attr('value'));
      if (isFinite(value)) optionIDs.push(value);
    });
    if (!optionIDs.length) {
      return { isSupported: true, isFavorited: false, category: null, categories: categories, note: null, message: '请先在官网建立至少一个书架分类' };
    }
    if (optionIDs.indexOf(selected) < 0) selected = optionIDs[0];
    accountRequest('/users-save_fav-id-' + id + '.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base },
      body: formEncode({ favc_id: selected }),
      requireLogin: false
    });
    var verified = locateFavorite(manga, selected);
    if (!verified.found) throw new Error('官网没有确认收藏成功，请稍后重试');
    return { isSupported: true, isFavorited: true, category: verified.category, categories: verified.categories, note: null, message: '已同步到绅士漫画书架' };
  }

  function removeFavorite(manga) {
    var location = locateFavorite(manga, 0);
    if (!location.found) {
      return { isSupported: true, isFavorited: false, category: null, categories: location.categories, note: null, message: '作品已不在官网书架中' };
    }
    if (!location.actionPath) throw new Error('官网没有返回安全的移除入口，请在官网书架中操作');
    // This official endpoint deletes immediately on navigation. Never probe it
    // while reading state; request it only after the user chose "移出书架".
    accountRequest(location.actionPath, { requireLogin: false });
    var verified = locateFavorite(manga, location.category || 0);
    if (verified.found) throw new Error('官网没有确认移除成功，请稍后重试');
    return { isSupported: true, isFavorited: false, category: null, categories: verified.categories, note: null, message: '已从绅士漫画书架移除' };
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

  function favoriteCountFromText(value) {
    // The official badge currently uses U+2764 followed by the emoji variation
    // selector U+FE0F ("❤️"). Strip the selector before matching so the parser
    // also accepts the plain text heart variants used by mirrors and older DOMs.
    var normalized = String(value || '').replace(/\uFE0F/g, ' ');
    var match = normalized.match(/[\u2764\u2665]\s*([0-9,]+)/)
      || normalized.match(/收藏[^0-9]*([0-9,]+)/);
    return match ? match[1].replace(/,/g, '') : '';
  }

  function favoriteCountFromCard(card) {
    var count = '';
    card.select('.pic_box div').forEach(function (node) {
      if (!count) count = favoriteCountFromText(node.text());
    });
    return count || favoriteCountFromText(card.text());
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
      var favoriteCount = favoriteCountFromCard(card);
      var rankMatch = raw.match(/^#?\s*(\d+)/);
      var rank = rankMatch ? rankMatch[1] : String((Number(page || 1) - 1) * 20 + index + 1);
      entries.push({
        id: String(period || 'week') + ':' + category + ':' + manga.id,
        rank: rank,
        score: favoriteCount ? favoriteCount + ' 收藏' : '',
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

  function commentReplyTarget(node) {
    var value = textOf(node, '.plReTo');
    var match = value.match(/回[覆复]\s*@?(.+?)(?:\s|$)/);
    return match ? trim(match[1]) : null;
  }

  function commentFromNode(node, base, rootID, fallbackIndex) {
    var commentID = trim(node.attr('data-id')) || ('comment-' + fallbackIndex);
    var body = textOf(node, '.plText');
    if (!body) return null;
    var classes = String(node.attr('class') || '');
    var isReply = classes.split(/\s+/).indexOf('plRe') >= 0;
    var avatar = node.selectFirst('img.plAv') || node.selectFirst('img.plReAv')
      || node.selectFirst('.plAv img') || node.selectFirst('.plReAv img');
    var up = node.selectFirst('.plUp');
    var down = node.selectFirst('.plDown');
    var likes = Number(textOf(node, '.plUp i') || 0);
    var dislikes = Number(textOf(node, '.plDown i') || 0);
    var userVote = up && String(up.attr('class') || '').split(/\s+/).indexOf('on') >= 0 ? 1
      : (down && String(down.attr('class') || '').split(/\s+/).indexOf('on') >= 0 ? -1 : 0);
    return {
      id: commentID,
      author: textOf(node, '.plName') || '匿名用户',
      dateText: textOf(node, '.plTime') || null,
      body: body,
      score: String(likes - dislikes),
      isUploader: false,
      avatarURL: avatar ? absoluteURL(avatar.attr('src'), base) : null,
      parentID: isReply ? rootID : null,
      isReply: isReply,
      likes: isFinite(likes) ? likes : 0,
      dislikes: isFinite(dislikes) ? dislikes : 0,
      userVote: userVote,
      replyToAuthor: isReply ? commentReplyTarget(node) : null,
      threadDepth: isReply ? 1 : 0
    };
  }

  function commentsPage(manga, page, sort) {
    var id = albumID(manga.id || manga.url);
    var currentPage = Math.max(1, Number(page || 1));
    var currentSort = String(sort || 'hot') === 'new' ? 'new' : 'hot';
    var result = request('/?ctl=comment&act=frag&aid=' + encodeURIComponent(id)
      + '&sort=' + currentSort + '&page=' + currentPage);
    var comments = [];
    var seen = {};
    var roots = result.doc.select('.plItem[data-id]');
    roots.forEach(function (root, rootIndex) {
      var rootID = trim(root.attr('data-id')) || ('root-' + rootIndex);
      var rootComment = commentFromNode(root, result.base, null, rootIndex);
      if (rootComment && !seen[rootComment.id]) {
        seen[rootComment.id] = true;
        comments.push(rootComment);
      }
      // The official fragment can contain both hot and full reply containers.
      // Keep one copy per server comment id and present every reply one level
      // below its root; replyToAuthor retains deeper reply semantics.
      root.select('.plRe[data-id]').forEach(function (reply, replyIndex) {
        var parsed = commentFromNode(reply, result.base, rootID, rootIndex + '-' + replyIndex);
        if (!parsed || seen[parsed.id]) return;
        seen[parsed.id] = true;
        comments.push(parsed);
      });
    });
    return { comments: comments, hasNextPage: roots.length >= 10, total: null };
  }

  function submitWNACGComment(manga, body, parentID) {
    var id = albumID(manga.id || manga.url);
    var content = trim(body);
    if (content.length < 2) throw new Error('评论至少需要 2 个字');
    var response = accountRequest('/?ctl=comment&act=post&aid=' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/comment-index-aid-' + id + '.html' },
      body: formEncode({ aid: id, pid: trim(parentID), content: content }),
      requireLogin: false
    });
    var json = parseJSONResponse(response.response);
    if (!json.ok) throw new Error(json.msg || '官网没有接受这条评论');
    var refreshed = commentsPage(manga, 1, 'new');
    return {
      isSupported: true,
      didSubmit: true,
      message: json.msg || (json.need_audit ? '评论已提交，正在等待审核' : '评论已发表'),
      comments: refreshed.comments
    };
  }

  function voteComment(payload) {
    var aid = albumID(payload.aid || '');
    var commentID = trim(payload.commentID || payload.plid);
    var value = Number(payload.value || payload.v);
    if (!aid || !/^\d+$/.test(commentID) || (value !== 1 && value !== -1)) throw new Error('评论操作参数无效');
    var response = accountRequest('/?ctl=comment&act=vote&aid=' + encodeURIComponent(aid), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': SITES[0].base, 'Referer': SITES[0].base + '/comment-index-aid-' + aid + '.html' },
      body: formEncode({ plid: commentID, v: value }),
      requireLogin: false
    });
    var json = parseJSONResponse(response.response);
    if (!json.ok) throw new Error(json.msg || '官网没有接受这次操作');
    return {
      isSupported: true,
      title: value > 0 ? '点赞' : '点踩',
      introduction: null,
      sections: [section('commentVote', '评论反馈', [
        metric('commentID', '评论', commentID),
        metric('likes', '点赞', String(Number(json.likes || 0))),
        metric('dislikes', '点踩', String(Number(json.dislikes || 0))),
        metric('userVote', '当前操作', String(value))
      ])],
      links: [],
      message: json.msg || null
    };
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

    getComments: function (manga) { return commentsPage(manga, 1, 'hot').comments; },
    getCommentsPage: function (manga, page, sort) { return commentsPage(manga, page, sort); },
    submitComment: function (manga, body) { return submitWNACGComment(manga, body, null); },
    submitCommentAdvanced: function (manga, body, spoiler, parentID) { return submitWNACGComment(manga, body, parentID); },

    getFavorites: function (page, category, query) { return favoriteListing(page, category, query); },
    getAccountOverview: function () { return overviewState(); },
    getAccountToolState: function (kind) { return accountToolState(String(kind || 'space')); },
    performAccountAction: function (kind, payload) { return performAccountAction(kind, payload || {}); },
    getFavoriteState: function (manga) { return favoriteState(manga); },
    setFavorite: function (manga, category) { return setFavorite(manga, category); },
    removeFavorite: function (manga) { return removeFavorite(manga); },

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
