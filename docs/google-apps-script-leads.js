/**
 * Pine Point — Lead Capture Endpoint
 *
 * Receives JSON POSTs from pinepointtrees.com (estimate.html):
 *   - formType: "estimate_contact" — user submitted contact form on the estimate page
 *   - formType: "schedule"         — user clicked "Schedule a Follow-Up" after seeing price
 *
 * Email behavior — exactly ONE email per user journey:
 *   - Estimate filled, no schedule within EMAIL_DELAY_MINUTES → "New Lead" email
 *   - Estimate filled + schedule from same phone/email      → "Callback Requested" email only
 * Both submissions still write rows to their respective sheet tabs regardless.
 *
 * The trigger that sends "New Lead" emails also defends against a race where
 * the schedule POST lands at the server before the estimate_contact POST: it
 * checks the Schedule Requests sheet for a recent matching row and skips the
 * lead email if one exists.
 *
 * Setup once per deployment — see docs/LEAD-CAPTURE-SETUP.md for the full walk-through.
 * Short version:
 *   1. Paste this code into Code.gs in the Apps Script editor
 *   2. Run → installTrigger (creates the 1-min time trigger)
 *   3. Deploy → New deployment → Web app → "Anyone" access
 */

const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail();
const EMAIL_DELAY_MINUTES = 5;
const ATTACHMENT_TOTAL_LIMIT_BYTES = 15 * 1024 * 1024;  // skip attaching once the total exceeds this

const SHEETS = {
  estimate_contact: {
    name: 'Estimate Leads',
    headers: [
      'Estimate #', 'Timestamp', 'Name', 'Phone', 'Email',
      'ZIP', 'City (USPS)', 'State', 'Distance (mi)', 'Outside Area',
      'Town (entered)',
      'Service', 'Tree Count', 'Tree Height', 'Hazards', 'Access',
      'Prune Type', 'Lot Size', 'Lot Density', 'End Goal',
      'Price Low', 'Price Typical', 'Price High',
      'Notes', 'Photos', 'Page'
    ]
  },
  schedule: {
    name: 'Schedule Requests',
    headers: [
      'Estimate #', 'Timestamp', 'Name', 'Phone', 'Email',
      'ZIP', 'City (USPS)', 'State', 'Distance (mi)', 'Outside Area',
      'Best Time',
      'Service', 'Details', 'Price Typical', 'Notes', 'Photos', 'Page'
    ]
  },
  pending: {
    name: '_Pending Lead Emails',
    headers: ['Queued At', 'Phone Key', 'Email Key', 'Payload JSON']
  }
};

// Pine Point's service center (Leicester, MA) and operating radius.
const SERVICE_CENTER_LAT = 42.2459;
const SERVICE_CENTER_LNG = -71.9087;
const SERVICE_RADIUS_MILES = 15;

const PHOTO_FOLDER_NAME = 'Pine Point Lead Photos';

const SERVICE_NAMES = {
  removal: 'Tree Removal',
  trimming: 'Trimming & Pruning',
  lot_clearing: 'Lot Clearing'
};

// Short PascalCase name used in folder + filename patterns.
const SERVICE_SHORT = {
  removal: 'Removal',
  trimming: 'Trimming',
  lot_clearing: 'LotClearing'
};

const LABELS = {
  removal: {
    treeCount:  { '1': '1 tree', '2-3': '2-3 trees', '4-6': '4-6 trees', '7+': '7 or more trees' },
    treeHeight: { small: 'small (under 25 ft)', medium: 'medium (25-50 ft)', large: 'large (50-75 ft)', xlarge: 'very large (75+ ft)' },
    hazards:    { none: 'open area', house: 'near house/structure', powerlines: 'near power lines', both: 'near house & power lines' },
    access:     { easy: 'easy truck access', limited: 'tight but possible', none: 'difficult / backyard' }
  },
  trimming: {
    treeCount:  { '1': '1 tree', '2-3': '2-3 trees', '4-6': '4-6 trees', '7+': '7 or more trees' },
    pruneType:  { overhang: 'overhang clearing', shaping: 'shaping/thinning', deadwood: 'deadwood removal', clearance: 'clearance from structure/lines' },
    treeHeight: { small: 'small (under 25 ft)', medium: 'medium (25-50 ft)', large: 'large (50-75 ft)', xlarge: 'very large (75+ ft)' },
    access:     { easy: 'easy truck access', limited: 'tight but possible', none: 'difficult / backyard' }
  },
  lot_clearing: {
    lotSize:    { small: 'small area (<1/4 acre)', medium: '1/4-1/2 acre', large: '1/2-1 acre', xlarge: '1+ acres' },
    lotDensity: { brush: 'brush/small trees', mixed: 'mix of brush and large trees', heavy: 'dense woods/hardwoods' },
    access:     { easy: 'easy access for heavy equipment', limited: 'limited / tight', none: 'difficult — no clear route' },
    endGoal:    { build: 'construction prep', yard: 'yard/lawn', thin: 'selective thinning' }
  }
};

const KEY_LABELS = {
  treeCount: 'Tree count',
  treeHeight: 'Tree height',
  hazards: 'Hazards',
  access: 'Access',
  pruneType: 'Prune type',
  lotSize: 'Lot size',
  lotDensity: 'Lot density',
  endGoal: 'End goal'
};

// ============================================================
// HTTP entrypoints
// ============================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.formType === 'estimate_contact') {
      if (!isValidContact(data.contact)) {
        return jsonResponse({ error: 'invalid contact' });
      }
      data.estimateNumber = nextEstimateNumber();
      data.areaCheck = checkServiceArea((data.contact || {}).zip);
      data.photoLinks = savePhotosToDrive(data.photos, data.estimateNumber, data.service, (data.contact || {}).name);
      delete data.photos;
      writeEstimate(ss, data);
      queueLeadEmail(ss, data);
    } else if (data.formType === 'schedule') {
      if (!isValidContact(data.contact)) {
        return jsonResponse({ error: 'invalid contact' });
      }
      data.areaCheck = checkServiceArea((data.contact || {}).zip);
      const cancelled = cancelPendingFor(ss, data);
      // Inherit estimate number from the cancelled pending lead if available,
      // otherwise fall back to the most recent matching Estimate Leads row
      // (covers the case where the lead was queued, drained, and the user
      // came back later to schedule).
      data.estimateNumber = (cancelled && cancelled.estimateNumber)
        ? cancelled.estimateNumber
        : lookupRecentEstimateNumber(ss, data.contact);
      if (cancelled && cancelled.photoLinks && cancelled.photoLinks.length) {
        data.photoLinks = cancelled.photoLinks;
      }
      writeSchedule(ss, data);
      sendCallbackEmail(data);
    } else {
      writeUnknown(ss, data);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

/**
 * Returns a fresh, monotonic-per-year estimate number like "26_00001".
 * Counter is stored in ScriptProperties and incremented under a script-level
 * lock so concurrent submissions can't collide on the same number.
 */
function nextEstimateNumber() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const yyyy = String(new Date().getFullYear());
    const key = 'estimate_counter_' + yyyy;
    const next = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(next));
    return yyyy + '_' + String(next).padStart(5, '0');
  } finally {
    lock.releaseLock();
  }
}

function lookupRecentEstimateNumber(ss, contact) {
  const sheet = ss.getSheetByName(SHEETS.estimate_contact.name);
  if (!sheet) return '';
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const phoneKey = normalizeKey(contact && contact.phone);
  const emailKey = normalizeKey(contact && contact.email);
  if (!phoneKey && !emailKey) return '';
  // Estimate Leads columns (1-indexed): 1=Estimate #, 2=Timestamp, 3=Name, 4=Phone, 5=Email
  const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((phoneKey && normalizeKey(rows[i][3]) === phoneKey) ||
        (emailKey && normalizeKey(rows[i][4]) === emailKey)) {
      return rows[i][0];
    }
  }
  return '';
}

/**
 * Defense-in-depth: same checks the client runs, applied server-side.
 * Keeps automated garbage out of the sheet/email even if the client JS
 * is bypassed.
 */
function isValidContact(c) {
  if (!c) return false;
  const phoneDigits = String(c.phone || '').replace(/[^0-9]/g, '');
  if (phoneDigits.length < 7 || phoneDigits.length > 15) return false;
  if (/^(\d)\1+$/.test(phoneDigits)) return false; // all same digit
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return false;
  if (!/^\d{5}(-\d{4})?$/.test(String(c.zip || '').trim())) return false;
  return true;
}

/**
 * Looks up a US ZIP via the free zippopotam.us API to confirm it's a real
 * USPS ZIP and to compute distance from our service center. Returns:
 *   { ok: true,  city, state, lat, lng, miles, withinServiceArea }
 *   { ok: false, reason: 'not_found' | 'http_error' | 'fetch_failed' }
 *
 * Failure modes never block the submission — they just leave the
 * area-check empty in the email/sheet.
 */
function checkServiceArea(zip) {
  if (!zip) return { ok: false, reason: 'no_zip' };
  const zip5 = String(zip).split('-')[0];
  if (!/^\d{5}$/.test(zip5)) return { ok: false, reason: 'bad_format' };
  try {
    const resp = UrlFetchApp.fetch('https://api.zippopotam.us/us/' + zip5, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return { ok: false, reason: 'not_found', status: resp.getResponseCode() };
    }
    const data = JSON.parse(resp.getContentText());
    const place = data && data.places && data.places[0];
    if (!place) return { ok: false, reason: 'no_place' };
    const lat = parseFloat(place.latitude);
    const lng = parseFloat(place.longitude);
    const miles = haversineMiles(SERVICE_CENTER_LAT, SERVICE_CENTER_LNG, lat, lng);
    return {
      ok: true,
      city: place['place name'] || '',
      state: place['state abbreviation'] || '',
      lat: lat,
      lng: lng,
      miles: miles,
      withinServiceArea: miles <= SERVICE_RADIUS_MILES
    };
  } catch (err) {
    return { ok: false, reason: 'fetch_failed', error: String(err) };
  }
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function doGet() {
  return jsonResponse({ status: 'ready' });
}

// ============================================================
// Sheet writes
// ============================================================

function writeEstimate(ss, d) {
  const sheet = getOrCreate(ss, SHEETS.estimate_contact);
  const a = d.answers || {};
  const c = d.contact || {};
  const p = d.price || {};
  const ac = d.areaCheck || {};
  const distance = (ac.ok && typeof ac.miles === 'number') ? Number(ac.miles.toFixed(1)) : '';
  const outside = ac.ok ? (ac.withinServiceArea ? '' : 'YES') : '';
  sheet.appendRow([
    d.estimateNumber || '',
    new Date(),
    c.name || '', c.phone || '', c.email || '',
    c.zip || '', ac.city || '', ac.state || '', distance, outside,
    c.town || '',
    d.service || '',
    a.treeCount || '', a.treeHeight || '', a.hazards || '', a.access || '',
    a.pruneType || '', a.lotSize || '', a.lotDensity || '', a.endGoal || '',
    p.low || '', p.typical || '', p.high || '',
    c.notes || '', formatPhotoUrls(d.photoLinks), d.page || ''
  ]);
}

function writeSchedule(ss, d) {
  const sheet = getOrCreate(ss, SHEETS.schedule);
  const c = d.contact || {};
  const p = d.price || {};
  const ac = d.areaCheck || {};
  const distance = (ac.ok && typeof ac.miles === 'number') ? Number(ac.miles.toFixed(1)) : '';
  const outside = ac.ok ? (ac.withinServiceArea ? '' : 'YES') : '';
  sheet.appendRow([
    d.estimateNumber || '',
    new Date(),
    c.name || '', c.phone || '', c.email || '',
    c.zip || '', ac.city || '', ac.state || '', distance, outside,
    d.scheduledTime || '',
    d.service || '', JSON.stringify(d.answers || {}),
    p.typical || '',
    d.scheduleNotes || '',
    formatPhotoUrls(d.photoLinks),
    d.page || ''
  ]);
}

function writeUnknown(ss, d) {
  const sheet = getOrCreate(ss, { name: 'Other', headers: ['Timestamp', 'Raw'] });
  sheet.appendRow([new Date(), JSON.stringify(d)]);
}

// ============================================================
// Pending-email queue (deduplicates lead vs callback emails)
// ============================================================

function queueLeadEmail(ss, d) {
  const sheet = getOrCreate(ss, SHEETS.pending);
  const c = d.contact || {};
  sheet.appendRow([
    new Date(),
    normalizeKey(c.phone),
    normalizeKey(c.email),
    JSON.stringify(d)
  ]);
}

/**
 * Removes pending lead-email rows that match the schedule submission
 * (by normalized phone or email). Returns the most recently matched
 * pending payload (parsed) so the caller can carry over any photoLinks
 * etc. into the callback email; returns null if nothing matched.
 */
function cancelPendingFor(ss, d) {
  const sheet = ss.getSheetByName(SHEETS.pending.name);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const c = d.contact || {};
  const phoneKey = normalizeKey(c.phone);
  const emailKey = normalizeKey(c.email);
  if (!phoneKey && !emailKey) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  let matchedPayload = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const pendingPhone = rows[i][1];
    const pendingEmail = rows[i][2];
    const matchPhone = phoneKey && pendingPhone && phoneKey === pendingPhone;
    const matchEmail = emailKey && pendingEmail && emailKey === pendingEmail;
    if (matchPhone || matchEmail) {
      if (!matchedPayload) {
        try { matchedPayload = JSON.parse(rows[i][3]); } catch (e) {}
      }
      sheet.deleteRow(i + 2);
    }
  }
  return matchedPayload;
}

/**
 * Called by the 1-minute time trigger installed by installTrigger().
 * Walks the pending queue and sends a "New Lead" email for any entry older
 * than EMAIL_DELAY_MINUTES *unless* a matching schedule row already exists
 * (which would mean the user did schedule — they just raced the network).
 */
function processPendingLeads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.pending.name);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Build the set of phone/email keys that scheduled a callback recently.
  // A schedule POST landing on the server BEFORE its matching estimate_contact
  // POST (race triggered by client-side photo encoding latency) leaves nothing
  // for cancelPendingFor() to delete; this safety net catches that case.
  const scheduledKeys = collectRecentScheduleKeys(ss, EMAIL_DELAY_MINUTES + 5);

  const cutoff = new Date(Date.now() - EMAIL_DELAY_MINUTES * 60 * 1000);
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    const queuedAt = new Date(rows[i][0]);
    if (queuedAt > cutoff) continue;

    const phoneKey = rows[i][1];
    const emailKey = rows[i][2];
    const alreadyScheduled =
      (phoneKey && scheduledKeys.has(phoneKey)) ||
      (emailKey && scheduledKeys.has(emailKey));

    if (!alreadyScheduled) {
      try {
        const data = JSON.parse(rows[i][3]);
        sendLeadEmail(data);
      } catch (e) {
        // Skip malformed rows but still remove from the queue.
      }
    }
    sheet.deleteRow(i + 2);
  }
}

function collectRecentScheduleKeys(ss, minutesBack) {
  const sheet = ss.getSheetByName(SHEETS.schedule.name);
  const keys = new Set();
  if (!sheet) return keys;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;

  const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
  // Schedule columns: 1=Timestamp, 3=Phone, 4=Email
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (const r of rows) {
    const ts = new Date(r[0]);
    if (ts < cutoff) continue;
    const pk = normalizeKey(r[2]);
    const ek = normalizeKey(r[3]);
    if (pk) keys.add(pk);
    if (ek) keys.add(ek);
  }
  return keys;
}

// ============================================================
// Email composition (HTML + plain-text fallback, with photo attachments)
// ============================================================

function sendLeadEmail(d) {
  const c = d.contact || {};
  const p = d.price || {};
  const num = d.estimateNumber || '';
  const service = SERVICE_NAMES[d.service] || d.service || '';
  const subject = 'New Lead - ' + (service ? service + ' ' : '') + (c.name || 'Pine Point');

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#222">',
    '<h2 style="margin:0 0 4px;color:#2D5A27">New Lead</h2>',
    num ? '<p style="margin:0 0 4px;font-size:13px;color:#444">Estimate #: <strong>' + escapeHtml(num) + '</strong></p>' : '',
    '<p style="margin:0 0 12px;color:#666;font-size:13px">' +
      'Estimate submitted ' + EMAIL_DELAY_MINUTES + '+ minutes ago, no callback scheduled.</p>',
    outsideAreaBanner(d.areaCheck),
    htmlSection('Contact', contactRows(c, d.areaCheck)),
    htmlSection('Job', [
      ['Service', '<strong>' + escapeHtml(SERVICE_NAMES[d.service] || d.service || '') + '</strong>']
    ].concat(answerRows(d.service, d.answers))),
    htmlSection('Estimated price', [
      ['Low',     '$' + escapeHtml(p.low || '?')],
      ['Typical', '<strong>$' + escapeHtml(p.typical || '?') + '</strong>'],
      ['High',    '$' + escapeHtml(p.high || '?')]
    ]),
    c.notes ? htmlSection('Their notes', [['', escapeHtml(c.notes)]]) : '',
    formatPhotosHtml(d.photoLinks),
    '<p style="color:#888;font-size:12px;margin-top:24px">Source: ' + escapeHtml(d.page || '') + '</p>',
    '</div>'
  ].join('');

  sendHtmlEmail(subject, html, buildAttachments(d.photoLinks));
}

function sendCallbackEmail(d) {
  const c = d.contact || {};
  const p = d.price || {};
  const num = d.estimateNumber || '';
  const service = SERVICE_NAMES[d.service] || d.service || '';
  const subject = 'Callback Requested - ' + (service ? service + ' ' : '') + (c.name || 'Pine Point');

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#222">',
    '<h2 style="margin:0 0 4px;color:#2D5A27">Callback Requested</h2>',
    num ? '<p style="margin:0 0 12px;font-size:13px;color:#444">Estimate #: <strong>' + escapeHtml(num) + '</strong></p>' : '<div style="height:12px"></div>',
    outsideAreaBanner(d.areaCheck),
    htmlSection('Caller', contactRows(c, d.areaCheck).concat([
      ['Best time', '<strong>' + escapeHtml(d.scheduledTime || '(any)') + '</strong>']
    ])),
    htmlSection('Job', [
      ['Service', '<strong>' + escapeHtml(SERVICE_NAMES[d.service] || d.service || '') + '</strong>']
    ].concat(answerRows(d.service, d.answers))),
    htmlSection('Estimate', [
      ['Typical price', '<strong>$' + escapeHtml(p.typical || '?') + '</strong>']
    ]),
    d.scheduleNotes ? htmlSection('Their note', [['', escapeHtml(d.scheduleNotes)]]) : '',
    formatPhotosHtml(d.photoLinks),
    '</div>'
  ].join('');

  sendHtmlEmail(subject, html, buildAttachments(d.photoLinks));
}

/**
 * Builds the standard contact rows used in both lead and callback emails.
 * Pulls USPS city/state from areaCheck when available so the customer's
 * actual location is visible at a glance, with the typed town as a fallback.
 */
function contactRows(c, areaCheck) {
  c = c || {};
  const usps = areaCheck && areaCheck.ok ? areaCheck : null;
  const cityState = usps ? (usps.city + ', ' + usps.state) : '';
  const zip = c.zip || '';
  const zipLine = zip + (cityState ? ' (' + cityState + ')' : '');
  const town = c.town || '';
  const rows = [
    ['Name', escapeHtml(c.name || '(none)')],
    ['Phone', phoneLink(c.phone)],
    ['Email', emailLink(c.email)],
    ['ZIP', escapeHtml(zipLine || '(none)')]
  ];
  if (town) rows.push(['Town', escapeHtml(town) + ' <span style="color:#888;font-size:12px">(as entered)</span>']);
  if (usps && typeof usps.miles === 'number') {
    rows.push(['Distance', escapeHtml(usps.miles.toFixed(1) + ' mi from Leicester')]);
  }
  return rows;
}

/**
 * Returns an HTML banner if the submission's ZIP geocoded outside our
 * service radius. Empty string if the area check passed or never ran.
 * The customer never sees this — it's an internal flag to be discussed
 * with Jason before deciding policy.
 */
function outsideAreaBanner(areaCheck) {
  if (!areaCheck || !areaCheck.ok) return '';
  if (areaCheck.withinServiceArea) return '';
  const miles = (areaCheck.miles || 0).toFixed(1);
  return [
    '<div style="margin:0 0 16px;padding:10px 14px;background:#fff5e6;border:1px solid #c85a28;border-radius:4px;color:#5a2c0d;font-size:14px">',
    '<strong>⚠ Outside service area:</strong> ',
    escapeHtml(miles), ' mi from Leicester ',
    '(service radius is ', String(SERVICE_RADIUS_MILES), ' mi).',
    '</div>'
  ].join('');
}

function htmlSection(title, rows) {
  const inner = rows.map(function (r) {
    const label = r[0]
      ? '<td style="padding:4px 12px 4px 0;color:#666;font-size:13px;vertical-align:top;white-space:nowrap">' + escapeHtml(r[0]) + ':</td>'
      : '<td></td>';
    return '<tr>' + label + '<td style="padding:4px 0;font-size:14px">' + r[1] + '</td></tr>';
  }).join('');
  return [
    '<h3 style="margin:18px 0 6px;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;color:#444">' + escapeHtml(title) + '</h3>',
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">',
    inner,
    '</table>'
  ].join('');
}

function answerRows(service, answers) {
  if (!service || !answers) return [];
  const labelMap = LABELS[service] || {};
  const rows = [];
  for (const key of Object.keys(answers)) {
    const labelName = KEY_LABELS[key] || humanizeKey(key);
    const valueLabels = labelMap[key];
    const display = (valueLabels && valueLabels[answers[key]]) || answers[key];
    rows.push([labelName, escapeHtml(display)]);
  }
  return rows;
}

function formatPhotosHtml(links) {
  if (!links || !links.length) return '';
  const items = links.map(function (l) {
    return '<li style="margin:4px 0"><a href="' + escapeHtml(l.url) + '" style="color:#2D5A27">' + escapeHtml(l.name) + '</a></li>';
  }).join('');
  return [
    '<h3 style="margin:18px 0 6px;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;color:#444">Photos (' + links.length + ')</h3>',
    '<p style="margin:4px 0;color:#666;font-size:12px">Attached below + Drive links:</p>',
    '<ul style="margin:4px 0 0 18px;padding:0;font-size:14px">' + items + '</ul>'
  ].join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function phoneLink(p) {
  if (!p) return '<em style="color:#888">(none)</em>';
  const digits = String(p).replace(/[^0-9]/g, '');
  if (!digits) return escapeHtml(p);
  const tel = digits.length === 10 ? '+1' + digits : '+' + digits;
  return '<a href="tel:' + escapeHtml(tel) + '" style="color:#2D5A27;font-weight:600">' + escapeHtml(p) + '</a>';
}

function emailLink(e) {
  if (!e) return '<em style="color:#888">(none)</em>';
  return '<a href="mailto:' + escapeHtml(e) + '" style="color:#2D5A27">' + escapeHtml(e) + '</a>';
}

function htmlToText(html) {
  return String(html)
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>(?!\n)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sendHtmlEmail(subject, html, attachments) {
  const opts = { htmlBody: html };
  if (attachments && attachments.length) opts.attachments = attachments;
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, subject, htmlToText(html), opts);
  } catch (e) {
    // Sheet writes are the source of truth — never fail the whole submission.
  }
}

function buildAttachments(links) {
  if (!links || !links.length) return [];
  const blobs = [];
  let total = 0;
  for (const l of links) {
    if (!l.fileId) continue;
    try {
      const file = DriveApp.getFileById(l.fileId);
      const size = file.getSize();
      if (total + size > ATTACHMENT_TOTAL_LIMIT_BYTES) break;
      blobs.push(file.getBlob());
      total += size;
    } catch (e) {
      // File may have been deleted/moved — skip; the email still has the link.
    }
  }
  return blobs;
}

function humanizeKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }).trim();
}

function normalizeKey(s) {
  return (s || '').toString().toLowerCase().replace(/[^0-9a-z@.]/g, '');
}

// ============================================================
// Photo upload to Drive (organized: <root>/<MMM_YY>/<MMM_YY_Service_Name>/files)
// ============================================================

/**
 * Decodes each base64 data-URL photo from the payload, saves it to the
 * appropriate subfolder, and returns an array of { name, url, fileId }.
 *
 * Folder structure:
 *   Pine Point Lead Photos/
 *     May_26/
 *       MAY26_Removal_JohnSmith_2026_00001/
 *         originalfilename.jpg
 *
 * The estimate-number suffix on the per-estimate folder keeps the name
 * unique even if the same customer submits twice in the same month.
 */
function savePhotosToDrive(photos, estimateNumber, service, customerName) {
  if (!photos || !photos.length) return [];
  const now = new Date();
  const monthYear = formatMonthYear(now);             // "May_26"   — parent folder
  const monthYearUpper = formatMonthYearUpper(now);   // "MAY26"    — folder name prefix
  const safeService = SERVICE_SHORT[service] || 'Other';
  const safeName = sanitizeName(customerName) || 'Anonymous';
  const folderName = monthYearUpper + '_' + safeService + '_' + safeName +
                     (estimateNumber ? '_' + estimateNumber : '');

  const root = getOrCreatePhotoFolder();
  const monthFolder = getOrCreateChildFolder(root, monthYear);
  const estimateFolder = getOrCreateChildFolder(monthFolder, folderName);

  const links = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      const match = (photo.dataUrl || '').match(/^data:(.+?);base64,(.*)$/);
      if (!match) continue;
      const mimeType = match[1];
      const base64 = match[2];
      const filename = (photo.name || ('photo-' + (i + 1) + '.jpg')).replace(/[\\/]/g, '_');
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename);
      const file = estimateFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      links.push({ name: filename, url: file.getUrl(), fileId: file.getId() });
    } catch (e) {
      // Skip individual photo failures rather than losing the whole submission.
    }
  }
  return links;
}

function formatMonthYear(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()] + '_' + String(d.getFullYear()).slice(2);
}

function formatMonthYearUpper(d) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return months[d.getMonth()] + String(d.getFullYear()).slice(2);
}

function sanitizeName(s) {
  return (s || '').toString().replace(/[^a-zA-Z0-9]/g, '');
}

function getOrCreatePhotoFolder() {
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

function getOrCreateChildFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function formatPhotoUrls(links) {
  if (!links || !links.length) return '';
  return links.map(function (l) { return l.url; }).join('\n');
}

// ============================================================
// Helpers
// ============================================================

function getOrCreate(ss, def) {
  let s = ss.getSheetByName(def.name);
  if (!s) {
    s = ss.insertSheet(def.name);
    s.appendRow(def.headers);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
  }
  return s;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// One-time setup — run this from the Apps Script editor (Run → installTrigger)
// ============================================================

/**
 * Installs the 1-minute time trigger that drains the pending lead-email queue.
 * Re-runs are safe — any existing trigger for processPendingLeads is removed first.
 */
function installTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'processPendingLeads') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('processPendingLeads')
    .timeBased()
    .everyMinutes(1)
    .create();
  console.log('Trigger installed — pending lead emails are sent ' +
    EMAIL_DELAY_MINUTES + ' minutes after submission unless cancelled by a schedule.');
}
