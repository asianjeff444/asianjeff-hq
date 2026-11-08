// The Instagram refresh: pulls his own Instagram numbers with his own key and saves them where the app's Insights page reads them.
// Runs on GitHub Actions (.github/workflows/insights.yml): a quick refresh every 15 minutes, a full one every 6 hours.
//   MODE=quick → the posts from the last 75 days (views, likes, shares, saves… per post) + new covers
//   MODE=full  → everything: every post, the account charts (views per day, followers, follows / unfollows, accounts reached),
//                covers, and the audience (once a day)
//   MODE=auto  → full when the last full one is 6+ hours old (or there's none yet), else quick
// Secrets (GitHub → Settings → Secrets and variables → Actions):
//   SUPABASE_SECRET_KEY = the Supabase project's secret key (sb_secret_…), never in the app
//   IG_TOKEN            = his Instagram key (see START-HERE.md); optional until he connects Instagram
// The Supabase address comes from app/config.js. Nothing here ever prints a key.
import fs from "node:fs";
import { store, urlFromConfig } from "./insights/store.mjs";
import { igGraph } from "./insights/ig-graph.mjs";
import { refresh, laISO } from "./insights/build.mjs";
import { covers, audience } from "./insights/covers.mjs";
import { account, deadKey } from "./insights/token.mjs";

const KEY = (process.env.SUPABASE_SECRET_KEY || "").trim();
const URL = (process.env.SUPABASE_URL || "").trim() || urlFromConfig(fs.existsSync("app/config.js") ? fs.readFileSync("app/config.js", "utf8") : "");
const SECRETS = [KEY, (process.env.IG_TOKEN || "").trim()].filter(x => x.length > 8);
const clean = m => { let t = String(m); for (const k of SECRETS) t = t.split(k).join("***"); return t.replace(/access_token=[^&\s"]+/g, "access_token=***"); };
const say = (kind, msg) => console.log(`::${kind}::${clean(msg).replace(/\r?\n/g, " ").slice(0, 900)}`);
const NOW = Date.now();

async function main() {
  if (!URL) { say("notice", "Not set up yet: app/config.js has no Supabase address. Nothing to do."); return; }
  if (!KEY) { say("notice", "Not set up yet: add the SUPABASE_SECRET_KEY secret. Nothing to do."); return; }
  const db = store({ url: URL, key: KEY });
  const syncDoc = (await db.get("insights/sync")) || {};
  const fail = async (msg, extra = {}) => { await db.put("insights/sync", { ...((await db.get("insights/sync")) || {}), lastErr: clean(msg).slice(0, 300), lastErrAt: NOW, ...extra }); };

  let link;
  try { link = await account({ db, envToken: process.env.IG_TOKEN, NOW, say }); }
  catch (e) {
    say("warning", "Instagram key: " + e.message);
    await fail(deadKey(e) ? "Your Instagram key stopped working. Ask Claude to help you make a new one." : e.message, { dead: deadKey(e) });
    return;
  }
  if (!link) { say("notice", "No Instagram key yet (IG_TOKEN). The Insights page shows Instagram's numbers once it's added."); if (!syncDoc.waiting) await db.put("insights/sync", { ...syncDoc, waiting: true, waitingAt: NOW }); return; }
  SECRETS.push(link.token);

  const hasAcc = !!(await db.get("insights/ig_account"));
  let mode = (process.env.MODE || "auto").trim();
  if (mode !== "quick" && mode !== "full") mode = !hasAcc || !syncDoc.at || NOW - syncDoc.at > 6 * 36e5 - 10 * 6e4 ? "full" : "quick";
  const cache = mode === "full" ? ((await db.get("insights/ig_cache")) || {}) : {};
  const IG = igGraph({ token: link.token, igId: link.igId, host: link.host, cache, recentDays: mode === "quick" ? 75 : 0, say, label: link.username, lenient: true });
  const t0 = Date.now();
  let out;
  try { out = await refresh({ get: db.get, put: db.put, IG, acc: link.igId, mode, now: NOW, why: process.env.WHY || "schedule" }); }
  catch (e) {
    say("warning", `Instagram didn't answer (${mode} refresh): ${e.message}`);
    if (deadKey(e)) { await fail("Your Instagram key stopped working. Ask Claude to help you make a new one.", { dead: true }); await db.saveLink({ err: "dead", err_at: new Date(NOW).toISOString() }).catch(() => {}); }
    else await fail("Instagram didn't answer: " + e.message);
    return;
  }
  if (mode === "full" && IG.cacheChanged()) await db.put("insights/ig_cache", IG.cacheOut());
  let cv = null, au = null;
  try { cv = await covers({ db, IG, igId: link.igId, NOW, max: mode === "full" ? 120 : 15, say }); } catch (e) { say("warning", "Covers: " + e.message); }
  if (mode === "full") {
    const acc = (await db.get("insights/ig_account")) || {};
    if (!acc.audienceAt || NOW - acc.audienceAt > 20 * 36e5) { try { au = await audience({ db, IG, igId: link.igId, NOW, say }); } catch (e) { say("warning", "Audience: " + e.message); } }
  }
  const ig = out.report.ig || {};
  say("notice", `${mode === "full" ? "Full" : "Quick"} refresh for @${link.username || link.igId}: ${ig.updated || 0} posts updated, ${ig.added || 0} new` +
    `${cv ? `, ${cv.saved} covers saved` : ""}${au ? ", audience updated" : ""} · ${IG.calls()} Instagram calls${IG.usage() ? ` (Meta limit used: ${IG.usage()}%)` : ""} · ${Math.round((Date.now() - t0) / 1000)}s · ${laISO(NOW)}` +
    (out.errs.length ? ` · missing: ${out.errs.join("; ")}` : ""));
}

main().catch(e => { say("error", e && (e.stack || e.message) || String(e)); process.exit(1); });
