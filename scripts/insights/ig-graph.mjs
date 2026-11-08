// Instagram's Graph API, asked the way the Insights page needs it. Plain fetch only (Node 18+).
//
// run(op, input) answers four questions:
//   instagram_get_posts_performance   → every post + the stories that are up: GET <ig>/media (+ /stories), then
//                                        GET <media>/insights per post (the metrics Instagram allows for that kind of post, learned once per run)
//   instagram_get_account_performance → account numbers per Los Angeles day:
//        • daily views / reach / link taps            → one total_value call per day
//        • daily follows / unfollows (+ followers now) → follows_and_unfollows by follow_type, one call per day
//        • views by follower type × content type, interactions by content type → one or two calls per day
//        • accounts reached over 7 / 14 / 30 days (+ the period before). Instagram allows at most 30 days,
//          so 60 / 90 / 180 throw and the page keeps the last number it had
//   instagram_select_accounts         → the account itself
// Finished days (4+ days old) are kept in a cache (insights/ig_cache), so later full refreshes only ask about the last few days.
//
// host: "https://graph.instagram.com/" for a key from "Instagram API with Instagram Login",
//       "https://graph.facebook.com/" for a key from Facebook Login / a Business (system user) key.
// lenient: when Instagram refuses a post's insights, the post still comes back with what the media list gives (likes, comments, caption).
const LA = "America/Los_Angeles";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtLA = new Intl.DateTimeFormat("en-US", { timeZone: LA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const laParts = ms => { const p = {}; fmtLA.formatToParts(new Date(ms)).forEach(x => { if (x.type !== "literal") p[x.type] = +x.value; }); p.hour %= 24; return p; };
const laDay = ms => { const p = laParts(ms); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
const addD = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
// unix seconds of 00:00 in Los Angeles on day d
function laMid(d) {
  const [y, m, dd] = d.split("-").map(Number), want = Date.UTC(y, m - 1, dd); let t = want + 8 * 36e5;
  for (let i = 0; i < 3; i++) { const p = laParts(t); t += want - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); }
  return Math.floor(t / 1000);
}
const val = d => {
  if (!d) return null;
  if (d.total_value) { if (d.total_value.value != null) return +d.total_value.value; const rs = (d.total_value.breakdowns || []).flatMap(b => b.results || []); return rs.length ? rs.reduce((s, r) => s + (+r.value || 0), 0) : 0; }
  if (Array.isArray(d.values)) return d.values.reduce((s, v) => s + (+v.value || 0), 0);
  return null;
};
const results = d => ((d && d.total_value && d.total_value.breakdowns) || []).flatMap(b => b.results || []);

export class IGErr extends Error {
  constructor(e, status) {
    super((e && e.message) || "Instagram error " + status); this.code = "instagram"; this.ig = e && e.code; this.sub = e && e.error_subcode; this.status = status;
    this.retryable = status >= 500 || (e && (e.is_transient || [2, 4, 17, 32, 613].includes(e.code))); this.retryAfterMs = 20000;
  }
}

export function igGraph({ token, igId, cache = {}, recentDays = 0, say = () => {}, ver = "", host = "", label = "", lenient = false, fetchFn = fetch }) {
  const API = (host || "https://graph.facebook.com/").replace(/\/?$/, "/") + (ver ? String(ver).replace(/^\/?/, "").replace(/\/?$/, "/") : "");
  let calls = 0, cacheChanged = false, usageMax = 0;
  cache.days = cache.days || {};
  // how close Meta says we are to its rate limits (0-100, the highest number in its usage headers)
  const usage = res => { for (const h of ["x-business-use-case-usage", "x-app-usage"]) { const v = res.headers.get(h); if (!v) continue;
    try { const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, x] of Object.entries(o)) { if (typeof x === "number" && /^(call_count|total_cputime|total_time)$/.test(k)) usageMax = Math.max(usageMax, x); else walk(x); } }; walk(JSON.parse(v)); } catch (e) {} } };
  async function getUrl(url) {
    for (let i = 0; ; i++) {
      let res; calls++;
      try { res = await fetchFn(url); } catch (e) { if (i < 3) { await sleep(1500 * (i + 1)); continue; } throw Object.assign(new Error("Couldn't reach Instagram"), { code: "instagram", retryable: true }); }
      usage(res);
      const j = await res.json().catch(() => ({}));
      if (res.ok && !j.error) return j;
      const err = new IGErr(j.error || {}, res.status);
      if (err.retryable && i < 3) { await sleep((err.ig === 4 || err.ig === 17 || err.ig === 32 || err.ig === 613 ? 15000 : 2500) * (i + 1)); continue; }
      throw err;
    }
  }
  const get = (path, params = {}) => getUrl(`${API}${path}?${new URLSearchParams({ ...params, access_token: token })}`);
  async function pool(items, n, fn) { const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
  const today = laDay(Date.now()), settled = d => dayDiff(today, d) >= 4;   // a day's numbers stop changing after a few days
  const day = d => (cache.days[d] = cache.days[d] || {});
  const keep = (d, k, v) => { if (settled(d)) { day(d)[k] = v; cacheChanged = true; } return v; };

  /* ---------- posts (every post + the stories that are up) ---------- */
  const MET = {
    REELS: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "reposts", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"],
    FEED: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "reposts", "follows", "profile_visits"],
    STORY: ["views", "reach", "replies", "shares", "total_interactions", "follows", "profile_visits"],
  };
  const okMet = {};   // product type → the metrics Instagram took (learned from the first post of that kind)
  async function insightsOf(m) {
    const type = MET[m.media_product_type] ? m.media_product_type : "FEED";
    const ask = async list => { const j = await get(`${m.id}/insights`, { metric: list.join(",") }); const o = {}; for (const d of j.data || []) o[d.name] = val(d); return o; };
    if (okMet[type]) return ask(okMet[type]);
    try { const o = await ask(MET[type]); okMet[type] = MET[type]; return o; }
    catch (e) {
      if (e.ig !== 100) throw e;
      const ok = []; for (const x of MET[type]) { try { await ask([x]); ok.push(x); } catch (e2) { if (e2.ig !== 100) throw e2; } }
      okMet[type] = ok; say("notice", `Instagram: ${type.toLowerCase()} posts give ${ok.join(", ")}`);
      return ok.length ? ask(ok) : {};
    }
  }
  async function postsOp(input) {
    const F = "id,caption,media_product_type,media_type,timestamp,permalink,shortcode,like_count,comments_count";
    let list = [], j = await get(`${igId}/media`, { fields: F, limit: 100 });
    for (let n = 0; j; n++) { list = list.concat(j.data || []); if (n > 40 || !(j.paging && j.paging.next)) break; j = await getUrl(j.paging.next); }
    if (input && input.options && input.options.include_stories) { try { const s = await get(`${igId}/stories`, { fields: F }); list = list.concat((s.data || []).map(x => ({ ...x, media_product_type: "STORY" }))); } catch (e) { say("warning", "Instagram stories: " + e.message); } }
    const r = (input && input.date_range) || {}, start = r.start || "2000-01-01", end = r.end || "2999-12-31";
    list = list.filter(m => { const d = laDay(Date.parse(m.timestamp)); return d >= start && d <= end; });
    if (recentDays) list = list.filter(m => m.media_product_type === "STORY" || Date.now() - Date.parse(m.timestamp) < recentDays * 864e5);
    let failed = 0, why = "";
    const rows = await pool(list, 6, async m => {
      let ins;
      try { ins = await insightsOf(m); } catch (e) { failed++; why = why || e.message; if (!lenient) return null; ins = {}; }   // no numbers this time: the post keeps what it had
      return { postId: m.id, publishedDate: m.timestamp, mediaProductType: m.media_product_type, caption: m.caption || "", permalink: m.permalink || "", shortcode: m.shortcode || "",
        views: ins.views ?? null, reach: ins.reach ?? null, likes: ins.likes ?? m.like_count ?? null, comments: ins.comments ?? m.comments_count ?? null, shares: ins.shares ?? null,
        saved: ins.saved ?? null, reposts: ins.reposts ?? null, totalInteractions: ins.total_interactions ?? null, follows: ins.follows ?? null, profileVisits: ins.profile_visits ?? null,
        replies: ins.replies ?? null, igReelsAvgWatchTime: ins.ig_reels_avg_watch_time ?? null, igReelsVideoViewTotalTime: ins.ig_reels_video_view_total_time ?? null, reelsSkipRate: ins.reels_skip_rate ?? null };
    });
    if (failed) say("warning", `Instagram: no numbers for ${failed} of ${list.length} posts this time (${String(why).slice(0, 120)})`);
    const out = rows.filter(Boolean);
    if (!out.length && list.length) throw Object.assign(new Error("Instagram sent no post numbers: " + why), { code: "instagram" });
    return out.sort((a, b) => Date.parse(b.publishedDate) - Date.parse(a.publishedDate));
  }

  /* ---------- account (Los Angeles days) ---------- */
  const span = (s, e) => { const out = []; for (let d = s; d <= e && d < today; d = addD(d, 1)) out.push(d); return out; };
  // Instagram counts every day whose bucket touches [since, until], so a day ends one second before the next midnight
  // (until = next midnight would add the next day too)
  const total = (d, metrics, extra = {}) => get(`${igId}/insights`, { metric: metrics, period: "day", metric_type: "total_value", since: laMid(d), until: laMid(addD(d, 1)) - 1, ...extra });
  async function dailyViews(s, e) {
    return pool(span(s, e), 6, async d => {
      const c = cache.days[d]; if (c && c.dv) return { date: d, ...c.dv };
      const j = await total(d, "views,reach,profile_links_taps"), o = {}; for (const x of j.data || []) o[x.name] = val(x);
      return { date: d, ...keep(d, "dv", { views: o.views || 0, reach: o.reach || 0, profileLinkTaps: o.profile_links_taps || 0 }) };
    });
  }
  async function dailyFollows(s, e) {
    const rows = await pool(span(s, e), 6, async d => {
      const c = cache.days[d]; if (c && c.fu) return { date: d, ...c.fu };
      const j = await total(d, "follows_and_unfollows", { breakdown: "follow_type" }), o = { newFollowers: 0, unfollows: 0 };
      for (const r of results((j.data || [])[0])) { if (r.dimension_values[0] === "FOLLOWER") o.newFollowers = +r.value || 0; else if (r.dimension_values[0] === "NON_FOLLOWER") o.unfollows = +r.value || 0; }
      return { date: d, ...keep(d, "fu", o) };
    });
    const me = await get(String(igId), { fields: "followers_count" });
    return [...rows, { followers: me.followers_count }];
  }
  // interactions by content type: which metrics take the breakdown together, apart, or not at all (learned once per run)
  const IM = [["likes", "likes"], ["comments", "comments"], ["shares", "shares"], ["saves", "saves"], ["replies", "replies"], ["reposts", "reposts"], ["total_interactions", "totalInteractions"]];
  let iplan = null;
  async function interPlan(d) {
    if (iplan) return iplan;
    try { await total(d, IM.map(x => x[0]).join(","), { breakdown: "media_product_type" }); return (iplan = { together: IM.map(x => x[0]), alone: [] }); }
    catch (e) { if (e.ig !== 100 && e.ig !== 1) throw e; }
    const together = [], alone = [];
    for (const [m] of IM) { try { await total(d, m, { breakdown: "media_product_type" }); together.push(m); } catch (e) { if (e.ig !== 100 && e.ig !== 1) throw e; alone.push(m); } }
    say("notice", `Instagram: interactions by type: ${together.join(", ")}${alone.length ? ` · account-wide only: ${alone.join(", ")}` : ""}`);
    return (iplan = { together, alone, apart: true });
  }
  async function breakdown(s, e) {
    const out = [];
    const per = await pool(span(s, e), 4, async d => {
      const c = cache.days[d]; if (c && c.bk) return c.bk.map(r => ({ date: d, ...r }));
      const rows = [];
      const v = await total(d, "views", { breakdown: "follow_type,media_product_type" });
      for (const r of results((v.data || [])[0])) rows.push({ followType: r.dimension_values[0], mediaProductType: r.dimension_values[1], views: +r.value || 0 });
      const plan = await interPlan(d), by = {};
      const add = (mpt, key, n) => { const o = (by[mpt] = by[mpt] || { mediaProductType: mpt }); o[key] = (o[key] || 0) + n; };
      const name = m => IM.find(x => x[0] === m)[1];
      const asks = plan.apart ? plan.together.map(m => [m]) : [plan.together];
      for (const ms of asks.filter(x => x.length)) { const j = await total(d, ms.join(","), { breakdown: "media_product_type" }); for (const x of j.data || []) for (const r of results(x)) add(r.dimension_values[0], name(x.name), +r.value || 0); }
      if (plan.alone.length) { const j = await total(d, plan.alone.join(",")); for (const x of j.data || []) add("", name(x.name), val(x) || 0); }
      rows.push(...Object.values(by));
      keep(d, "bk", rows);
      return rows.map(r => ({ date: d, ...r }));
    });
    for (const p of per) out.push(...p);
    return out;
  }
  async function reachOver(s, e) {
    const n = dayDiff(e, s) + 1;
    if (n > 30) throw Object.assign(new Error("Instagram only gives accounts reached for up to 30 days"), { code: "instagram" });
    const one = async (a, b) => { const j = await get(`${igId}/insights`, { metric: "reach", period: "day", metric_type: "total_value", since: laMid(a), until: laMid(addD(b, 1)) - 1 }); return val((j.data || [])[0]); };
    const ps = addD(s, -n), pe = addD(s, -1);
    const [c, p] = await Promise.all([one(s, e), one(ps, pe)]);
    return [{ date_period: `${s} - ${e}`, reach: c }, { date_period: `${ps} - ${pe}`, reach: p }];
  }
  async function accountOp(input) {
    const dims = input.dimensions || [], mets = input.metrics || [], r = input.date_range || {};
    if (r.compare) return reachOver(r.start, r.end);
    if (dims.includes("followType")) return breakdown(r.start, r.end);
    if (mets.includes("newFollowers")) return dailyFollows(r.start, r.end);
    if (dims.includes("date")) return dailyViews(r.start, r.end);
    throw Object.assign(new Error("Unknown Instagram account request"), { code: "instagram" });
  }

  async function run(id, input) {
    if (id === "instagram_select_accounts") return [{ value: String(igId), label }];
    if (id === "instagram_get_posts_performance") return postsOp(input);
    if (id === "instagram_get_account_performance") return accountOp(input);
    throw Object.assign(new Error("Not an Instagram operation: " + id), { code: "instagram" });
  }
  // keep only the last 400 days in the cache
  const cacheOut = () => { const ks = Object.keys(cache.days).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 400))) delete cache.days[k]; return cache; };
  return { run, calls: () => calls, usage: () => usageMax, cacheChanged: () => cacheChanged, cacheOut, get };
}
