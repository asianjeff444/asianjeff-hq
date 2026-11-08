// Covers: every post that has no cover picture yet gets Instagram's own (a reel's thumbnail, or the photo itself), saved in the
// private "assets" bucket (id = md5("ig-cover|" + post id), so running again never makes a copy) and listed in
// insights/ig_posts.hires {<post id>: <photo id>}: the Insights page draws its thumbnails from there.
// Also the account's counts (posts, following, followers), username, name and profile picture → insights/ig_posts.counts
// (one call per run; saved only when something changed). The home screen's Insights tile shows the picture and the username.
// A post Instagram gives no cover for is tried again every 6 hours, 5 times (a story more than a day old: once, Instagram only
// shares stories for 24 hours). Tries live in insights/ig_covers.
import crypto from "node:crypto";

const md5 = s => crypto.createHash("md5").update(s).digest("hex");
const imgType = b => b.length > 12 && (b[0] === 0xFF && b[1] === 0xD8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E ? "image/png"
  : String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP" ? "image/webp" : null) || null;

async function fetchCapped(url, cap, fetchFn, ms = 20000) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetchFn(url, { signal: ac.signal, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (+res.headers.get("content-length") > cap) throw new Error("too big");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > cap) throw new Error("too big");
    return buf;
  } finally { clearTimeout(timer); }
}
const laMs = d => { const t = Date.parse(String(d || "").length <= 19 ? d + "Z" : d); return isNaN(t) ? 0 : t; };

// db = store(), IG = igGraph() (its .get(path, params)), igId = his Instagram account id
export async function covers({ db, IG, igId, NOW = Date.now(), max = 40, say = () => {}, fetchFn = fetch }) {
  const pd = await db.get("insights/ig_posts"); if (!pd || !Array.isArray(pd.posts)) return { saved: 0, failed: 0, left: 0 };
  const hires = pd.hires || {}, triesDoc = (await db.get("insights/ig_covers")) || {};
  const tries = { ...(triesDoc.tries || {}) }, before = JSON.stringify(tries), need = [];
  for (const p of pd.posts) {
    if (!p || !p.mid) continue;
    if (hires[p.id]) { delete tries[p.mid]; continue; }
    const t = tries[p.mid], top = p.type === "story" && NOW - laMs(p.date) > 26 * 36e5 ? 1 : 5;
    if (t && ((t.n || 0) >= top || NOW - (t.at || 0) < 6 * 36e5)) continue;
    need.push({ p, t: laMs(p.date) });
  }
  const mids = new Set(pd.posts.map(p => String(p.mid || "")));
  for (const k of Object.keys(tries)) if (!mids.has(k)) delete tries[k];
  const add = {}, fails = []; let stop = false;
  for (const x of need.sort((a, b) => b.t - a.t).slice(0, max)) {   // newest first
    const { p } = x;
    try {
      const m = await IG.get(String(p.mid), { fields: "media_type,thumbnail_url,media_url" });
      const url = m.thumbnail_url || (m.media_type && m.media_type !== "VIDEO" ? m.media_url : null);
      if (!url) throw new Error(`Instagram sent no cover picture${m.media_type ? " (" + m.media_type + ")" : ""}`);
      const buf = await fetchCapped(url, 8e6, fetchFn), type = imgType(buf);
      if (!type) throw new Error("what came back wasn't a picture");
      const id = md5("ig-cover|" + p.mid);
      await db.upload(id, buf, type);
      add[p.id] = id; delete tries[p.mid];
    } catch (e) {
      tries[p.mid] = { n: ((tries[p.mid] && tries[p.mid].n) || 0) + 1, at: NOW, why: String(e.message).slice(0, 100) };
      fails.push(`${p.type || "post"} ${String(p.date || "").slice(0, 10)}: ${String(e.message).slice(0, 80)}`);
      if (e.ig === 190) { stop = true; break; }   // the key stopped working: stop for now
    }
  }
  // his account: post count, following, followers, profile picture, username
  let counts = null;
  if (!stop && igId) {
    try {
      const F0 = "media_count,follows_count,followers_count,profile_picture_url,username,name";
      const a = await IG.get(String(igId), { fields: F0 + ",biography,website" }).catch(e => { if (e.ig === 100) return IG.get(String(igId), { fields: F0 }); throw e; }) || {};
      const old = pd.counts || {};
      counts = { media: +a.media_count || 0, follows: +a.follows_count || 0, followers: +a.followers_count || 0, pic: old.pic || null, picKey: old.picKey || null,
        user: a.username || "", name: a.name || "", bio: a.biography || "", web: a.website || "", at: NOW };
      const key = a.profile_picture_url ? String(a.profile_picture_url).split("?")[0].split("/").pop() : null;
      if (key && key !== old.picKey) {
        const buf = await fetchCapped(a.profile_picture_url, 4e6, fetchFn), type = imgType(buf);
        if (type) { const id = md5("ig-avatar|" + key); await db.upload(id, buf, type); counts.pic = id; counts.picKey = key; }
      }
      if (["media", "follows", "followers", "pic", "user", "name", "bio", "web"].every(k => (old[k] || "") === (counts[k] || ""))) counts = null;
    } catch (e) { say("warning", "Account counts: " + String(e.message).slice(0, 160)); counts = null; }
  }
  const saved = Object.keys(add).length;
  if (saved || counts) {
    const fresh = await db.get("insights/ig_posts");   // a fresh copy right before saving, so nothing saved meanwhile is lost
    if (fresh && Array.isArray(fresh.posts)) await db.put("insights/ig_posts", { ...fresh, hires: { ...(fresh.hires || {}), ...add }, ...(counts ? { counts } : {}) });
    if (saved) say("notice", `Covers: saved ${saved}`);
    if (counts) say("notice", `Account: @${counts.user}, ${counts.followers} followers, ${counts.media} posts`);
  }
  if (fails.length) say("warning", "Covers: " + fails.join(" · ").slice(0, 600));
  if (JSON.stringify(tries) !== before || !triesDoc.at) await db.put("insights/ig_covers", { tries, at: NOW });
  return { saved, failed: fails.length, left: Math.max(0, need.length - Math.min(need.length, max)), counts: !!counts };
}

// his audience (full refresh, once a day): ages, women / men, top countries, top cities. Instagram needs 100+ followers for these.
const REGION = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return null; } })();
export async function audience({ db, IG, igId, NOW = Date.now(), say = () => {} }) {
  const ask = async bd => {
    const q = { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: bd };
    let j; try { j = await IG.get(`${igId}/insights`, q); } catch (e) { if (e.ig !== 100) throw e; j = await IG.get(`${igId}/insights`, { ...q, timeframe: "this_month" }); }
    return (((((j.data || [])[0] || {}).total_value || {}).breakdowns || [])[0] || {}).results || [];
  };
  const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, A = {};
  const ag = await ask("age,gender").catch(() => null);
  if (ag && ag.length) {
    const by = {}; let tot = 0;
    for (const r of ag) { const [a, g] = r.dimension_values || []; const v = +r.value || 0; tot += v; const o = (by[a] = by[a] || { F: 0, M: 0, U: 0 }); o[g === "F" ? "F" : g === "M" ? "M" : "U"] += v; }
    if (tot) {
      A.ages = Object.keys(by).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map(a => { const o = by[a]; return [a, r1(100 * (o.F + o.M + o.U) / tot), r2(100 * o.F / tot), r2(100 * o.M / tot)]; });
      const F = Object.values(by).reduce((s, o) => s + o.F, 0), M = Object.values(by).reduce((s, o) => s + o.M, 0);
      if (F + M) A.gender = [["Women", Math.round(100 * F / (F + M))], ["Men", 100 - Math.round(100 * F / (F + M))]];
    }
  }
  const top = (rows, name) => { const tot = rows.reduce((s, r) => s + (+r.value || 0), 0); if (!tot) return null;
    return rows.slice().sort((a, b) => (+b.value || 0) - (+a.value || 0)).slice(0, 5).map(r => [name(String((r.dimension_values || [])[0] || "")), r1(100 * (+r.value || 0) / tot)]); };
  const co = await ask("country").catch(() => []); const c5 = top(co, c => { try { return (REGION && /^[A-Z]{2}$/i.test(c) && REGION.of(c.toUpperCase())) || c; } catch (e) { return c; } }); if (c5) A.countries = c5;
  const ci = await ask("city").catch(() => []); const t5 = top(ci, c => c.split(",")[0].trim()); if (t5) A.cities = t5;
  if (!Object.keys(A).length) { say("notice", "Audience: Instagram gave none yet (it needs 100+ followers)"); return null; }
  const acc = await db.get("insights/ig_account");
  if (!acc) return null;
  await db.put("insights/ig_account", { ...acc, audience: { ...(acc.audience || {}), ...A, tz: "PT" }, audienceAt: NOW });
  say("notice", `Audience saved (${Object.keys(A).join(", ")})`);
  return Object.keys(A);
}
