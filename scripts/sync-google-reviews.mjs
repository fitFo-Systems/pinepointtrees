#!/usr/bin/env node
/**
 * Pulls the most recent Google reviews via Places API (New) and merges
 * them into data/reviews.json. Dedup key: review.name (stable per review).
 *
 * Google's API returns up to 5 most recent reviews. Older reviews in
 * reviews.json are preserved (memorialized) so the archive only grows.
 *
 * Env:
 *   GOOGLE_PLACES_API_KEY  — API key with Places API (New) enabled
 *   GOOGLE_PLACE_ID        — Place ID (format: ChIJ...)
 *
 * Exit codes:
 *   0  success, reviews.json may or may not have changed
 *   1  env / config problem
 *   2  API error
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const REVIEWS_PATH = resolve(ROOT, 'data/reviews.json');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACE_ID = process.env.GOOGLE_PLACE_ID;

if (!API_KEY || !PLACE_ID) {
  console.error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_PLACE_ID env var.');
  process.exit(1);
}

/**
 * First-name + last-initial transformation, matching the site convention.
 *   "John Doe"        -> "John D."
 *   "Mary-Jane Smith" -> "Mary-Jane S."
 *   "Cher"            -> "Cher"
 */
function publicDisplayName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${last[0]}.`;
}

/** Stable dedup id derived from Google's review.name. */
function reviewIdFromName(name) {
  const last = name.split('/').pop();
  return `google-${last}`;
}

async function fetchGoogleReviews() {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(PLACE_ID)}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,displayName,reviews',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`Places API error ${res.status}: ${body.slice(0, 500)}`);
    process.exit(2);
  }
  return res.json();
}

function normalizeGoogleReview(r) {
  const fullName = r.authorAttribution?.displayName || '';
  return {
    id: reviewIdFromName(r.name || ''),
    source: 'Google',
    displayName: publicDisplayName(fullName),
    fullName,
    rating: r.rating || 0,
    text: r.originalText?.text || r.text?.text || '',
    timestamp: r.publishTime || null,
    _googleReviewName: r.name,
    _authorUri: r.authorAttribution?.uri || null,
  };
}

function mergeReviews(existing, incoming) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    if (!r.id) continue;
    if (byId.has(r.id)) {
      const prev = byId.get(r.id);
      // Update text/rating if Google's copy changed, but keep original id
      const merged = { ...prev, ...r };
      if (JSON.stringify(prev) !== JSON.stringify(merged)) {
        byId.set(r.id, merged);
        updated += 1;
      }
    } else {
      byId.set(r.id, r);
      added += 1;
    }
  }
  // Sort: newest first by timestamp; entries without timestamps sink to bottom.
  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return tb - ta;
  });
  return { merged, added, updated };
}

async function main() {
  const file = JSON.parse(await readFile(REVIEWS_PATH, 'utf8'));
  const existing = Array.isArray(file.reviews) ? file.reviews : [];

  const api = await fetchGoogleReviews();
  const incoming = (api.reviews || []).map(normalizeGoogleReview);
  console.log(`Fetched ${incoming.length} reviews from Google.`);

  const { merged, added, updated } = mergeReviews(existing, incoming);
  console.log(`Added: ${added}, updated: ${updated}, total: ${merged.length}.`);

  file.reviews = merged;
  file._meta = {
    ...(file._meta || {}),
    lastSyncedAt: new Date().toISOString(),
    googlePlaceId: api.id || PLACE_ID,
    googleBusinessName: api.displayName?.text || file._meta?.googleBusinessName || null,
  };

  const next = JSON.stringify(file, null, 2) + '\n';
  const prev = await readFile(REVIEWS_PATH, 'utf8').catch(() => '');
  if (next === prev) {
    console.log('No changes — reviews.json unchanged.');
    return;
  }
  await writeFile(REVIEWS_PATH, next, 'utf8');
  console.log('reviews.json updated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
