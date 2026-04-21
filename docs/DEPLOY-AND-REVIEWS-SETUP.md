# Deploy + Reviews Sync — Setup Guide

This repo auto-deploys to GoDaddy via FTP and auto-syncs Google reviews once
a week. Both live as GitHub Actions under `.github/workflows/`. The workflows
do nothing useful until five secrets are populated in the repo settings.

Repo: https://github.com/fitFo-Systems/pinepointtrees
Secrets page: https://github.com/fitFo-Systems/pinepointtrees/settings/secrets/actions

---

## 1. Google Reviews — API Key + Place ID

### 1a. Create a Google Cloud project

1. https://console.cloud.google.com/projectcreate
2. Name: `fitfo-pinepoint-reviews`. Organization: none. Create.

### 1b. Enable the Places API (New)

1. https://console.cloud.google.com/apis/library/places.googleapis.com
2. Make sure the project picker (top bar) shows `fitfo-pinepoint-reviews`.
3. Click **Enable**.

### 1c. Create an API key

1. https://console.cloud.google.com/apis/credentials
2. **+ Create credentials → API key**. Copy the key.
3. Click **Edit API key** on the new entry.
4. Under **API restrictions**, pick **Restrict key** and select
   **Places API (New)** only.
5. Under **Application restrictions**, leave as "None" for now. The key only
   runs from GitHub Actions runners and is never exposed in the browser.
6. **Save**.

### 1d. Find the Place ID

1. https://developers.google.com/maps/documentation/places/web-service/place-id
2. Search "Pine Point Tree Service Leicester MA".
3. Click the business, copy the ID (format `ChIJ...`).

### 1e. Add both as GitHub secrets

Go to the secrets page above and add:

| Name | Value |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | the key from 1c |
| `GOOGLE_PLACE_ID` | the ID from 1d |

---

## 2. GoDaddy FTP Deploy

### 2a. Find FTP credentials in cPanel

1. Log in to GoDaddy → Hosting → cPanel.
2. **Files → FTP Accounts**.
3. Either use the main cPanel login or **Add FTP Account** specifically for
   deploys (recommended — easier to rotate).
   - Suggested username: `deploy@pinepointtrees.com`
   - Generate a strong password, save it
   - Directory: `/public_html/` (or whatever the site root is)
   - Quota: unlimited
4. Note the **server hostname** (e.g. `ftp.pinepointtrees.com` or the IP shown
   in the FTP Accounts panel).

### 2b. Add these GitHub secrets

| Name | Value | Notes |
| --- | --- | --- |
| `FTP_HOST` | e.g. `ftp.pinepointtrees.com` | hostname only, no `ftp://` |
| `FTP_USERNAME` | full username from 2a | often includes the domain |
| `FTP_PASSWORD` | password from 2a |  |
| `FTP_SERVER_DIR` | e.g. `/public_html/` | must end with `/` |

---

## 3. First run

### Manual reviews sync

1. https://github.com/fitFo-Systems/pinepointtrees/actions/workflows/sync-reviews.yml
2. **Run workflow → main → Run workflow**.
3. It pulls up to 5 most-recent reviews and commits `data/reviews.json` if
   anything's new.

### Manual deploy

1. https://github.com/fitFo-Systems/pinepointtrees/actions/workflows/deploy.yml
2. **Run workflow → main → Run workflow**.
3. FTP pushes everything except dev-only folders (`.github`, `.claude`,
   `scripts`, `docs`, `versions`, `import_images`, `video`).

Going forward the schedule runs sync every Monday 09:00 UTC. Any new reviews
trigger a redeploy automatically.

---

## 4. Older reviews (the "memorialize" question)

Google's API only returns the 5 most recent. If Jason wants the 9 older
reviews from his profile archived in the site, paste them into
`data/reviews.json` manually with:

```json
{
  "id": "google-manual-<slugified-name-and-date>",
  "source": "Google",
  "displayName": "John D.",
  "fullName": "John Doe",
  "rating": 5,
  "text": "Review text from the profile.",
  "timestamp": "2024-06-15T00:00:00Z"
}
```

The `id` must be unique. Use the `google-manual-` prefix so we never collide
with auto-synced entries (which use `google-<review_name_last_segment>`).
The cron job preserves manual entries — it only adds/updates entries whose
`id` matches the Places API response.
