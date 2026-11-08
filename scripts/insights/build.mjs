// Turns Instagram's answers (ig-graph.mjs) into the two documents the Insights page draws:
//   insights/ig_account  { days:[{d, v, vw, lt, fo, un, nt, f, fv, nfv}], periods:{7:{…},14:{…},…}, followersNow, audience?, tz, updatedAt }
//   insights/ig_posts    { posts:[{id, mid, type reel|post|story, date, title, cap, url, sc, views, viewers, likes, comments, shares, saves,
//                                  reposts, follows, visits, replies, detail?}], hires?, counts?, updatedAt }
// and writes insights/sync (when it last worked, and what went wrong if it didn't).
// Days are Los Angeles days, like Instagram's own Insights in the US.
//   refresh({mode:"quick"}) → just the posts from the last 75 days (every ~15 minutes)
//   refresh({mode:"full"})  → everything: every post, the account charts, follows, accounts reached (every few hours)
const LA = "America/Los_Angeles", PERIODS = [7, 14, 30, 60, 90, 180];

/* --- Los Angeles time --- */
const fmtLA = new Intl.DateTimeFormat("en-US", { timeZone: LA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function laParts(ms) { const p = {}; fmtLA.formatToParts(new Date(ms)).forEach(x => { if (x.type !== "literal") p[x.type] = x.value; }); p.hour = String((+p.hour) % 24).padStart(2, "0"); return p; }
export const laDay = ms => { const p = laParts(ms); return `${p.year}-${p.month}-${p.day}`; };
const laLocal = ms => { const p = laParts(ms); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
function laOffMin(ms) { const p = laParts(ms); return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 6e4); }
export function laISO(ms) { const m = laOffMin(ms), a = Math.abs(m); return laLocal(ms) + (m < 0 ? "-" : "+") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0"); }
export const addD = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const dayDiff = (a, b) => { const f = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((f(a) - f(b)) / 864e5); };
function parseT(s) { s = String(s || "").trim(); if (!s) return NaN; if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(s)) s = s.replace(" ", "T") + "Z"; return Date.parse(s.replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); }
function pctS(cur, prev) { if (!prev) return null; const v = (cur - prev) / Math.abs(prev) * 100; if (!isFinite(v)) return null; return (v >= 0 ? "+" : "-") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
const num = v => v == null || v === "" || isNaN(+v) ? null : +v;

/* --- asking Instagram --- */
const tryOp = (IG, id, input) => IG.run(id, input).then(v => ({ v }), e => ({ e }));
async function pool(fns, n) { const out = new Array(fns.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, fns.length) }, async () => { while (i < fns.length) { const k = i++; out[k] = await fns[k](); } })); return out; }
const IGT = { REELS: "reel", REEL: "reel", FEED: "post", POST: "post", CAROUSEL_ALBUM: "post", IGTV: "post", STORY: "story" };
const IGB = { REEL: "reels", REELS: "reels", STORY: "stories", POST: "posts", FEED: "posts", CAROUSEL_ALBUM: "posts", IGTV: "posts", LIVE: "live" };
// longer ranges go in 31-day slices
async function slices(IG, input, start, end) { const out = []; let err = null, ok = 0;
  for (let s = start; s <= end; s = addD(s, 31)) { const e = addD(s, 30) < end ? addD(s, 30) : end; const r = await tryOp(IG, "instagram_get_account_performance", input(s, e));
    if (r.v) { ok++; for (const x of r.v) if (x && x.date) out.push(x); } else err = err || r.e; }
  return ok ? { v: out } : { e: err }; }
// every post with its numbers (newest first)
const IGP_IN = (A, y) => ({ accounts: A, date_range: { preset: "FIXED", start: "2015-01-01", end: addD(y, 1) }, dimensions: ["postId", "publishedDate", "mediaProductType", "caption", "permalink", "shortcode"], metrics: ["views", "reach", "likes", "comments", "shares", "saved", "reposts", "totalInteractions", "follows", "profileVisits", "replies", "igReelsAvgWatchTime", "igReelsVideoViewTotalTime", "reelsSkipRate"], orders: [{ field: "publishedDate", direction: "DESC" }], options: { include_stories: true } });
async function pullIG(IG, acc, y, dailyTo) {
  const A = [acc];
  // daily views: the whole year the first time, then only the last week again (numbers settle) plus anything new
  const d0 = dailyTo && dailyTo > addD(y, -364) ? (addD(dailyTo, -6) < y ? addD(dailyTo, -6) : y) : addD(y, -364);
  const fns = [
    () => slices(IG, (s, e) => ({ accounts: A, date_range: { preset: "FIXED", start: s, end: e }, dimensions: ["date"], metrics: ["views", "reach", "profileLinkTaps"] }), d0, y),
    () => tryOp(IG, "instagram_get_account_performance", { accounts: A, date_range: { preset: "FIXED", start: addD(y, -27), end: y }, dimensions: ["date"], metrics: ["newFollowers", "unfollows", "followers"] }),
    () => slices(IG, (s, e) => ({ accounts: A, date_range: { preset: "FIXED", start: s, end: e }, dimensions: ["date", "followType", "mediaProductType"], metrics: ["views", "likes", "comments", "shares", "saves", "replies", "reposts", "totalInteractions"] }), addD(y, -179), y),
    () => tryOp(IG, "instagram_get_posts_performance", IGP_IN(A, y)),
    ...PERIODS.map(n => () => tryOp(IG, "instagram_get_account_performance", { accounts: A, date_range: { preset: "FIXED", start: addD(y, -(n - 1)), end: y, compare: { preset: "previous_period", comparison_format: "rows" } }, metrics: ["reach"] }))];
  const r = await pool(fns, 3);
  return { daily: r[0], fol: r[1], brk: r[2], posts: r[3], per: Object.fromEntries(PERIODS.map((n, i) => [n, r[4 + i]])) };
}

/* --- the account document --- */
export function buildIGAccount(prev, pull, y, now) {
  prev = prev || {}; const days = new Map((prev.days || []).map(x => [x.d, { ...x }]));
  const get = d => { let x = days.get(d); if (!x) { x = { d }; days.set(d, x); } return x; };
  const recent = addD(y, -27); // Instagram only reports daily follows and unfollows for about a month
  let followers = prev.followersNow ?? null;
  if (pull.daily.v) for (const r of pull.daily.v) { if (!r || !r.date || r.date > y) continue; const x = get(r.date); x.v = +r.views || 0; x.vw = +r.reach || 0; x.lt = +r.profileLinkTaps || 0; }
  if (pull.fol.v) for (const r of pull.fol.v) { if (!r) continue;
    if (!r.date) { if (+r.followers > 0) followers = +r.followers; continue; }
    if (r.date > y || r.date < recent) continue; const x = get(r.date); x.fo = +r.newFollowers || 0; x.un = +r.unfollows || 0; x.nt = x.fo - x.un; }
  // views split by follower / non-follower and content type, per day (the last 180 days)
  const V = {}, I = {}; const brk = pull.brk.v;
  if (brk) { for (const r of brk) { if (!r || !r.date || r.date > y) continue; const t = IGB[r.mediaProductType] || (r.mediaProductType ? "posts" : "");
      if (r.followType === "FOLLOWER" || r.followType === "NON_FOLLOWER") { if (!t) continue; const a = ((V[r.date] = V[r.date] || {})[t] = V[r.date][t] || [0, 0]); a[r.followType === "FOLLOWER" ? 0 : 1] += +r.views || 0; }
      else if (!r.followType) { const k = t || "_acct", o = ((I[r.date] = I[r.date] || {})[k] = I[r.date][k] || { all: 0, likes: 0, comments: 0, reposts: 0, shares: 0, saves: 0, replies: 0 });
        o.all += +r.totalInteractions || 0; o.likes += +r.likes || 0; o.comments += +r.comments || 0; o.reposts += +r.reposts || 0; o.shares += +r.shares || 0; o.saves += +r.saves || 0; o.replies += +r.replies || 0; } }
    const seenD = new Set(brk.map(r => r && r.date).filter(Boolean)); // only days Instagram answered for; others keep what they had
    for (const d of seenD) { if (d > y) continue; const x = get(d), v = V[d] || {}; let f = 0, n = 0; for (const t in v) { f += v[t][0]; n += v[t][1]; } x.fv = f; x.nfv = n; } }
  let arr = [...days.values()].filter(x => x.d <= y).sort((a, b) => a.d < b.d ? -1 : 1).slice(-400);
  // followers on each recent day: today's count walked back with the daily follows and unfollows
  if (followers != null) { let f = followers; for (let i = arr.length - 1; i >= 0; i--) { const x = arr[i]; if (x.d < recent) break; x.f = f; if (x.fo == null || x.un == null) break; f -= x.fo - x.un; } }
  const idx = new Map(arr.map((x, i) => [x.d, i]));
  const periods = {};
  for (const n of PERIODS) {
    const a = addD(y, -(n - 1)), pa = addD(y, -(2 * n - 1)), pb = addD(y, -n), old = (prev.periods && prev.periods[n]) || {}, P = {};
    if (brk) { const bt = { reels: [0, 0, 0], stories: [0, 0, 0], posts: [0, 0, 0], live: [0, 0, 0] }, inter = {};
      ["all", "likes", "comments", "reposts", "shares", "saves", "replies"].forEach(k => { inter[k] = { reels: [0], stories: [0], posts: [0], live: [0] }; });
      let fc = 0, nc = 0, fp = 0, np = 0;
      for (let d = a; d <= y; d = addD(d, 1)) { const v = V[d] || {}; for (const t in v) { if (!bt[t]) continue; bt[t][0] += v[t][0]; bt[t][1] += v[t][1]; fc += v[t][0]; nc += v[t][1]; }
        const ii = I[d] || {}; for (const t in ii) { const o = ii[t];
          if (t === "_acct") { if (o.replies > 0) { inter.replies.stories[0] += o.replies; inter.all.stories[0] += o.replies; } if (o.reposts > 0) { inter.reposts.reels[0] += o.reposts; inter.all.reels[0] += o.reposts; } continue; }
          if (!inter.all[t]) continue; for (const k in inter) inter[k][t][0] += o[k] || 0; } }
      Object.assign(P, { byType: bt, inter, interSplit: false, fviews: fc, nfviews: nc });
      if (pa >= addD(y, -179)) { for (let d = pa; d <= pb; d = addD(d, 1)) { const v = V[d] || {}; for (const t in v) { fp += v[t][0]; np += v[t][1]; } }
        const c1 = pctS(fc, fp), c2 = pctS(nc, np); if (c1) P.fviewsChange = c1; if (c2) P.nfviewsChange = c2; } }
    else ["byType", "inter", "interSplit", "fviews", "nfviews", "fviewsChange", "nfviewsChange"].forEach(k => { if (old[k] !== undefined) P[k] = old[k]; });
    const pr = pull.per[n] && pull.per[n].v;
    if (pr) { const cur = pr.find(r => String(r.date_period || "").startsWith(a)), prv = pr.find(r => String(r.date_period || "").startsWith(pa));
      if (cur && num(cur.reach) != null) { P.viewers = +cur.reach; const c = prv && num(prv.reach) ? pctS(+cur.reach, +prv.reach) : null; if (c) P.viewersChange = c; } }
    else { if (old.viewers !== undefined) P.viewers = old.viewers; if (old.viewersChange !== undefined) P.viewersChange = old.viewersChange; }
    const win = arr.filter(x => x.d >= a && x.d <= y);
    if (win.length === n && win.every(x => x.fo != null && x.un != null)) { P.follows = win.reduce((s, x) => s + x.fo, 0); P.unfollows = win.reduce((s, x) => s + x.un, 0); }
    const ia = idx.get(a), fe = (arr[idx.get(y)] || {}).f, fs = ia > 0 ? arr[ia - 1].f : undefined;
    if (fe != null && fs != null) P.net = fe - fs; else if (P.follows != null) P.net = P.follows - P.unfollows; else if (old.net != null && !pull.fol.v) P.net = old.net;
    P.profile = [null, win.reduce((s, x) => s + (x.lt || 0), 0), 0];
    periods[n] = P;
  }
  const out = { days: arr, periods, followersNow: followers, audience: prev.audience || null, audienceAt: prev.audienceAt || undefined, tz: prev.tz || "PT", source: "instagram", updatedAt: laISO(now) };
  if (!out.audience) delete out.audience;
  if (!out.audienceAt) delete out.audienceAt;
  return out;
}

/* --- the posts document --- */
function fmtAvg(ms) { const s = Math.round(ms / 1000); return s < 60 ? s + "sec" : Math.floor(s / 60) + "min " + (s % 60) + "sec"; }
function fmtWatch(ms) { let s = Math.round(ms / 1000); const u = [["y", 31536000], ["d", 86400], ["h", 3600], ["m", 60], ["s", 1]], o = [];
  for (const [k, v] of u) { const q = Math.floor(s / v); s -= q * v; if (q || o.length) o.push(q + k); } return o.join(" ") || "0s"; }
function applyIG(p, a, fresh) { const r = a.r, set = (k, v) => { if (v != null) p[k] = v; };
  p.mid = a.mid; if (a.url) p.url = a.url; if (a.sc) p.sc = a.sc; p.cap = a.cap; if (fresh || !p.date) p.date = a.date;
  set("views", num(r.views)); set("viewers", num(r.reach)); set("likes", num(r.likes)); set("comments", num(r.comments)); set("shares", num(r.shares));
  set("saves", num(r.saved)); set("reposts", num(r.reposts)); set("follows", num(r.follows)); set("visits", num(r.profileVisits)); set("replies", num(r.replies));
  if (p.type === "reel") { const d = p.detail ? { ...p.detail } : {}, av = num(r.igReelsAvgWatchTime), tw = num(r.igReelsVideoViewTotalTime), sk = num(r.reelsSkipRate), re = num(r.reach), ti = num(r.totalInteractions);
    if (av != null) d.avgWatch = fmtAvg(av); if (tw != null) d.watchTime = fmtWatch(tw); if (re != null) d.accountsReached = re; if (ti != null) d.interactions = ti;
    if (sk != null) { d.skip = sk; if (Array.isArray(d.rates) && d.rates[0] && /skip/i.test(d.rates[0][0])) d.rates = [[d.rates[0][0], sk], ...d.rates.slice(1)]; }
    if (Object.keys(d).length) p.detail = d; }
  // stories: Instagram gives no story likes (0), but its total interactions = likes + replies + shares
  if (p.type === "story") { const ti = num(r.totalInteractions); if (ti != null) { p.detail = { ...(p.detail || {}), interactions: ti }; const rs = (p.replies || 0) + (p.shares || 0); if (!p.likes && ti >= rs) p.likes = ti - rs; } } }
export function mergeIGPosts(prevDoc, rows) {
  const posts = ((prevDoc && prevDoc.posts) || []).map(p => ({ ...p })), api = [];
  for (const r of rows || []) { if (!r || !r.postId) continue; const t = parseT(r.publishedDate); if (isNaN(t)) continue;
    api.push({ mid: String(r.postId), type: IGT[r.mediaProductType] || "post", t, date: laLocal(t), day: laDay(t), cap: String(r.caption || ""), url: r.permalink || "", sc: r.shortcode || "", r }); }
  const byMid = new Map(posts.filter(p => p.mid).map(p => [String(p.mid), p])), taken = new Set(), rep = { updated: 0, added: 0 };
  for (const a of api) { const p = byMid.get(a.mid); if (p) { applyIG(p, a); taken.add(a.mid); rep.updated++; } }
  for (const a of api.filter(a => !taken.has(a.mid)).sort((x, y) => y.t - x.t)) {
    const c = Array.from(a.cap.replace(/\s+/g, " ").trim()), title = c.length > 22 ? c.slice(0, 22).join("").trimEnd() + "…" : c.join(""); // the list cuts captions like Instagram does
    const p = { id: "m" + a.mid, type: a.type, date: a.date, title }; applyIG(p, a, true); posts.push(p); rep.added++; }
  return { posts, api, rep };
}
// every post ever logged stays; if the document nears its size limit, the oldest captions get shortened first
export function fitPosts(doc, max) { max = max || 235000; if (JSON.stringify(doc).length <= max) return doc;
  const old = doc.posts.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const lim of [300, 120, 40, 0]) for (let i = 0; i < old.length; i += 20) {
    for (const p of old.slice(i, i + 20)) { const c = Array.from(String(p.cap || "")); if (c.length > lim) p.cap = lim ? c.slice(0, lim).join("") + "…" : ""; }
    if (JSON.stringify(doc).length <= max) return doc; }
  return doc; }
// daily history: only the oldest days go, and only if the document would not fit
export function fitDays(doc, max, keep) { max = max || 240000; keep = keep || 200; while (doc.days && doc.days.length > keep && JSON.stringify(doc).length > max) doc.days = doc.days.slice(Math.min(30, doc.days.length - keep)); return doc; }

/* --- one refresh --- */
// get(path) / put(path, data) read and write documents; IG = igGraph(...); acc = his Instagram account id
export async function refresh({ get, put, IG, acc, mode = "quick", now = Date.now(), why = "" }) {
  const y = addD(laDay(now), -1), errs = [], rep = {};
  const sdoc = (await get("insights/sync")) || {};
  if (mode === "quick") {
    const ip = await tryOp(IG, "instagram_get_posts_performance", IGP_IN([acc], y));
    if (ip.e) throw ip.e;
    const pv = (await get("insights/ig_posts")) || {}; const m = mergeIGPosts(pv, ip.v); rep.ig = m.rep;
    await put("insights/ig_posts", fitPosts({ ...pv, posts: m.posts, source: "instagram", updatedAt: laISO(now) }));
    const cur = (await get("insights/sync")) || sdoc;
    const doc = { ...cur, igAccount: acc, quickAt: now, quickWhy: why, quickReport: rep, quickErrs: errs, lastErr: null, lastErrAt: null, waiting: false, dead: false };
    await put("insights/sync", doc);
    return { report: rep, errs };
  }
  const ig = await pullIG(IG, acc, y, sdoc.igDailyTo);
  const all = [ig.daily.e, ig.posts.e];
  if (all.every(Boolean)) throw ig.posts.e; // nothing came back at all
  if (ig.posts.v) { const pv = (await get("insights/ig_posts")) || {}; const m = mergeIGPosts(pv, ig.posts.v); rep.ig = m.rep;
    await put("insights/ig_posts", fitPosts({ ...pv, posts: m.posts, source: "instagram", updatedAt: laISO(now) })); }
  else errs.push("Instagram posts: " + String(ig.posts.e && ig.posts.e.message || "didn't answer").slice(0, 160));
  if (ig.daily.v || ig.brk.v || ig.fol.v) { const pa = (await get("insights/ig_account")) || null; const A = buildIGAccount(pa, ig, y, now); fitDays(A); await put("insights/ig_account", A); }
  else errs.push("Instagram stats: " + String(ig.daily.e && ig.daily.e.message || "didn't answer").slice(0, 160));
  if (!ig.daily.v && (ig.brk.v || ig.fol.v)) errs.push("Instagram daily views: " + String(ig.daily.e && ig.daily.e.message || "").slice(0, 160));
  if (!ig.brk.v && (ig.daily.v || ig.fol.v)) errs.push("Instagram views by type: " + String(ig.brk.e && ig.brk.e.message || "").slice(0, 160));
  const cur = (await get("insights/sync")) || sdoc;
  const doc = { ...cur, at: now, ok: !errs.length, why, igAccount: acc, igDailyTo: ig.daily.v ? y : (sdoc.igDailyTo || ""), report: rep, errs, quickAt: now, lastErr: null, lastErrAt: null, waiting: false, dead: false };
  await put("insights/sync", doc);
  return { report: rep, errs };
}
