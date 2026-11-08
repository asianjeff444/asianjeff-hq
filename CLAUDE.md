# Technical map (for Claude)

Read `START-HERE.md` first (setup + habits) and `RULES.md` (what the app does, in plain words).
**Every change: update this file and RULES.md in the same go.**

## Files

| Path | What it is |
|---|---|
| `source/app.html` | **The whole app**, one page written as a Claude artifact (no html/head wrapper). Publish it as an artifact with `capabilities: {db: {}}` for previews; build from it for the phone. |
| `scripts/build_app.py` | `python3 scripts/build_app.py [page.html]` → `app/index.html` + `app/version.json`; renames `app/manifest.webmanifest` after the page's `<title>`. |
| `app/` | What GitHub Pages serves (and nothing else): `index.html` (built), `runtime.js`, `config.js`, `manifest.webmanifest`, icons (180/192/512 px), `version.json`. |
| `app/runtime.js` | Phone app only: sign-in screen, Supabase-backed `window.claude.use("db")`, photo links (`window.__APP_BLOB(id)`), `use("app")` (signOut, email), `use("assets")` (upload). |
| `app/config.js` | Supabase project URL + **publishable** key (public by design). |
| `supabase/setup.sql` | Run once in Supabase's SQL Editor (safe to re-run): tables `docs`, `app_users`, `ig_link`; function `is_app_user()`; bucket `assets`; row-level security; explicit table grants (Supabase projects made after May 2026 don't open new tables to the app by themselves); realtime. Tested on Postgres 16: the owner reads/writes, a second login sees nothing, the app can't see `ig_link`. |
| `.github/workflows/pages.yml` | Deploys `app/` on every push that touches it. |
| `.github/workflows/insights.yml` | Instagram refresh, cron `7,22,37,52 * * * *` (MODE auto), or by hand with mode quick/full. Secrets: `SUPABASE_SECRET_KEY`, `IG_TOKEN`. Keeps itself alive with an empty commit after ~50 quiet days. |
| `scripts/refresh-insights.mjs` | The refresh runner (Node 22, no packages). |
| `private-repo/` | Template for the **private** repo (Sponsors): `SPONSOR-STYLE.md`, `SPONSORS-TASK.md`, `scripts/apply-queue.mjs`, `.github/workflows/apply.yml`, `queue/`, `mirror/`. Ignored by this public repo. |
| `scripts/insights/` | `store.mjs` (Supabase REST + storage with the secret key), `token.mjs` (which key, which account, renewal), `ig-graph.mjs` (Instagram Graph API calls), `build.mjs` (turns answers into the two Insights documents), `covers.mjs` (covers, account counts, audience). |

## Data (Supabase table `docs`: path → JSON)

| Document | Shape | Written by |
|---|---|---|
| `meta/app` | `{name}` | Settings |
| `meta/categories` | `{list:[{id, name, emoji, color}]}`; colors are keys of `COLORS` in the page. Missing → the page shows `DEFAULT_CATS` (Category 1-3, ids c1-c3) without writing them. | Tile editor |
| `ideas/<id>` | `{title, details, links[], cat, done, doneAt, createdAt, updatedAt}` | Home box, tile pages, idea sheet |
| `todos/<id>` | `{t, d?, done, doneAt, createdAt, g (card group key), gBy auto/me/claude, gAt, on? "YYYY-MM-DD", onAt, onBy me/plan/none/claude, dueAt? (ms), urgent?, urgentAt?}` | Home + Life (LF.add, the to-do sheet, the planner) |
| `meta/todo-groups` | `{names:{key:name}, emo, custom:{key:{n,e,at}}, alias:{from:to} (merges), learn:{word:{g,at}} (≤400), pins:[key]}` | Life (moving, renaming, merging, pinning cards) |
| `sponsors/<id>` | id `t<Gmail thread id>`: `{brand, contact, email, subject, gist, offer, value, deliverables, deadline, summary, lastId, lastAt, lastFrom, threadUrl, risk:{level none/caution/danger, why}, draft:{subject, body, at, edited?}, status new/waiting/replied/skipped, statusBy, statusAt, by, updatedAt}` | the Sponsors scheduled task (via the private repo's queue); the app writes status + edited drafts |
| `insights/ig_account` | `{days:[{d, v, vw, lt, fo, un, nt, f, fv, nfv}], periods:{7,14,30,60,90,180}, followersNow, audience?, audienceAt?, tz, updatedAt}` (Los Angeles days) | refresh job only |
| `insights/ig_posts` | `{posts:[{id "m<media id>", mid, type reel/post/story, date, title, cap, url, sc, views, viewers, likes, comments, shares, saves, reposts, follows, visits, replies, detail?}], hires:{<post id>: <photo id>}, counts:{media, follows, followers, pic, user, name, bio, web}, ideaId? per post}` | refresh job (+ the page writes `ideaId` when a post is linked to an idea) |
| `insights/sync` | `{at (last full), quickAt, report, errs, lastErr, lastErrAt, igAccount, igDailyTo}` | refresh job |
| `insights/ig_cache`, `insights/ig_covers` | finished days' numbers / cover tries | refresh job only |

Private (only the secret key): table `ig_link` (row id 1) = the Instagram key `{token, seed, host, ig_id, username, kind, refreshed_at, expires_at, err}`. Storage bucket `assets`: covers `md5("ig-cover|"+media id)`, profile pictures `md5("ig-avatar|"+file name)`.

Inside Claude the page uses the artifact's own database (test data). The real data is only in Supabase.

## The page (`source/app.html`)

- Order: `<title>`, fonts (Google Fonts: Bricolage Grotesque, Geist), `<style>` (the app's look, then the Insights replica's CSS), markup (`#topbar`, `#view`, `#sheetRoot`), one `<script>`: the `IG` module (Insights replica), then the app.
- State `S` (page `home` | `cat` | `insights`, `cat` id, `ideas`, `todos`, `catsDoc`, `app`, `sync`, `sheet`, `editTiles`…). `render()` draws `#topbar` + `#view`; `drawSheet()` draws the bottom sheet (`S.sheet = {kind: idea|todo|tile|settings, id}`).
- Taps: one document click handler with `data-go` (`home`, `insights`, `cat:<id>`), `data-act`, and a few `data-*` keys; forms by id (`capForm`, `todoForm`, `ideaForm`, `linkForm`); sheet text saves on `change`.
- Data: `openDB()` = `window.claude.use("db")` (Claude or the phone app), else a localStorage stand-in (`localDB`, key `starter-app-data`) so the file also works opened by itself. `save(path, data)` always writes whole documents (the artifact database's `update` refuses missing documents).
- Routes: `#insights`, `#cat-<id>` (replaceState, no history).
- Status bar: `barColor()` sets `theme-color` and a hidden fixed `.ins-edge` strip (iOS reads the color from it); `html.pwa-opaque` = home-screen app with a solid status bar.

## Life (smart to-dos): `DUE`, `UC`, `LF`, `DR`, `PL` modules in the script

- Ported from the friend's own app (minus anything personal). Page id `life` (`#life`), drawn by `LF.view()` (tip, calendar `UC.box()`, card deck, add box), `LF.after()` after each draw; `render()` waits while `LF.busy()` (a card is flying).
- `DUE.parse(text)` → `{t (date words cut out), on, at "HH:MM"}`; `DUE.ms(on, at)`; `DUE.fmt`; `DUE.left` (countdowns ticking every 20 s).
- `LF.classify(t, d)`: keyword patterns per group (`LIB`, weights, a lead verb +3), learned words (+4), words of names he gave groups (+4); details count half; 0 → Other. `LF.autoSort()` gives a group to to-dos without one (once). Moving one teaches `learn`.
- Sheets: `openSheet("__td:<id>")` (to-do: title, details, urgent, day chips + date + time, group chips, new group, Done, Delete) and `"__tg:<key>"` (group: rename, merge, split). The page's sheet layer draws them (`S.sheet.kind === "life"`, `S.open` = the id, container `#sheet`).
- `UC` = calendar + add box (`#todoForm`, `#todoIn`, 🚨 `#todoUrg`); `DR.open(day)` = the day rundown overlay `#dayRun` (its own add box `#drForm`); `PL.kick()` (end of every `render()`) runs the planner when something needs a day (14 days, capacity 5 per day, sizes quick 1 / errand 2 / big 3, batches calls and errands).
- Their CSS: the "Life" block in the `<style>` (`.lf-*`, `.dk-*` deck, `.ucal*` calendar, `.ud` dots, `.dr*` rundown, `.todo`, `.urgbtn`, `.addtodo`).

## Sponsors

- Page id `sponsors` (`#sponsors`): `spTile()` on Home, `spView()` (Waiting on you; Replied + Skipped under Show), `spSheet()` (facts, scam banner, editable reply `#spDraft`, Open in Gmail = `googlegmail:///co?to&subject&body`, Copy, Use another mail app = `mailto:`, I replied / Skip / Bring it back).
- Filled by a Claude **scheduled task** twice a day that follows `SPONSORS-TASK.md` in the **private** repo (made from `private-repo/` in this kit, never pushed to the public repo): it reads Gmail (read-only), checks for scams, drafts replies from `SPONSOR-STYLE.md`, writes `queue/*.json`, pushes. The private repo's workflow (`apply.yml` → `scripts/apply-queue.mjs`, secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY`) saves `sponsors/*` and `todos/*` writes (`set` / `update` = merge on top / `delete`), refreshes `mirror/sponsors.json` (light fields only: status, lastId…) and clears the queue; it also runs every 3 hours to refresh the mirror.
- Status rule: the task only sets `status` when the email thread changed (new thread → new, his reply newest → replied, new message from them → waiting + a new draft), so his Skip / Replied taps stick.

## The Insights replica (`IG` module + CSS scoped to `.ins-page` / `.ig`)

- A copy of a hand-measured replica of Instagram's Insights (Home / Performance / Content / Audience tabs, post pages with carousel, sheets, menus, periods 7-180 days and custom dates). Only the real-numbers version is included.
- API: `IG.view()` → HTML, `IG.afterRender()`, `IG.onClick(e)` (returns true when it handled the tap), `IG.leave()`, `IG.refresh()`, `IG.mounted()`, `IG.setAccount(doc)`, `IG.setPosts(doc)`, `IG.setFS(bool)`, `IG.st`, `IG.D`, `IG.thumb(post, w, h, hires)`.
- It calls the page's globals: `S` (ideas for "Link this post to an idea", `S.db`), `toast()`, `go("home")`, `render()`, `barColor()`, `SYNC.line()` (the "Updated 5 min ago" line), `window.openSheet(ideaId)`.
- Full screen: double-tap the back arrow on the dashboard hides the top bar (X / Instagram / updated line); one tap brings it back. X → home.
- Covers: `IG` draws `insights/ig_posts.hires[post id]` with `BLOB(id)` = `"/_blob/"+id` in Claude; the build swaps that for `window.__APP_BLOB(id)` (signed Supabase links).
- Audience tab: gender, ages, countries, cities come from Instagram (needs 100+ followers). Languages and active times aren't in Instagram's API, so those sections stay empty.

## The Instagram refresh (`scripts/refresh-insights.mjs`)

1. Secrets: `SUPABASE_SECRET_KEY` (sb_secret_… on the `apikey` header; an old service_role JWT also works), `IG_TOKEN`. Supabase URL read from `app/config.js`. Missing either → exits quietly (no red runs).
2. Key (`token.mjs`): a new `IG_TOKEN` (different sha256 "seed") replaces the saved one; detects Instagram Login keys (`graph.instagram.com/me?fields=user_id,username`) or Facebook/Business keys (`me/assigned_instagram_accounts`, then `me/accounts{instagram_business_account}`); renews Instagram Login keys every ~20 days (`refresh_access_token`) and keeps the new one in `ig_link`.
3. MODE auto: `full` when there's no `ig_account` yet or the last full run is ~6 h old, else `quick` (posts from the last 75 days).
4. Full: daily views/reach/link taps (a year the first time, then the last week), follows/unfollows (28 days), views by follower × type and interactions by type (180 days), accounts reached 7/14/30 days (+ previous period), every post with its insights; finished days cached in `insights/ig_cache`. Then covers (≤ 120) + account counts, audience once a day.
5. Quick: posts list + insights (75 days), covers (≤ 15) + counts.
6. Instagram errors → `insights/sync.lastErr` (shown in the app); a dead key (error 190) → "Your Instagram key stopped working…". The run itself stays green unless the code crashes.
7. The documents match the original app's refresh byte for byte (tested against the same fake Instagram).

## Build + deploy

`python3 scripts/build_app.py` → commit `app/index.html` + `app/version.json` (+ anything else changed) → push `main` → Pages deploys `app/` (~1 min). The page checks `version.json` (no-store) on open / return and reloads once at `?v=<new>` when a newer build is live.
