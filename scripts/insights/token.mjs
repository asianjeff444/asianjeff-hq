// His Instagram key: which kind it is, which account it reads, and keeping it alive.
//   • The key starts as the GitHub secret IG_TOKEN. The first run copies it into the private Supabase row ig_link (id 1).
//     Putting a new key in IG_TOKEN later replaces the saved one on the next run.
//   • A key from "Instagram API with Instagram Login" (graph.instagram.com) lasts 60 days: it's renewed here every ~20 days
//     and the new one is kept in ig_link (GitHub secrets can't be changed from inside a run).
//   • A key from Facebook Login / a Business (system user) key (graph.facebook.com) reads the Instagram account linked to his Page.
import crypto from "node:crypto";

const IGH = "https://graph.instagram.com/", FBH = "https://graph.facebook.com/";
const seedOf = t => crypto.createHash("sha256").update(String(t || "")).digest("hex").slice(0, 16);
export const deadKey = e => !!e && (e.ig === 190 || /\b190\b|access token|session has (expired|been invalidated)|has not authorized|Error validating/i.test(String(e.message || e)));

async function getJSON(url, fetchFn) {
  try { const r = await fetchFn(url); const j = await r.json().catch(() => ({})); return { ok: r.ok && !j.error, j }; }
  catch (e) { return { ok: false, j: { error: { message: e.message } } }; }
}
// which Instagram account this key reads, and on which host
export async function detect(token, fetchFn = fetch) {
  const q = f => new URLSearchParams({ fields: f, access_token: token });
  let r = await getJSON(`${IGH}me?${q("user_id,username")}`, fetchFn);
  if (r.ok && (r.j.user_id || r.j.id)) return { host: IGH, igId: String(r.j.user_id || r.j.id), username: r.j.username || "", kind: "instagram" };
  const why1 = (r.j.error && r.j.error.message) || "";
  r = await getJSON(`${FBH}me/assigned_instagram_accounts?${q("id,username")}`, fetchFn);
  if (r.ok && Array.isArray(r.j.data) && r.j.data.length) return { host: FBH, igId: String(r.j.data[0].id), username: r.j.data[0].username || "", kind: "facebook" };
  r = await getJSON(`${FBH}me/accounts?${q("instagram_business_account{id,username}")}&limit=100`, fetchFn);
  const pg = r.ok && (r.j.data || []).find(p => p.instagram_business_account);
  if (pg) return { host: FBH, igId: String(pg.instagram_business_account.id), username: pg.instagram_business_account.username || "", kind: "facebook" };
  const why2 = (r.j.error && r.j.error.message) || "";
  throw Object.assign(new Error("This Instagram key doesn't open an Instagram Creator or Business account" + (why1 || why2 ? ` (Instagram said: ${String(why1 || why2).slice(0, 140)})` : "")), { ig: /190|expired|validating/i.test(why1 + why2) ? 190 : undefined });
}

// → {token, host, igId, username} or null when there's no key at all yet
export async function account({ db, envToken = "", NOW = Date.now(), say = () => {}, fetchFn = fetch }) {
  const env = String(envToken || "").trim(), seed = env ? seedOf(env) : "";
  let row = null;
  try { row = await db.link(); } catch (e) { say("warning", "Couldn't read the saved Instagram key (did supabase/setup.sql run?): " + String(e.message).slice(0, 160)); }
  // a new key in IG_TOKEN wins over the saved one
  if (env && (!row || row.seed !== seed)) {
    const d = await detect(env, fetchFn);
    row = { token: env, seed, host: d.host, ig_id: d.igId, username: d.username, kind: d.kind, refreshed_at: new Date(NOW).toISOString(), err: null };
    try { await db.saveLink(row); } catch (e) { say("warning", "Couldn't save the Instagram key in Supabase: " + String(e.message).slice(0, 160)); }
    say("notice", `Instagram key works: @${d.username || d.igId} (${d.kind === "instagram" ? "Instagram Login" : "Facebook / Business"} key)`);
  }
  if (!row || !row.token) return null;
  if (!row.host || !row.ig_id) { const d = await detect(row.token, fetchFn); Object.assign(row, { host: d.host, ig_id: d.igId, username: d.username, kind: d.kind }); await db.saveLink(row).catch(() => {}); }
  // keep an Instagram Login key alive: renew it every ~20 days (Instagram wants a key at least a day old)
  if (row.host === IGH) {
    const last = Date.parse(row.refreshed_at || 0) || 0;
    if (NOW - last > 20 * 864e5) {
      const r = await getJSON(`${IGH}refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: row.token })}`, fetchFn);
      if (r.ok && r.j.access_token) {
        row.token = r.j.access_token; row.refreshed_at = new Date(NOW).toISOString();
        row.expires_at = r.j.expires_in ? new Date(NOW + r.j.expires_in * 1000).toISOString() : null;
        await db.saveLink({ token: row.token, refreshed_at: row.refreshed_at, expires_at: row.expires_at, err: null });
        say("notice", "Renewed the Instagram key" + (row.expires_at ? ` (good until ${row.expires_at.slice(0, 10)})` : ""));
      } else say("warning", "Couldn't renew the Instagram key yet: " + String((r.j.error && r.j.error.message) || "no answer").slice(0, 160));
    }
  }
  return { token: row.token, host: row.host, igId: String(row.ig_id), username: row.username || "" };
}
