# InkSprout Store

A fast, static storefront for your ebooks. No framework, no build step —
plain HTML/CSS/JS, backed by a free Google Sheet you edit like a spreadsheet.

```
site/
├── index.html            ← the public storefront
├── admin.html             ← the admin dashboard (password-protected)
├── style.css               ← shared styling (public site)
├── admin.css                ← admin dashboard styling
├── config.js                ← paste your backend URL here (one line)
├── script.js                ← public site: rendering, search, filter, click tracking
├── admin.js                  ← admin dashboard: login, CRUD, analytics chart
├── assets/covers/*.jpg       ← your 4 book covers (already included)
└── apps-script/Code.gs       ← paste into Google Apps Script (backend)
```

**How it works:** the site reads book data from a Google Sheet through a
tiny free API (Google Apps Script). Edit a row in the Sheet — the price,
a link, the preview URL — and the live site updates within about 5
minutes, with no redeploy needed. If the Sheet is ever unreachable, the
site falls back to the sample data baked into `script.js` so it's never
broken or blank. A password-protected admin dashboard (`admin.html`)
gives you a proper interface for all of this, plus click analytics,
instead of editing the spreadsheet by hand — see Step 3.5.

---

## What's on the public site

Beyond listing books, the storefront now includes:

- **Branded preloader** — a short, animated loading screen on first
  visit (minimum 500ms so it never just flickers), then fades out.
- **Scroll-reveal animations** — sections and book cards fade/rise
  into view as you scroll, staggered slightly per card. Skipped
  automatically if the visitor's OS has "reduce motion" turned on.
- **Quick view** — clicking a book's title opens a modal with the
  full cover, description, and buy/preview buttons, without leaving
  the page.
- **Wishlist** — a heart icon on every card saves it to the visitor's
  own browser (`localStorage`, nothing sent to any server), with a
  count in the nav and a toggle to view only saved books.
- **Share button** — uses the native Share sheet on phones
  (`navigator.share`); falls back to "copy link" with a toast on
  desktop browsers that don't support it.
- **"Notify me" for sold-out books** — captures an email straight to
  your Sheet (via the `notifyMe` backend action) so you don't lose a
  buyer just because something's temporarily sold out. Visible to you
  in the admin dashboard's new "Notify me leads" panel.
- **Top loading bar** — a thin progress indicator while live data is
  being fetched from your Sheet, so a slow connection never looks
  like a frozen page.
- **Back-to-top button**, image fade-in on load, and hover
  micro-interactions on cards and buttons throughout.

All of this is **progressive**: if JavaScript is slow to load, if the
backend isn't configured yet, or if a visitor has animations turned
off, the site still shows the fallback book data and works — nothing
above is required for the core storefront to function.

---

## Step 1 — Create the backend (Google Sheet + Apps Script)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet. Name it something like "InkSprout Store Data".
2. In the menu, go to **Extensions → Apps Script**.
3. Delete whatever's in the editor (usually `function myFunction() {}`),
   then paste in the entire contents of `apps-script/Code.gs` from this
   folder.
4. Click the **Save** icon (or Ctrl/Cmd+S).
5. In the function dropdown at the top, select **setup**, then click
   **▶ Run**.
   - The first time, Google will ask you to authorize the script —
     click through "Advanced" → "Go to (project name) (unsafe)" if
     warned (this warning appears for all personal Apps Script
     projects, not just this one — it's your own script running on
     your own Sheet).
6. Go back to your Sheet tab — you should now see a **Books** tab with
   headers and 4 sample rows (your real 4 books, with placeholder links).
7. Back in the Apps Script editor: **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then **Authorize access** again if asked.
8. Copy the **Web app URL** it gives you (ends in `/exec`). You'll need
   it in Step 2.

**Updating the site later:** just edit cells in the Books sheet directly.
You do **not** need to redeploy — only redeploy if you change the code
in `Code.gs` itself (Apps Script requires a new deployment version for
code changes specifically, but not for sheet data changes).

### Editing your book data

You now have two ways to edit books: the **admin dashboard** (Step
3.5 below — easier, has a proper form) or editing the **Books** sheet
directly. Both work the same way under the hood. Each column:

| Column | What to put |
|---|---|
| `id` | A short unique slug, no spaces (e.g. `side-income`) |
| `title`, `tagline`, `category` | Shown on the card |
| `price`, `originalPrice` | Numbers only, no ₹ symbol |
| `pages` | Page count |
| `rating`, `reviewCount` | Leave at `0` until you have real reviews — the site hides the star rating automatically when `reviewCount` is 0, so you never show fake social proof |
| `coverImage` | Path to the cover, e.g. `assets/covers/side-income.jpg` |
| `description` | One or two sentences |
| `gumroadLink`, `creatlyLink` | Full checkout URLs. Leave blank to hide that button entirely |
| `otherLinkLabel`, `otherLink` | For a third platform — label shows on the button (e.g. "Get on Instamojo") |
| `previewLink` | See Step 3 below |
| `featured` | `TRUE`/`FALSE` — not used by the current layout, reserved for later |
| `status` | `live`, `draft` (hidden from the site), or `sold-out` (still shown, buy buttons replaced with "Currently sold out") |

To add a 5th book, just add a new row with the same columns filled in,
and drop its cover image into `assets/covers/` before you deploy (or
upload it to the GitHub repo afterward, in the same folder).

---

## Step 2 — Connect the frontend to the backend

Open `config.js` and paste the Web App URL from Step 1:

```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb.../exec",
  FETCH_TIMEOUT_MS: 6000
};
```

Save the file. That's the only code change required to go live with
real data.

---

## Step 3 — Add a preview link (Google Drive)

For each book, upload a **sample PDF** (e.g. the first 2–3 chapters,
exported separately) to Google Drive:

1. Right-click the file in Drive → **Share → Share**.
2. Under "General access," change to **Anyone with the link** → role
   **Viewer**.
3. Copy the link it gives you (looks like
   `https://drive.google.com/file/d/FILE_ID/view?usp=sharing`).
4. Paste it into the `previewLink` column for that book in your Sheet.

Clicking "Preview sample" on the site opens this link in a new tab —
simple and reliable, with no special embedding needed.

---

## Step 3.5 — Set up the admin dashboard

The admin dashboard (`admin.html`) lets you add, edit, delete, and
change the status of books, plus see preview/buy click counts — all
without touching the Google Sheet directly.

**Set your admin password (never goes in code or GitHub):**
1. In the Apps Script editor, click the gear icon (**Project Settings**)
   in the left sidebar.
2. Scroll to **Script Properties → Add script property**.
3. Key: `ADMIN_PASSWORD`   Value: *(choose a real password)*
4. Click **Save script properties**.

That's it — `admin.html` uses the same `APPS_SCRIPT_URL` you already
put in `config.js`. Open `admin.html` (locally, or once deployed,
at `yoursite.vercel.app/admin.html`) and log in.

**What you can do from the dashboard:**
- See totals: books by status, total preview opens, total buy-link clicks, total leads
- A bar chart of clicks per book (preview vs. buy)
- A "Notify me" leads table — everyone who asked to hear about a sold-out book
- Add a new book with a form (no spreadsheet columns to remember)
- Edit any book's details
- Change a book's status instantly: **Live**, **Draft**, or **Sold out**
  — "Sold out" keeps the book visible on the site but swaps the buy
  buttons for a disabled "Currently sold out" label; "Draft" hides it
  from the public site entirely
- Delete a book
- Search and filter the table by status
- **Export to CSV** — books, leads, or click totals, each with its own
  button, downloaded straight from your browser (no backend call
  needed — it exports whatever's currently loaded on screen)

**How login actually works, honestly:** there's no user database —
it's a single shared password for you (the owner). When you log in,
the password is checked **on the server** (inside Apps Script, via a
Script Property only you can see), and you get back a random session
token that's stored in your browser and expires automatically after
6 hours. The password itself is never stored in this repo or sent
anywhere except that one login request. This is good enough for a
single-owner personal dashboard — it is deliberately not a
multi-user permissions system.

**Admin URL isn't secret by itself.** Anyone who guesses or finds
`/admin.html` can see the *login screen*, but can't see or change any
data without the password — the real protection is the password
check happening on the server, not the page being hidden. (The page
is also marked `noindex` so search engines won't list it.)

### Email alerts (optional, on by default once leads exist)

You'll get an email the moment someone:
- submits a **"notify me"** request on a sold-out book, or
- clicks a **buy link** (at most one email per book every 10
  minutes, so a burst of clicks doesn't flood your inbox — it's a
  heads-up that someone's interested, not a sale confirmation)

**No setup required to turn this on** — it emails your own Apps
Script account by default. To send it somewhere else, or turn it
off:

| Script Property | Value | Effect |
|---|---|---|
| `ALERT_EMAIL` | any email address | Alerts go here instead of your Apps Script account's own address |
| `EMAIL_ALERTS` | `off` | Turns off all alert emails (any other value, or leaving it unset, keeps them on) |

Add these the same way as `ADMIN_PASSWORD` — Project Settings →
Script Properties.

**Honest limitation:** Gmail/Apps Script caps outgoing mail per day
(100/day on a standard free Gmail account, more on Workspace). A
personal storefront won't get close to that, but it's worth knowing
if you ever run a big promotion.

---

## Step 4 — Put the site on GitHub

```bash
cd site
git init
git add .
git commit -m "Initial InkSprout storefront"
```

Then create a new, empty repository on [github.com/new](https://github.com/new)
(don't add a README there — you already have one), and push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/inksprout-store.git
git branch -M main
git push -u origin main
```

---

## Step 5 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with
   GitHub.
2. Click **Import** next to your `inksprout-store` repo.
3. Leave all settings as default — Vercel auto-detects a static site
   (no framework, no build command needed).
4. Click **Deploy**. In under a minute you'll get a live URL like
   `inksprout-store.vercel.app`.
5. *(Optional)* Add a custom domain under Project → Settings →
   Domains.

Every time you `git push` after this, Vercel redeploys automatically.
Editing the Google Sheet does **not** require a push — only changes to
the HTML/CSS/JS files do.

---

## Security, honestly

- **No payments happen on this site.** Every "Get on Gumroad/Creatly"
  button sends the buyer to that platform to pay — so card details and
  payment security are fully handled by Gumroad/Creatly, not by this
  code. This site never touches payment information at all.
- **The public API (`doGet`) is read-only.** Visitors to the storefront
  can only ever read live book data — there's no way to write or modify
  anything through the public browsing experience.
- **The write API (`doPost`) requires your password.** Adding, editing,
  deleting, or listing draft/sold-out books all require a valid session
  token, which only exists after a correct `ADMIN_PASSWORD` login. That
  password lives only in Apps Script's Script Properties — never in
  this repo, never in GitHub, never visible in any file you push.
- **Click tracking (`track`) and the "notify me" form (`notifyMe`)
  are the two open exceptions, on purpose.** Anyone can trigger a
  `preview`/`buy_*` count, or submit an email for a restock notice —
  that's the point, it's how analytics and leads get captured from
  real visitors. Both are restricted (known event types only for
  `track`; a valid email shape and a real book id for `notifyMe`) and
  can only ever *append* a row — neither can read, edit, or delete
  anything. Worst case, someone inflates your click counts or adds a
  junk email to your Leads sheet; they can't touch your book listings
  or any other data.
- **No secrets are exposed.** The Apps Script URL itself is meant to be
  public, the same as any API endpoint — it doesn't grant access to
  your Google account or any other file, and without the password it
  can't write anything.
- **What this setup does *not* give you:** rate-limiting or DDoS
  protection beyond Google's own Apps Script quotas, multi-user
  accounts or permission levels (it's a single shared admin password,
  by design — see Step 3.5), or protection against someone who
  obtains your actual password. Sessions expire after 6 hours
  (CacheService's own maximum), so there's no "stay logged in forever."

I'm not going to claim this is "fully secure" in some absolute sense —
no honest answer is. What's true is: public visitors can only ever
read live data or increment a click count; every real write requires
your password, checked server-side; and that password never touches
your GitHub repo.

---

## Troubleshooting

**Site shows sample data, not my real prices/links.**
Check `config.js` has the correct URL, and that you deployed the Apps
Script as a **Web app** (not "API executable"), with access set to
**Anyone**.

**Browser console shows a CORS or network error.**
Make sure you created a **new deployment** (not just saved) after any
`Code.gs** edits — Apps Script needs a fresh deployment version for
code changes to take effect on the public URL. Re-check access is set
to "Anyone," not "Anyone with a Google account."

**I changed a price in the Sheet but the site didn't update.**
Data is cached for 5 minutes for speed (see `CACHE_SECONDS` in
`Code.gs`). Wait a few minutes, or run **InkSprout Admin → Clear API
cache** from the Sheet's custom menu for an instant refresh.

**Admin login says "Admin password not set on the server yet."**
You haven't added the `ADMIN_PASSWORD` Script Property yet — see Step
3.5. This is separate from redeploying; Script Properties take effect
immediately, no new deployment needed.

**Admin dashboard logs me out after a while.**
Sessions last 6 hours (the maximum Apps Script allows for this kind
of session storage) — just log in again. This is expected, not a bug.

**I'm not getting email alerts.**
Check you haven't set `EMAIL_ALERTS` to `off` in Script Properties.
Also check your Apps Script account's spam folder the first time —
automated mail from a new script sometimes lands there initially.
Buy-click alerts are capped at one per book per 10 minutes, so
repeated test clicks in a short window will only email you once.

**The clicks chart says it couldn't load.**
Chart.js loads from a CDN (`cdn.jsdelivr.net`). If your network, an
ad-blocker, or a corporate firewall blocks it, the chart silently
hides itself and the rest of the dashboard — book data, stats, edit/delete — keeps working normally. This is intentional: one blocked
script should never take down the whole page.
