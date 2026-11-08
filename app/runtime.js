/* The home-screen app's link to Supabase: sign-in, your data, photo links.
   It gives the page the same window.claude.use("db") it has inside Claude, backed by Supabase instead,
   so the page's code is the same in both places.
   Data: one table, public.docs (path, parent, data). Photos: the private "assets" bucket.
   Who gets in: only logins listed in public.app_users (see supabase/setup.sql). */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const configured = !!(CFG.url && CFG.key && !/YOUR-PROJECT|PASTE-YOUR/i.test(CFG.url + CFG.key) && window.supabase);
  window.__APP_RUNTIME = true;
  const NAME = () => (document.title || "My HQ");

  /* ---------- photo links: the page asks for a photo by its id, it gets a signed link (or a blank pixel until the link arrives) ---------- */
  const blobs = Object.create(null);
  let blobsReady = false, wantT = 0;
  const wanted = new Set(), askedAt = Object.create(null);
  function want(id) {
    if (!blobsReady || !/^[0-9a-f]{32}$/.test(id) || wanted.has(id) || Date.now() - (askedAt[id] || 0) < 6e5) return;
    wanted.add(id); clearTimeout(wantT); wantT = setTimeout(fetchWanted, 250);
  }
  async function fetchWanted() {
    const ids = [...wanted]; wanted.clear(); ids.forEach(i => { askedAt[i] = Date.now(); });
    try {
      const { data } = await sb.storage.from("assets").createSignedUrls(ids, 60 * 60 * 24 * 30); let n = 0;
      (data || []).forEach(r => { if (r && r.signedUrl && r.path && !blobs[r.path]) { blobs[r.path] = r.signedUrl; n++; } });
      if (n) window.dispatchEvent(new Event("app-blobs"));
    } catch (e) {}
  }
  window.__APP_BLOB = id => blobs[id] || (want(String(id || "")), PIXEL);

  const sb = configured ? window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "app-auth" }
  }) : null;

  /* ---------- screens before the app: sign in / not set up / not allowed ---------- */
  const STYLE = `<style>
#app-gate{position:fixed;inset:0;z-index:2147483647;background:#0C0C10;color:#F5F5F8;display:flex;align-items:center;justify-content:center;
  padding:calc(env(safe-area-inset-top,0px) + 24px) 22px calc(env(safe-area-inset-bottom,0px) + 24px);font-family:"Geist",-apple-system,system-ui,sans-serif}
#app-gate form,#app-gate .box{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px}
#app-gate h1{margin:0 0 6px;font-family:"Bricolage Grotesque","Arial Black",system-ui,sans-serif;font-weight:800;font-size:44px;letter-spacing:-.03em;line-height:1}
#app-gate h1 i{display:inline-block;width:12px;height:12px;border-radius:50%;background:#FF4D8F;margin-left:6px;box-shadow:0 0 14px #FF4D8F}
#app-gate p{margin:0 0 8px;font-size:18px;font-weight:600;color:#D0D0D9;line-height:1.4}
#app-gate input{font:inherit;font-size:19px;font-weight:600;padding:17px 18px;border-radius:18px;border:2px solid #272730;background:#17171D;color:#F5F5F8;outline:0}
#app-gate input:focus{border-color:#FF4D8F}
#app-gate button{font:inherit;font-size:20px;font-weight:800;padding:18px;border:0;border-radius:18px;background:#FF4D8F;color:#fff;margin-top:6px}
#app-gate button.q{background:#202028;color:#F5F5F8}
#app-gate button[disabled]{opacity:.6}
#app-gate .err{color:#FF6A85;font-weight:700;font-size:16px;min-height:22px}
</style>`;
  const nameHTML = () => NAME().replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function bodyReady() { if (document.readyState === "loading") await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true })); }
  async function loginScreen(msg) {
    await bodyReady();
    return new Promise(resolve => {
      const w = document.createElement("div"); w.id = "app-gate";
      w.innerHTML = STYLE + `<form autocomplete="on"><h1>${nameHTML()}<i></i></h1><p>Sign in once. The app remembers you.</p>
  <input name="email" type="email" inputmode="email" autocomplete="username" placeholder="Email" required>
  <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
  <div class="err">${msg || ""}</div><button type="submit">Sign in</button></form>`;
      document.body.appendChild(w);
      const f = w.querySelector("form"), err = w.querySelector(".err"), btn = w.querySelector("button");
      f.addEventListener("submit", async e => {
        e.preventDefault(); btn.disabled = true; btn.textContent = "Signing in…"; err.textContent = "";
        const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (error || !data.session) { err.textContent = "That didn't work. Check your email and password."; btn.disabled = false; btn.textContent = "Sign in"; return; }
        w.remove(); resolve(data.session);
      });
    });
  }
  async function noteScreen(title, text, withSignOut) {
    await bodyReady();
    const w = document.createElement("div"); w.id = "app-gate";
    w.innerHTML = STYLE + `<div class="box"><h1>${title}</h1><p>${text}</p>${withSignOut ? `<button class="q" type="button">Sign out</button>` : ""}</div>`;
    document.body.appendChild(w);
    if (withSignOut) w.querySelector("button").onclick = async () => { try { await sb.auth.signOut({ scope: "local" }); } catch (e) {} location.reload(); };
  }

  /* ---------- a copy of every document on the phone, kept live ---------- */
  const cache = new Map(), docSubs = new Map(), colSubs = new Map();
  const parentOf = p => p.split("/").slice(0, -1).join("/");
  const idOf = p => p.split("/").pop();
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const docSnap = p => { const d = cache.get(p); return { id: idOf(p), exists: d !== undefined, data: () => clone(d) }; };
  function colSnap(par) {
    const docs = [];
    for (const [p, d] of cache) if (parentOf(p) === par) docs.push({ id: idOf(p), exists: true, data: () => clone(d), ref: { path: p } });
    docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  }
  function notify(p) {
    (docSubs.get(p) || []).forEach(cb => { try { cb(docSnap(p)); } catch (e) { console.error(e); } });
    const par = parentOf(p);
    (colSubs.get(par) || []).forEach(cb => { try { cb(colSnap(par)); } catch (e) { console.error(e); } });
  }
  function put(p, d) {
    const before = JSON.stringify(cache.get(p));
    if (d === undefined) cache.delete(p); else cache.set(p, d);
    if (JSON.stringify(d) !== before) notify(p);
  }
  async function loadAll() {
    const seen = new Set(); let from = 0;
    for (;;) {
      const { data, error } = await sb.from("docs").select("path,data").order("path").range(from, from + 999);
      if (error) throw error;
      for (const r of data) { seen.add(r.path); put(r.path, r.data); }
      if (data.length < 1000) break; from += 1000;
    }
    for (const p of [...cache.keys()]) if (!seen.has(p)) put(p, undefined);
  }
  async function loadBlobs() {
    let names = [];
    for (let off = 0; off < 20000; off += 1000) {
      const { data: objs } = await sb.storage.from("assets").list("", { limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } });
      names = names.concat((objs || []).map(o => o.name).filter(n => n && !n.startsWith(".")));
      if (!objs || objs.length < 1000) break;
    }
    for (let i = 0; i < names.length; i += 100) {
      const { data } = await sb.storage.from("assets").createSignedUrls(names.slice(i, i + 100), 60 * 60 * 24 * 30);
      (data || []).forEach(r => { if (r.signedUrl && r.path) blobs[r.path] = r.signedUrl; });
    }
  }
  function realtime() {
    sb.channel("app-docs").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, ev => {
      if (ev.eventType === "DELETE") { if (ev.old && ev.old.path) put(ev.old.path, undefined); }
      else if (ev.new && ev.new.path) put(ev.new.path, ev.new.data);
    }).subscribe();
    // back from the background: catch up on anything missed
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadAll().catch(() => {}); });
  }

  const ready = !configured ? Promise.resolve(false) : (async () => {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) session = await loginScreen("");
    // only logins listed in app_users get in (supabase/setup.sql)
    const { data: ok, error } = await sb.rpc("is_app_user");
    if (error || ok !== true) {
      noteScreen("Almost there", error ? "The database isn't set up yet. Ask Claude to finish the setup." :
        "This login isn't on the app's guest list yet. In Supabase → SQL Editor, run the last line of supabase/setup.sql again, then reopen the app.", true);
      return new Promise(() => {});
    }
    await Promise.all([loadAll(), loadBlobs().catch(() => {})]);
    blobsReady = true;
    realtime();
    return true;
  })().catch(e => { console.error(e); noteScreen("Can't reach the database", "Check your internet, then close and reopen the app.", true); return false; });

  if (!configured) noteScreen(nameHTML(), "This app isn't hooked up to its database yet. Ask Claude to finish the setup.", false);

  /* ---------- the same document API the page uses inside Claude ---------- */
  async function write(p, fn) {
    const prev = cache.get(p), next = fn(clone(prev));
    put(p, next);
    try {
      if (next === undefined) { const { error } = await sb.from("docs").delete().eq("path", p); if (error) throw error; }
      else { const { error } = await sb.from("docs").upsert({ path: p, parent: parentOf(p), data: next, updated_at: new Date().toISOString() }); if (error) throw error; }
    } catch (e) { put(p, prev); throw e; }
  }
  function docRef(p) {
    return {
      id: idOf(p), path: p,
      get: async () => docSnap(p),
      set: data => write(p, () => clone(data)),
      update: data => write(p, prev => ({ ...(prev || {}), ...clone(data) })),
      delete: () => write(p, () => undefined),
      onSnapshot(cb) {
        if (!docSubs.has(p)) docSubs.set(p, new Set());
        docSubs.get(p).add(cb); queueMicrotask(() => cb(docSnap(p)));
        return () => docSubs.get(p).delete(cb);
      }
    };
  }
  function colRef(par) {
    return {
      id: idOf(par), path: par,
      doc: id => docRef(par + "/" + (id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)))),
      get: async () => colSnap(par),
      onSnapshot(cb) {
        if (!colSubs.has(par)) colSubs.set(par, new Set());
        colSubs.get(par).add(cb); queueMicrotask(() => cb(colSnap(par)));
        return () => colSubs.get(par).delete(cb);
      }
    };
  }
  const db = { doc: docRef, collection: colRef };
  const assets = {
    async upload(file) {
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
      const { error } = await sb.storage.from("assets").upload(id, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw error;
      const { data } = await sb.storage.from("assets").createSignedUrl(id, 60 * 60 * 24 * 30);
      if (data && data.signedUrl) blobs[id] = data.signedUrl;
      return { id, url: window.__APP_BLOB(id) };
    }
  };

  window.claude = {
    use: async name => {
      const ok = await ready;
      if (!ok) return null;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "app") return {
        async email() { const { data } = await sb.auth.getUser(); return data && data.user ? data.user.email : ""; },
        async signOut() { try { await sb.auth.signOut({ scope: "local" }); } catch (e) {} location.reload(); }
      };
      return null;
    }
  };
})();
