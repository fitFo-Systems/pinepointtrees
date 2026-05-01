# Lead Capture Setup — pinepointtrees.com

When someone fills out the estimate form or schedules a follow-up call on
`pinepointtrees.com`, this setup makes their submission land in a Google
Sheet and triggers a notification email. Without it, leads vanish.

## Time required: ~5 minutes

## Two passes recommended

1. **Test pass** — deploy in your own personal Gmail first. Submit a fake
   lead end-to-end. Verify the sheet row + notification email arrive.
2. **Production pass** — repeat the exact same steps logged in as
   `pinepointtreeservice@gmail.com` (Pine Point's business Gmail) so all
   real leads land in the customer's Drive, not yours.

The script is the same; only the logged-in account differs.

---

## Step 1 — Sign in to Google as the right account

Open `https://drive.google.com` in a browser logged in as either:
- Your personal Gmail (for the test pass), **or**
- `pinepointtreeservice@gmail.com` (for the production pass)

If multiple Google accounts are signed in, double-check the avatar in the
top right shows the right one. Wrong account = leads go to the wrong place.

## Step 2 — Create a new Google Sheet

1. In Drive, click **+ New → Google Sheets → Blank spreadsheet**.
2. Rename it: **Pine Point Leads** (top-left, where it says "Untitled spreadsheet").
3. Leave the empty sheet as-is. The script will create the proper tabs and
   headers automatically on the first submission.

## Step 3 — Open the Apps Script editor

1. In the open spreadsheet, click **Extensions → Apps Script**.
2. A new tab opens with a code editor. There's a default `Code.gs` file
   with a stub `function myFunction()` — **delete everything**.

## Step 4 — Paste the lead-capture script

Copy the entire contents of [`google-apps-script-leads.js`](google-apps-script-leads.js)
in this repo and paste it into the empty `Code.gs` file. Save (⌘S / Ctrl-S).

You can also pull the latest version directly from the live site:
`https://pinepointtrees.com/docs/google-apps-script-leads.js` — open in a
browser, View Source, copy all.

## Step 5 — Install the time trigger (one-time)

The script delays the "lead" email by 5 minutes so it can cancel itself if
the user goes on to schedule a callback (you get one email, not two). That
delayed-send is driven by a 1-minute time trigger.

1. In the Apps Script editor, change the function dropdown (top toolbar) to
   **`installTrigger`**.
2. Click **Run**.
3. Authorize when prompted (same "Google hasn't verified this app" flow as
   any first-time Apps Script run — Advanced → Go to project → Allow).
4. Verify in the **Triggers** tab (clock icon, left sidebar): you should
   see a row for `processPendingLeads`, time-driven, every 1 minute.

If you re-paste the script later, re-run `installTrigger` — it's idempotent.

## Step 6 — Deploy as a Web App

1. Click **Deploy → New deployment** (top right).
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Configure:
   - **Description:** `Pine Point Lead Capture v1`
   - **Execute as:** `Me (your-email@gmail.com)`
   - **Who has access:** **`Anyone`** ← this matters; the website needs to POST anonymously
4. Click **Deploy**.
5. Authorize again if prompted (same Advanced → Go to project → Allow flow).
6. Copy the **Web app URL** that's displayed. Looks like:
   ```
   https://script.google.com/macros/s/AKfycbz...long-string.../exec
   ```

**Save that URL — it's the only thing you need from this step.**

### Updating the script later

If you change the code in `Code.gs` after this initial deploy, the URL keeps
serving the OLD version until you publish a new version: **Deploy → Manage
deployments → pencil (edit) → Version: New version → Deploy**. The URL stays
the same.

## Step 7 — Wire the URL into the website

Edit `js/estimate.js` in the repo. Near the top, find:

```js
const APPS_SCRIPT_URL = '';
```

Paste the URL from Step 6 between the quotes:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz.../exec';
```

Commit and push to `main`. GitHub Pages auto-redeploys in ~30 seconds.

## Step 8 — Test end-to-end

### Test path A — lead only (no callback scheduled)

1. Incognito window → `https://pinepointtrees.com/estimate.html`.
2. Click through any service flow, fill the contact form, submit.
3. **Immediately:** new row in the **Estimate Leads** tab. **No email yet.**
4. **Wait 5+ minutes**, do nothing else.
5. Email arrives titled **"New Lead — (their name)"** with parsed
   job details + price range.

### Test path B — scheduled callback (the qualified case)

1. Incognito window → `https://pinepointtrees.com/estimate.html`.
2. Click through, fill the contact form, submit.
3. On the price-result screen, click **Schedule a Follow-Up**, fill the
   modal, submit.
4. **Immediately:** new row in the **Schedule Requests** tab + email
   titled **"Callback Requested — (their name)"**.
5. **Wait 5+ minutes** — confirm **no follow-up "lead" email arrives**.
   (The schedule submission cancelled the pending lead email.)

If both paths work → ship it. If you tested in your personal account,
repeat Steps 1–6 logged in as `pinepointtreeservice@gmail.com`, swap
the URL in Step 7 to the new one, push, and you're live in production.

---

## Troubleshooting

**No row in the sheet, no email, no errors visible**
- Open the estimate page, then DevTools console. If you see
  `[lead] APPS_SCRIPT_URL not set, would have sent: …`, you forgot
  Step 6. If you see `[lead] post failed …`, the URL is wrong or the
  deployment isn't set to "Anyone".

**Email arrives but no row**
- The bound spreadsheet doesn't match the Apps Script. Make sure you
  opened Apps Script *from inside the Sheet* in Step 3 (not from a
  standalone Apps Script project).

**"Authorization required" error in console**
- The Web App was deployed with "Only myself" instead of "Anyone".
  Redeploy: **Deploy → Manage deployments → pencil icon → change "Who
  has access" to Anyone → Deploy**.

**Need to update the script later**
- Paste new code into `Code.gs` in the Apps Script editor, then
  **Deploy → Manage deployments → pencil icon → New version → Deploy**.
  The Web App URL stays the same.
