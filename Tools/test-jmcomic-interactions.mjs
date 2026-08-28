import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sourceCode = fs.readFileSync(new URL("../sources/jmcomic/source.js", import.meta.url), "utf8");
const manga = { id: "123", url: "/album/123/", title: "Test", info: { contentKind: "comic" } };

function makeRuntime(initial = {}, behavior = {}) {
  const state = {
    favorited: false,
    liked: false,
    tracked: false,
    likeCount: 7,
    ...initial,
  };
  const posts = [];
  const gets = [];
  const storageValues = new Map();
  const clock = { now: 1_787_800_000_000 };
  storageValues.set("account_api_login_host", "www.cdngwc.net");
  storageValues.set("account_web_session_ready", "1");
  Object.entries(behavior.storage ?? {}).forEach(([key, value]) => {
    storageValues.set(key, String(value));
  });

  class RuntimeDate extends Date {
    static now() { return clock.now; }
  }

  function apiResponse(payload) {
    return {
      status: 200,
      body: JSON.stringify({ code: 200, data: JSON.stringify(payload) }),
      headers: {},
    };
  }

  function applyMutation(path) {
    if (path === "/favorite") state.favorited = !state.favorited;
    if (path === "/ajax/favorite_album") state.favorited = true;
    if (path === "/ajax/delete_favorite_album") state.favorited = false;
    if (path === "/like" && !state.liked) {
      state.liked = true;
      state.likeCount += 1;
    }
    if (path === "/ajax/vote_album" && !state.liked) {
      state.liked = true;
      state.likeCount += 1;
    }
    if (path === "/album_sertracking") state.tracked = !state.tracked;
  }

  const context = vm.createContext({
    console,
    Date: RuntimeDate,
    storage: {
      get(key) { return storageValues.get(key) ?? null; },
      set(key, value) { storageValues.set(key, String(value)); },
    },
    crypto: {
      md5(value) { return String(value); },
      aes256ECBDecryptBase64(encoded) { return String(encoded); },
    },
    sleep(milliseconds) { clock.now += Number(milliseconds) || 0; },
    parseHTML() {
      function icon(color) {
        return {
          attr(name) { return name === "style" ? `color: ${color};` : ""; },
          selectFirst() { return null; },
        };
      }
      function action(color) {
        return {
          attr() { return ""; },
          selectFirst(selector) { return selector === "i" ? icon(color) : null; },
        };
      }
      return {
        select() { return []; },
        selectFirst(selector) {
          if (selector === "#favorite_album_123") {
            return action(state.favorited ? "#ffc107" : "#000000");
          }
          if (selector === "#love_likes_123") {
            return action(state.liked ? "red" : "#ffc107");
          }
          return null;
        },
      };
    },
    fetch(url, options = {}) {
      const parsed = new URL(String(url));
      const method = String(options.method ?? "GET").toUpperCase();
      const hasBody = options.body !== undefined && options.body !== null;
      if (method === "GET" && !hasBody) {
        gets.push({ host: parsed.host, path: parsed.pathname + parsed.search });
        if (parsed.host === "18comic.vip") {
          const mode = behavior.websiteGet ?? "success";
          if (mode === "timeout") throw new Error("website timed out");
          if (mode === "auth-failure") return { status: 403, body: "", headers: {} };
          return { status: 200, body: "<html>album state</html>", headers: {} };
        }
        if (parsed.pathname === "/album") {
          return apiResponse({
            id: "123",
            is_favorite: state.favorited ? "1" : "0",
            liked: state.liked ? "1" : "0",
            likes: state.likeCount,
          });
        }
        if (parsed.pathname === "/album_sertracking") {
          return apiResponse({ is_tracking: state.tracked ? "1" : "0" });
        }
        if (parsed.pathname === "/favorite") {
          return apiResponse({
            total: 3,
            folder_list: [{ FID: "7", name: "私人", count: 2 }],
          });
        }
        if (parsed.pathname === "/setting") {
          return apiResponse({ jm3_version: behavior.settingVersion });
        }
        return apiResponse({});
      }

      const fields = Object.fromEntries(new URLSearchParams(String(options.body ?? "")));
      posts.push({ method, host: parsed.host, path: parsed.pathname, fields });
      const mode = behavior[parsed.pathname] ?? "success";
      if (mode === "auth-failure") return { status: 401, body: "", headers: {} };
      if (mode === "auth-failure-old-version"
          && String(options.headers?.tokenparam ?? "").endsWith(",2.1.4")) {
        return { status: 401, body: "", headers: {} };
      }
      if (!["no-effect-timeout", "failure", "success-no-effect"].includes(mode)) {
        applyMutation(parsed.pathname);
      }
      if (mode === "timeout" || mode === "no-effect-timeout") throw new Error("request timed out");
      if (mode === "failure") return apiResponse({ status: "failed", msg: "rejected" });
      if (parsed.pathname === "/album_tracking") {
        return apiResponse({
          item: mode === "tracking-list-stale" || !state.tracked
            ? []
            : [{ id: "123", name: "Test", update_at: "1" }],
          totalCnt: state.tracked ? "1" : "0",
        });
      }
      if (["/ajax/favorite_album", "/ajax/delete_favorite_album"].includes(parsed.pathname)) {
        return { status: 200, body: JSON.stringify({ status: "1", msg: "ok" }), headers: {} };
      }
      if (parsed.pathname === "/ajax/vote_album") {
        return { status: 200, body: JSON.stringify({ status: "1", msg: "ok" }), headers: {} };
      }
      return apiResponse({ status: "success", msg: "ok" });
    },
  });
  vm.runInContext(sourceCode, context, { filename: "source.js" });
  return {
    source: context.__source,
    state,
    posts,
    gets,
    advance(milliseconds) { clock.now += milliseconds; },
  };
}

{
  const runtime = makeRuntime({ favorited: true, liked: true, tracked: true, likeCount: 42 });
  const favorite = runtime.source.getFavoriteState(manga);
  const interaction = runtime.source.getInteractionState(manga);
  assert.equal(favorite.isFavorited, true);
  assert.deepEqual(Array.from(favorite.categories, (item) => [item.id, item.name]), [[0, "全部"]]);
  assert.equal(interaction.isLiked, true);
  assert.equal(interaction.canLike, false);
  assert.equal(interaction.isTracked, true);
  assert.equal(interaction.likeCount, "42");
}

{
  const runtime = makeRuntime();
  const page = runtime.source.getFavorites(1, 0, null);
  assert.equal(page.metadata.favoriteCategoryIDs, "0,7");
  assert.equal(page.metadata.favoriteCategoryName0, "全部");
  assert.equal(page.metadata.favoriteCategoryName7, "私人");
  assert.equal(page.metadata.favoriteCategoryCount7, "2");
  const favorite = runtime.source.getFavoriteState(manga);
  assert.deepEqual(Array.from(favorite.categories, (item) => [item.id, item.name]),
    [[0, "全部"], [7, "私人"]], "the shelf refreshes the fast persisted folder cache");
}

{
  const runtime = makeRuntime();
  assert.equal(runtime.source.getFavoriteState(manga).isFavorited, false);
  assert.equal(runtime.source.setFavorite(manga, 0, null).isFavorited, true);
  assert.deepEqual(runtime.posts.at(-1), {
    method: "POST",
    host: "18comic.vip",
    path: "/ajax/favorite_album",
    fields: { album_id: "123", fid: "0" },
  });
  assert.equal(runtime.source.removeFavorite(manga).isFavorited, false);
  assert.deepEqual(runtime.posts.at(-1), {
    method: "POST",
    host: "18comic.vip",
    path: "/ajax/delete_favorite_album",
    fields: { album_id: "123" },
  });
}

{
  const runtime = makeRuntime();
  assert.equal(runtime.source.setTracking(manga, true).isTracked, true);
  assert.deepEqual(runtime.posts.find((post) => post.path === "/album_sertracking"), {
    method: "POST",
    host: "www.cdngwc.net",
    path: "/album_sertracking",
    fields: { id: "123" },
  });
  assert.equal(runtime.source.setTracking(manga, false).isTracked, false);
  assert.equal(runtime.posts.filter((post) => post.path === "/album_sertracking").length, 2);
}

{
  const runtime = makeRuntime();
  const result = runtime.source.setFavorite(manga, 7, null);
  assert.equal(result.isFavorited, true);
  assert.equal(result.category, 7);
  assert.deepEqual(runtime.posts.at(-1), {
    method: "POST",
    host: "18comic.vip",
    path: "/ajax/favorite_album",
    fields: { album_id: "123", fid: "7" },
  });
}

{
  const runtime = makeRuntime({}, { "/ajax/vote_album": "timeout" });
  const result = runtime.source.setLiked(manga, true);
  assert.equal(result.isLiked, true, "a timed-out write succeeds only after website readback");
  assert.equal(result.likeCount, null);
  assert.equal(runtime.posts.length, 1, "an ambiguous mutation must never be retried");
  assert.equal(runtime.posts[0].path, "/ajax/vote_album", "rating must use the official website protocol");
}

{
  const runtime = makeRuntime({}, { "/ajax/vote_album": "no-effect-timeout" });
  assert.throws(() => runtime.source.setLiked(manga, true), /timed out/);
  assert.equal(runtime.state.liked, false);
  assert.equal(runtime.posts.length, 1);
}

{
  const runtime = makeRuntime({}, { "/ajax/favorite_album": "success-no-effect" });
  assert.throws(() => runtime.source.setFavorite(manga, 0, null), /未确认收藏成功/);
  assert.equal(runtime.state.favorited, false, "a 2xx response without state change must not become success");
}

{
  const runtime = makeRuntime({}, { "/album_sertracking": "failure" });
  assert.throws(() => runtime.source.setTracking(manga, true), /rejected/);
  assert.equal(runtime.state.tracked, false, "a rejected write must not create a local success state");
}

{
  const runtime = makeRuntime({}, { "/album_sertracking": "success-no-effect" });
  assert.throws(() => runtime.source.setTracking(manga, true), /未确认开启连载追踪/);
  assert.equal(runtime.state.tracked, false, "a 2xx toggle without a state change must not become success");
}

{
  const runtime = makeRuntime({}, { "/album_tracking": "tracking-list-stale" });
  assert.throws(() => runtime.source.setTracking(manga, true), /追踪列表尚未确认/);
  assert.equal(runtime.state.tracked, true,
    "the app must withhold success when the official tracking shelf has not synchronized");
}

{
  const runtime = makeRuntime({ liked: true });
  const result = runtime.source.setLiked(manga, false);
  assert.equal(result.isLiked, true);
  assert.equal(result.isSupported, false);
  assert.match(result.message, /单向操作/);
  assert.equal(runtime.posts.length, 0, "the official service has no unlike operation");
}

{
  const runtime = makeRuntime();
  assert.equal(runtime.source.getFavoriteState(manga).isFavorited, false);
  runtime.state.favorited = true;
  runtime.advance(1_000);
  assert.equal(runtime.source.getFavoriteState(manga).isFavorited, true,
    "foreground-style state reads must expire the short account-state cache");
}

{
  const runtime = makeRuntime({}, { storage: { account_web_session_ready: "" } });
  assert.throws(() => runtime.source.setFavorite(manga, 0, null), /官网授权/);
  assert.throws(() => runtime.source.setLiked(manga, true), /官网授权/);
  assert.equal(runtime.posts.length, 0, "website actions must never fall back to the mobile toggle API");
}

{
  const runtime = makeRuntime({}, {
    "/album_sertracking": "auth-failure-old-version",
    settingVersion: "2.1.5",
    storage: {
      app_version: "2.1.4",
      image_host: "https://tencent.jmdanjonproxy.xyz",
      setting_checked_at: "1787800000000",
    },
  });
  assert.equal(runtime.source.setTracking(manga, true).isTracked, true);
  assert.equal(runtime.posts.filter((post) => post.path === "/album_sertracking").length, 2,
    "one definite 401 may be retried on the same account replica after a newer signed version is announced");
  assert.equal(runtime.state.tracked, true);
}

{
  const runtime = makeRuntime({}, { storage: { account_api_login_host: "" } });
  assert.throws(() => runtime.source.setTracking(manga, true), /移动 API 登录/);
  assert.equal(runtime.posts.length, 0);
}

console.log("JMComic split website/mobile account interaction tests passed");
