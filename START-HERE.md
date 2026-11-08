# START HERE (for Claude)

Hi Claude. Your person just handed you this kit. It's a **starter version of a home-screen app**, built by a friend from his own personal app and cleaned up so your person can make it theirs. Your job: get it running on their iPhone, then keep building it with them.

Read this whole file first. Then read `CLAUDE.md` (the technical map) and `RULES.md` (what the app does, in plain words).

---

## What they're getting

A dark, simple iPhone app (it lives on the home screen like a real app) with:

- **Home screen:** a box to type or paste ideas, an **Insights** card, a **Sponsors** card, a **To-dos** card, and **tiles** called "Category 1, 2, 3". They rename the tiles, pick an emoji and a color, add new tiles or delete them (tap **Edit** above the tiles).
- **Tile pages** that slide in: the ideas saved in that tile. Tap an idea for details, links, moving it to another tile, marking it done.
- **Life (smart to-dos):** type a to-do like "dentist Friday 3pm" and it lands on that day with the time. Every to-do sorts itself into a card (money, appointments, car, shopping…), and it learns when they move one. Cards stack and swipe. A calendar (week or month) shows dots per day; tap a day for that day's rundown. To-dos with no day get spread over the next two weeks by a planner, a few per day. 🚨 marks urgent ones.
- **Sponsors:** brand-deal emails from their Gmail, read by you (a Claude scheduled task, twice a day). Each card shows the brand, the offer and a scam check, plus a reply drafted in **their own style** (their rates, tone and sign-off from `SPONSOR-STYLE.md`). They tap "Open in Gmail" to send it. You never send email yourself.
- **Insights:** a replica of Instagram's own Insights screens (Home, Performance, Content, Audience, and every post's insights), filled with **their real Instagram numbers**, pulled automatically with **their own** Instagram key every 15 minutes.
- **Settings** (gear icon): the app's name, the Instagram connection status, sign out.
- **Sign-in:** only their own login gets in. The app remembers them.
- **Self-updating:** when you push a new version, the phone picks it up the next time they open the app.

---

## How it works (the setup)

```
  source/app.html  ──(publish)──▶  Claude artifact (preview inside Claude, its own test data)
        │
        └─(scripts/build_app.py)─▶ app/index.html ──(git push)──▶ GitHub Pages ──▶ iPhone home-screen app
                                                                                       │
                                                       Supabase (sign-in + database + photos) ◀┘
                                                              ▲
   GitHub Actions, every 15 min: scripts/refresh-insights.mjs ┘  (their Instagram key → their numbers)
```

- **The whole app is one file:** `source/app.html`. It's written as a Claude artifact page (title + styles + markup + script, no `<html>`/`<head>` wrapper).
- **Preview:** publish `source/app.html` as an artifact with the `db` capability (`capabilities: {db: {}}`). Inside Claude it saves to the artifact's own little database: that's **test data**, not their real data.
- **The real app:** `scripts/build_app.py` turns the page into `app/index.html` (adds the home-screen bits, Supabase, sign-in, the update check). GitHub Pages serves the `app/` folder. On the phone, `app/runtime.js` gives the page the same `window.claude.use("db")` it has in Claude, but backed by Supabase, so the page code is identical in both places.
- **Data:** Supabase (free). One table `docs` (path → JSON), a private photo bucket `assets`, and a guest list `app_users` (only their login). See `supabase/setup.sql`.
- **Private repo (Sponsors):** a second, **private** GitHub repo made from `private-repo/` in this kit: their reply style, your twice-a-day Sponsors steps, and a `queue/` you drop changes into (a workflow saves them to Supabase). Email details never go in the public repo.
- **Instagram numbers:** a GitHub Actions job (`.github/workflows/insights.yml` → `scripts/refresh-insights.mjs`) calls Instagram's API with **their own** key and saves the numbers as documents the Insights page reads. Quick refresh every 15 minutes, full refresh every 6 hours.

---

## How you work with them (please keep these habits)

1. **Plain words.** No jargon. Short messages. Bullet points when listing things.
2. **One step at a time.** In any walkthrough, give ONE step, with a **direct link** to the exact page, then wait for them to say "done" before the next step.
3. **"Build it" means the whole loop:** change `source/app.html` → publish the artifact (same artifact every time, so the link stays) → `python3 scripts/build_app.py` → commit + push to `main` (include `app/index.html` AND `app/version.json`) → tell them it's live. Their phone updates itself next time they open the app (if not, close it fully and reopen).
4. **Keep the two notes files current, in the same go as every change:**
   - `RULES.md` = every rule of the app in plain words (what it does, when, why). New or changed rules go in; replaced rules come out.
   - `CLAUDE.md` = the technical map (files, data documents, how things connect) for future Claude chats.
5. **Before changing anything, read the latest page.** If they changed the artifact from another chat, read it back (Artifact tool, action "read"), keep its content as `source/app.html` (the build accepts either the bare page or the full document Claude gives back), then make your change.
6. **Secrets never go in the app or the repo.** The Supabase *publishable* key in `app/config.js` is fine (it's meant to be public; sign-in protects the data). The Supabase *secret* key and the Instagram key only live in GitHub's secrets.
7. **Leave the Insights replica's look alone** unless they ask: it's measured to match Instagram's app exactly (everything scoped under `.ins-page` / `.ig` in the CSS, and the `IG` module in the script).
8. **Test before you push.** Open the page (or the built app) in a headless browser if you can, click through what you changed, and look at a screenshot.

---

## First-time setup (walk them through it, one step at a time)

Ask them first: **"What do you want to call your app?"** Put that name in the `<title>` at the top of `source/app.html` (it becomes the name under the home-screen icon; they can also change the name shown inside the app from Settings).

Also find out early whether **you can push to GitHub** in this chat (a GitHub connection or tool). If you can, you'll create the files in their repo yourself. If you can't, ask them to connect GitHub to Claude (claude.ai → Settings → Connectors → GitHub) or, as a last resort, walk them through uploading the files on github.com. Note that the `.github` folder is hidden on Macs (Cmd+Shift+. shows it); on github.com they can also make each workflow file with "Add file → Create new file" and paste the contents.

### Part 1: GitHub (where the app lives)

1. **Make a free GitHub account** (skip if they have one): https://github.com/signup
2. **Make the repo:** https://github.com/new
   - Name it after the app (lowercase, dashes, e.g. `my-hq`).
   - Set it to **Public** (free GitHub Pages needs a public repo; only the code is public, never their data or keys).
   - Don't add a README (the kit has one).
3. **Put this kit's files in the repo** (everything in this folder, including `.github/`), on the `main` branch. Run `python3 scripts/build_app.py` first so `app/index.html` has their app name.
4. **Turn on GitHub Pages:** `https://github.com/<user>/<repo>/settings/pages` → under "Build and deployment", Source = **GitHub Actions**.
   - The "Put the app online" workflow runs on the next push to `app/` (or run it by hand in the Actions tab).
   - The app's address: `https://<user>.github.io/<repo>/`

### Part 2: Supabase (sign-in + their data)

5. **Make a free Supabase account:** https://supabase.com/dashboard/sign-up ("Continue with GitHub" is easiest).
6. **Make a project:** https://supabase.com/dashboard/new
   - Any name, a database password (have them save it somewhere safe), the region closest to them.
   - Wait about a minute for it to finish.
7. **Make their login:** Authentication → Users → **Add user** → **Create new user**: their email + a password, and turn **Auto Confirm User** on.
   Link: `https://supabase.com/dashboard/project/<ref>/auth/users` (`<ref>` is the code in their project's address; before you know it, `/project/_/` works and asks them to pick the project).
8. **Turn off sign-ups** (so nobody else can make a login): Authentication → Sign In / Providers → turn off **Allow new users to sign up** → Save.
   Link: `https://supabase.com/dashboard/project/<ref>/auth/providers`
9. **Set up the database:** SQL Editor → New query → paste ALL of `supabase/setup.sql` → **Run**. It should say "Success. No rows returned."
   Link: `https://supabase.com/dashboard/project/<ref>/sql/new`
   (It must run after step 7: its last line adds their login to the app's guest list. Running it again is safe.)
10. **Connect the app to the project:** get two values and put them in `app/config.js`:
    - **Project URL:** Project Settings → Data API (`https://supabase.com/dashboard/project/<ref>/settings/api`)
    - **Publishable key** (`sb_publishable_...`): Project Settings → API Keys (`https://supabase.com/dashboard/project/<ref>/settings/api-keys`)
    Then build + push. (Never the secret key here.)

### Part 3: On the iPhone

11. **Add it to the home screen:** open `https://<user>.github.io/<repo>/` in **Safari** → Share button → **Add to Home Screen** → Add.
12. **Open it from the home screen and sign in** with the login from step 7. They should see the home screen with Category 1, 2, 3.

### Part 4: Instagram Insights (their real numbers)

Their Instagram must be a **Creator or Business account** (free): Instagram app → Settings → Account type and tools → Switch to professional account. And it must be **public**.

13. **Meta developer account:** go to https://developers.facebook.com/apps and log in with Facebook (if Meta asks them to register as a developer, follow its steps).
14. **Create a Meta app** (it's just for them, it never needs Meta's review): https://developers.facebook.com/apps/creation/
    - Use case: the Instagram one (**Manage messaging & content on Instagram**) if Meta lists it; otherwise **Other** → app type **Business**.
    - Name it after their app → create. If it asks to connect a business portfolio, they can skip it.
    - (Meta moves things around. If the screens differ, follow Meta's current guide: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram )
15. **Add Instagram:** in the app's dashboard, find the **Instagram** product → **Set up** → **API setup with Instagram login**.
    - Make sure the permissions include **instagram_business_basic** and **instagram_business_manage_insights** (they're on by default).
16. **Make their key:** in **API setup with Instagram login** → **1. Generate access tokens** → **Add account** → log in to their Instagram → back in the list, tap **Generate token** next to their account → copy the token.
    - If Meta says the account needs a tester role: App roles → Roles → **Add People** → **Instagram Tester** → their username; then accept it in Instagram (Settings → Website permissions → Apps and websites → Tester invites, or https://www.instagram.com/accounts/manage_access/ ), then try again.
    - Keep the token private: it goes only into GitHub's secrets (next step). This key is theirs alone; never reuse anyone else's.
17. **Save the two secrets in GitHub:** `https://github.com/<user>/<repo>/settings/secrets/actions/new` → add each one:
    - Name `IG_TOKEN` → the Instagram token from step 16.
    - Name `SUPABASE_SECRET_KEY` → Supabase's secret key: Project Settings → API Keys → **Secret keys** → create/reveal one, copy it (`sb_secret_...`). Link: `https://supabase.com/dashboard/project/<ref>/settings/api-keys`
18. **Run the first refresh:** `https://github.com/<user>/<repo>/actions/workflows/insights.yml` → **Run workflow** → mode `full` → Run.
    - The first full refresh reads a year of daily numbers, so give it a few minutes. Then open the app → tap **Insights**.
    - After that it runs by itself: every 15 minutes (posts), with a full refresh every 6 hours (charts, followers, audience). The key renews itself every ~20 days.

### Part 5: Sponsors (brand deals from their Gmail)

Everything here goes in a **separate private repo**, because it touches their email. Never put it in the public app repo (`private-repo/` is already in the public repo's `.gitignore`).

19. **Make the private repo:** https://github.com/new → name it `<app repo>-private` → **Private** → create. Put the contents of this kit's `private-repo/` folder in it (push it yourself, or walk them through uploading).
20. **Give it the two secrets:** `https://github.com/<user>/<repo>-private/settings/secrets/actions/new`
    - `SUPABASE_URL` → the Project URL from step 10
    - `SUPABASE_SECRET_KEY` → the same secret key as step 17
21. **Their reply style (ask one question at a time, in plain words, then write `SPONSOR-STYLE.md` in their words and push it):**
    - "What do you charge? For one TikTok, one Reel, both, and a bundle of a few?"
    - "What's the lowest you'd take, and what should I say when an offer is too low?"
    - "How do you want to sound? Short or detailed, chill or professional, funny? 'I' or as your management 'we'?"
    - "How do you sign off?"
    - "Anything to always say (thank them, ask for the brief, offer your stats) or never say?"
    - "Got a reply you've sent before that you liked? Paste it and I'll match it."
    Read the whole file back to them in a few bullets and fix anything they want. Later, whenever they say "change how my replies sound" or "my rates are now…", update `SPONSOR-STYLE.md` and push it.
22. **Connect their Gmail to Claude:** https://claude.ai/settings/connectors → **Gmail** → Connect → pick the Gmail that gets brand deals → Allow.
23. **Make the scheduled task** (call it a "scheduled task" when you talk to them): twice a day (for example 8:37 AM and 6:37 PM their time), named "Sponsors refresh", with this prompt:
    `Run the Sponsors refresh: follow SPONSORS-TASK.md in the GitHub repo <user>/<repo>-private (pull it first; you can read Gmail and push to that repo; never send email).`
    Make sure its runs can use the Gmail connector and push to the private repo (some setups ask to approve this once).
24. **Run it once now** and check the app's **Sponsors** card. The first run looks back 30 days.

You can also add to-dos for them from any chat: drop a batch in the private repo's `queue/` with `{"op":"set","path":"todos/<new id>","data":{"t":"…","done":false,"doneAt":null,"createdAt":<ms>,"on":"YYYY-MM-DD"?,"dueAt":<ms>?}}` and push. The app sorts it into a card by itself.

25. **Show them the loop:** "Tell me what you want to change, I'll build it, and your app updates itself next time you open it."

---

## When something's off

- **The app says it isn't hooked up to its database:** `app/config.js` still has the placeholders (step 10), or the build wasn't pushed.
- **"This login isn't on the app's guest list"** or **"permission denied for table docs"**: run `supabase/setup.sql` again (step 9) after making the login (step 7). It's safe to run any number of times.
- **Insights is empty:** check the latest run of the "Instagram refresh" workflow in the Actions tab. Its notes (yellow/blue lines) say what happened. No `IG_TOKEN` yet = nothing to do; Instagram errors are also shown on the Insights page (the line under its top bar) and in Settings.
- **"Your Instagram key stopped working":** make a new token (step 16) and replace the `IG_TOKEN` secret, then run the workflow.
- **Changes don't show on the phone:** check the "Put the app online" workflow finished, then fully close and reopen the app. `app/version.json` must be pushed with `app/index.html`.
- **The 15-minute refresh stopped:** GitHub pauses schedules in repos with no commits for 60 days; the workflow makes an empty commit every ~50 quiet days to prevent that. If it's paused anyway, the Actions tab has an "Enable workflow" button.
- **Sponsors is empty:** run the scheduled task by hand and read what it says; check the private repo's "Apply to the app" workflow ran (Actions tab) and that its two secrets are set. Gmail must be connected in Claude's settings.
- **A to-do landed in the wrong card:** they move it once (tap it → Group); similar to-dos follow from then on.
- **Supabase free projects pause after a week with no activity.** The Instagram refresh keeps it active. Without Instagram connected, opening the app every few days does.

---

## Ideas for what to build next (only when they ask)

- Their own icon (replace `app/icon-180.png`, `icon-192.png`, `icon-512.png`; same sizes).
- Due dates or reminders on to-dos, a calendar, photo uploads on ideas (`window.claude.use("assets")` works in the app).
- A different look: colors live in the `:root` variables at the top of the `<style>` in `source/app.html`.
