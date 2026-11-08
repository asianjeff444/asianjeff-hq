// Talks to Supabase with the project's secret key (server only, never in the app): documents, the private
// Instagram-key row, and photo uploads. Plain fetch, no packages.
// New secret keys (sb_secret_...) go on the apikey header only; an older service_role key (a JWT) also goes on Authorization.
export function store({ url, key, fetchFn = fetch }) {
  const base = String(url || "").replace(/\/+$/, "");
  const H = /^sb_/.test(key) ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
  const parentOf = p => p.split("/").slice(0, -1).join("/");
  async function req(method, path, { body, headers = {}, raw = false } = {}) {
    const res = await fetchFn(base + path, { method, headers: { ...H, ...headers }, body });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} → ${res.status} ${t.slice(0, 200)}`), { status: res.status });
    }
    if (raw) return res;
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    async get(path) {
      const rows = await req("GET", `/rest/v1/docs?select=data&path=eq.${encodeURIComponent(path)}`);
      return rows && rows[0] ? rows[0].data : undefined;
    },
    async put(path, data) {
      await req("POST", "/rest/v1/docs?on_conflict=path", {
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ path, parent: parentOf(path), data: JSON.parse(JSON.stringify(data ?? {})), updated_at: new Date().toISOString() }])
      });
    },
    // the private row that keeps his Instagram key (table ig_link: only this secret key can read or write it)
    async link() {
      const rows = await req("GET", "/rest/v1/ig_link?id=eq.1&select=*");
      return rows && rows[0] ? rows[0] : null;
    },
    async saveLink(patch) {
      await req("POST", "/rest/v1/ig_link?on_conflict=id", {
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: 1, ...patch, updated_at: new Date().toISOString() }])
      });
    },
    // a photo in the private "assets" bucket (the app gets short-lived links to it after sign-in)
    async upload(id, bytes, type) {
      await req("POST", `/storage/v1/object/assets/${encodeURIComponent(id)}`, {
        headers: { "Content-Type": type || "application/octet-stream", "x-upsert": "true", "cache-control": "3600" }, body: bytes
      });
    }
  };
}

// the Supabase project address, read from app/config.js (so it isn't needed as a secret)
export function urlFromConfig(text) {
  const m = String(text || "").match(/url\s*:\s*["'](https:\/\/[^"']+)["']/);
  return m && !/YOUR-PROJECT/i.test(m[1]) ? m[1] : "";
}
