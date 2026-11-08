#!/usr/bin/env python3
"""Turn the app page into app/index.html for the home-screen app.

Usage:  python3 scripts/build_app.py              (builds from source/app.html)
        python3 scripts/build_app.py <page.html>  (builds from another copy, e.g. the artifact's HTML saved from Claude)

Run it every time the page changes, then commit + push app/ (index.html AND version.json).
The page is the same file Claude shows as an artifact; this adds what the phone app needs:
  - the home-screen bits (name, icon, full screen), named after the page's <title>
  - Supabase + app/config.js + app/runtime.js (sign-in and your data)
  - the self-update check (version.json)
"""
import re, sys, pathlib, hashlib, json, html

root = pathlib.Path(__file__).resolve().parent.parent
src_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "source" / "app.html"
src = src_path.read_text(encoding="utf8")

title_m = re.search(r"<title>(.*?)</title>", src, re.S | re.I)
NAME = html.unescape(title_m.group(1).strip()) if title_m else "My HQ"

# Version stamp: changes whenever the page, the runtime, the config or this script changes.
_h = hashlib.sha1(src.encode("utf8"))
for f in ("app/runtime.js", "app/config.js", "scripts/build_app.py"):
    _h.update((root / f).read_bytes())
VER = _h.hexdigest()[:12]

# Self-update: an installed home-screen app can keep showing an old copy. On every open / return to the app it asks
# version.json (never cached) whether a newer build is live; if so it reloads once at a fresh address (?v=<new>).
UPDATER = """
<script>
window.__APP_VER="@VER@";
(function(){
  var V=window.__APP_VER,busy=false,last=0;
  function check(){
    if(busy||Date.now()-last<15000)return;last=Date.now();busy=true;
    fetch("version.json?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){busy=false;
      if(!j||!j.v||j.v===V)return;
      var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA)$/.test(a.tagName)){last=0;return;}
      var k="app-upd-"+j.v;try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,"1");}catch(e){}
      location.replace(location.pathname+"?v="+j.v+location.hash);
    }).catch(function(){busy=false;});
  }
  check();
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")check();});
  addEventListener("pageshow",function(e){if(e.persisted)check();});
})();
</script>""".replace("@VER@", VER)

HEAD = UPDATER + """
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="@TITLE@">
<meta name="theme-color" content="#0C0C10">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js"></script>
<script src="config.js?v=@VER@"></script>
<script src="runtime.js?v=@VER@"></script>
""".replace("@VER@", VER).replace("@TITLE@", html.escape(NAME))

if re.search(r"<head(?:\s[^>]*)?>", src, re.I):
    # a whole document (e.g. the artifact's HTML read back from Claude): add our bits right after <head>
    out = re.sub(r"<head(?:\s[^>]*)?>", lambda m: m.group(0) + HEAD, src, count=1, flags=re.I)
    # Claude's page wrapper paints a white body before the page's own styles arrive: make that first paint dark
    out = re.sub(r"(<style>[^<]*?body\{[^}]*?)background:#fff;color:#000\}", r"\1background:#0C0C10;color:#F5F5F8}", out, count=1)
else:
    # the page as written for Claude (title, styles, markup, script): wrap it in a document
    out = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
           '<style>html,body{background:#0C0C10;color:#F5F5F8}</style>' + HEAD + '</head>\n<body>\n' + src + '\n</body>\n</html>\n')

# Photos: inside Claude they're served at /_blob/<id>; the app gets signed Supabase links instead.
out, n = re.subn(r'"/_blob/"\+encodeURIComponent\(id\)', 'window.__APP_BLOB(id)', out)
left = out.count("/_blob/")
print(f"photo links patched: {n}; left over: {left}")
assert left == 0, "a /_blob/ link pattern changed: update build_app.py"

# Claude-only meta tag; harmless elsewhere but drop it.
out = out.replace('<meta name="claude:viewport-fit-sides" content="cover">', "")
# an app, not a web page: no pinch / focus zoom
out = re.sub(r'(<meta name="?viewport"? content="[^"]*?)"', lambda m: m.group(1) + ('' if 'maximum-scale' in m.group(1) else ',maximum-scale=1,user-scalable=no') + '"', out, count=1)

(root / "app").mkdir(exist_ok=True)
(root / "app" / "index.html").write_text(out, encoding="utf8")
(root / "app" / "version.json").write_text(json.dumps({"v": VER}) + "\n", encoding="utf8")

# the home-screen name follows the page's <title>
mf = root / "app" / "manifest.webmanifest"
m = json.loads(mf.read_text(encoding="utf8")) if mf.exists() else {}
m.update({"name": NAME, "short_name": NAME[:12]})
mf.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

print("name:", NAME, "· version", VER)
print("wrote app/index.html", len(out), "bytes + app/version.json")
