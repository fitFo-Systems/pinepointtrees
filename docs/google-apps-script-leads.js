/**
 * Pine Point — Lead Capture Endpoint
 *
 * Receives JSON POSTs from pinepointtrees.com:
 *   - formType: "estimate_contact" — user submitted contact form on the estimate page
 *   - formType: "schedule"         — user clicked "Schedule a Follow-Up" after seeing price
 *   - formType: "wood_signup"      — user signed up for free chips/log-length firewood on wood-products.html
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
  // Clean, deduplicated view that combines Estimate Leads + Schedule Requests
  // into one row per Estimate # with just the columns Jason cares about for
  // follow-up. Each customer = exactly one row, Lead Type updates from
  // "Lead" → "Callback" when they schedule.
  summary: {
    name: 'All Leads',
    headers: [
      'Estimate #', 'Name', 'Phone', 'Email', 'ZIP',
      'Lead Type', 'Job Type', 'Estimate Range', 'Address'
    ]
  },
  estimate_contact: {
    name: 'Estimate Leads',
    headers: [
      'Estimate #', 'Timestamp', 'Name', 'Phone', 'Email',
      'ZIP', 'City', 'State', 'Distance (mi)', 'Outside Area',
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
      'ZIP', 'City', 'State', 'Distance (mi)', 'Outside Area',
      'Best Time',
      'Service', 'Details', 'Price Typical', 'Notes', 'Photos', 'Page'
    ]
  },
  pending: {
    name: '_Pending Lead Emails',
    headers: ['Queued At', 'Phone Key', 'Email Key', 'Payload JSON'],
    hidden: true  // internal queue used by the script — not for Jason to look at
  },
  wood_signup: {
    name: 'Wood Signups',
    headers: [
      'Timestamp', 'Name', 'Phone', 'Email', 'ZIP',
      'City', 'State', 'Distance (mi)', 'Outside Area',
      'Product', 'Wood Mix', 'Notes', 'Page'
    ]
  },
  quotes: {
    name: 'Quotes',
    headers: [
      'Quote #', 'Estimate #', 'Status',
      'Customer Name', 'Address', 'Phone', 'Email', 'ZIP',
      'Service', 'Trees JSON', 'Description', 'Total',
      'Customer Est. Low', 'Customer Est. Typical', 'Customer Est. High',
      'Created At', 'Sent At', 'Completed At', 'Invoiced At',
      'Created By', 'Notes',
      'Customer Note', 'PDF Url'
    ]
  }
};

// Public URL for the Pine Point logo, used by installQuoteTemplate to
// fetch the image and embed it into the Doc template once.
const LOGO_URL = 'https://pinepointtrees.com/images/logo-pinepoint-black.png';

// Where generated quote/invoice PDFs land. Created on first run.
const QUOTES_FOLDER_NAME = 'Pine Point Quotes';

// Reply-to address on customer-bound emails (the From address is
// always the script owner's Gmail).
const REPLY_TO_EMAIL = 'pinepointtreeservice@gmail.com';

// Pine Point's service center (Leicester, MA) and operating radius.
const SERVICE_CENTER_LAT = 42.2459;
const SERVICE_CENTER_LNG = -71.9087;
const SERVICE_RADIUS_MILES = 20;

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
      if (!isValidContact(data.contact, data.formType)) {
        return jsonResponse({ error: 'invalid contact' });
      }
      if (data.contact) data.contact.phone = normalizePhone(data.contact.phone);
      data.estimateNumber = nextEstimateNumber();
      data.areaCheck = checkServiceArea((data.contact || {}).zip);
      data.photoLinks = savePhotosToDrive(data.photos, data.estimateNumber, data.service, (data.contact || {}).name);
      delete data.photos;
      writeEstimate(ss, data);
      upsertSummary(ss, data, 'Lead');
      queueLeadEmail(ss, data);
    } else if (data.formType === 'schedule') {
      if (!isValidContact(data.contact, data.formType)) {
        return jsonResponse({ error: 'invalid contact' });
      }
      if (data.contact) data.contact.phone = normalizePhone(data.contact.phone);
      data.areaCheck = checkServiceArea((data.contact || {}).zip);
      const cancelled = cancelPendingFor(ss, data);
      if (cancelled && cancelled.estimateNumber) {
        // Schedule arrived inside the EMAIL_DELAY_MINUTES window — the
        // pending lead email was cancelled in time, so this is the only
        // notification Jason will see for this customer.
        data.estimateNumber = cancelled.estimateNumber;
        if (cancelled.photoLinks && cancelled.photoLinks.length) {
          data.photoLinks = cancelled.photoLinks;
        }
      } else {
        // Schedule arrived AFTER the lead email already went out (or the
        // pending row was already drained). Customer linkage still holds
        // via the matching Estimate # — flag the email so Jason knows
        // it's the same lead, not a fresh one.
        const prior = lookupRecentEstimate(ss, data.contact);
        if (prior) {
          data.estimateNumber = prior.estimateNumber;
          data.priorEstimateAt = prior.timestamp;
          // Lead email goes out EMAIL_DELAY_MINUTES after estimate timestamp.
          const leadSentBy = new Date(prior.timestamp.getTime() + EMAIL_DELAY_MINUTES * 60 * 1000);
          data.leadEmailAlreadySent = (new Date() >= leadSentBy);
        }
      }
      writeSchedule(ss, data);
      // Once they've scheduled a callback they're no longer a "lead awaiting
      // follow-up" — remove them from the Estimate Leads tab so that tab
      // really means "open leads to call." Full detail lives in Schedule
      // Requests + the All Leads summary.
      removeEstimateRow(ss, data.estimateNumber);
      upsertSummary(ss, data, 'Callback');
      sendCallbackEmail(data);
    } else if (data.formType === 'crew_save_quote') {
      if (!isCrewAuthorized(data.token)) return jsonResponse({ error: 'unauthorized' });
      return jsonResponse(saveCrewQuote(ss, data));
    } else if (data.formType === 'crew_create_lead') {
      if (!isCrewAuthorized(data.token)) return jsonResponse({ error: 'unauthorized' });
      return jsonResponse(createCrewLead(ss, data));
    } else if (data.formType === 'crew_send_quote') {
      if (!isCrewAuthorized(data.token)) return jsonResponse({ error: 'unauthorized' });
      return jsonResponse(handleCrewSendQuote(ss, data));
    } else if (data.formType === 'crew_mark_complete') {
      if (!isCrewAuthorized(data.token)) return jsonResponse({ error: 'unauthorized' });
      return jsonResponse(handleCrewMarkComplete(ss, data));
    } else if (data.formType === 'wood_signup') {
      if (!isValidContact(data.contact, data.formType)) {
        return jsonResponse({ error: 'invalid contact' });
      }
      if (data.contact) data.contact.phone = normalizePhone(data.contact.phone);
      data.areaCheck = checkServiceArea((data.contact || {}).zip);
      writeWoodSignup(ss, data);
      sendWoodSignupEmail(data);
    } else if (data.formType === 'handoff_input' || data.formType === 'handoff_test') {
      // Posted from the FITFO handoff page (fitfo-systems.github.io/pinepoint-handoff/).
      // Just forward as an email — no sheet writes, no lead-capture machinery.
      sendHandoffEmail(data);
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

/**
 * Removes any Estimate Leads rows matching the given Estimate #. Called
 * after a schedule submission so a customer doesn't appear in both the
 * Estimate Leads and Schedule Requests tabs simultaneously — they've
 * upgraded from "lead" to "callback" and only belong in one place.
 */
function removeEstimateRow(ss, estimateNumber) {
  if (!estimateNumber) return;
  const sheet = ss.getSheetByName(SHEETS.estimate_contact.name);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === estimateNumber) {
      sheet.deleteRow(i + 2);
    }
  }
}

function lookupRecentEstimate(ss, contact) {
  const sheet = ss.getSheetByName(SHEETS.estimate_contact.name);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const phoneKey = normalizeKey(contact && contact.phone);
  const emailKey = normalizeKey(contact && contact.email);
  if (!phoneKey && !emailKey) return null;
  // Estimate Leads columns (1-indexed): 1=Estimate #, 2=Timestamp, 3=Name, 4=Phone, 5=Email
  const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((phoneKey && normalizeKey(rows[i][3]) === phoneKey) ||
        (emailKey && normalizeKey(rows[i][4]) === emailKey)) {
      return {
        estimateNumber: rows[i][0],
        timestamp: rows[i][1] instanceof Date ? rows[i][1] : new Date(rows[i][1])
      };
    }
  }
  return null;
}

/**
 * Defense-in-depth: same checks the client runs, applied server-side.
 * Keeps automated garbage out of the sheet/email even if the client JS
 * is bypassed.
 */
/**
 * Defense-in-depth validation. ZIP is mandatory on the initial estimate
 * contact form, but the schedule modal doesn't collect ZIP — the client
 * carries it forward from state.contact, but we still want schedule
 * submissions to succeed if it's missing for any reason.
 */
function isValidContact(c, formType) {
  if (!c) return false;
  const phoneDigits = String(c.phone || '').replace(/[^0-9]/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return false;
  if (/^(\d)\1+$/.test(phoneDigits)) return false; // all same digit
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return false;

  const zip = String(c.zip || '').trim();
  if (formType === 'estimate_contact' || formType === 'wood_signup') {
    if (!/^\d{5}(-\d{4})?$/.test(zip)) return false;
  } else if (zip) {
    // Schedule etc.: zip is optional, but if provided must be valid.
    if (!/^\d{5}(-\d{4})?$/.test(zip)) return false;
  }
  return true;
}

/**
 * Normalize an inbound phone string to a consistent display format so
 * the sheet and email always show "(508) 555-1234" or "+1 (508) 555-1234"
 * regardless of what the user typed.
 */
function normalizePhone(s) {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  if (digits.length === 11 && digits[0] === '1') {
    return '+1 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
  }
  if (digits.length > 0) return digits;
  return '';
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

/**
 * GET handler. Default route returns a tiny status payload (used as
 * a smoke test). The /crew tool reads via JSONP — pass action=crew_*
 * plus the shared token + a callback name to get JSON wrapped as JS
 * the browser can load via a <script> tag (works around CORS, since
 * Apps Script doesn't send cross-origin headers on raw fetch).
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || '';
  const callback = params.callback || '';

  function respond(obj) {
    const text = JSON.stringify(obj);
    if (callback) {
      // JSONP — wrap in callback invocation. Sanitize the callback
      // name to letters/digits/underscores only so a malicious URL
      // can't inject arbitrary JS.
      const safe = String(callback).replace(/[^a-zA-Z0-9_]/g, '');
      const fn = safe || 'callback';
      return ContentService.createTextOutput(fn + '(' + text + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(text)
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if (!action) return respond({ status: 'ready' });

    if (action === 'crew_list' || action === 'crew_get') {
      if (!isCrewAuthorized(params.token)) {
        return respond({ error: 'unauthorized' });
      }
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (action === 'crew_list') {
        return respond({ leads: listCrewLeads(ss, params.filter || 'open') });
      }
      return respond({ lead: getCrewLead(ss, params.id) });
    }

    return respond({ error: 'unknown action: ' + action });
  } catch (err) {
    return respond({ error: String(err) });
  }
}

/**
 * Token gate for the /crew tool. The shared token lives in
 * ScriptProperties under crew_access_token — set it once via
 * installCrewToken() (see end of file).
 */
function isCrewAuthorized(token) {
  if (!token) return false;
  const stored = PropertiesService.getScriptProperties().getProperty('crew_access_token');
  return Boolean(stored) && String(token) === String(stored);
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

/**
 * Maintains the "All Leads" summary tab — one row per Estimate #.
 * Called with leadType "Lead" on estimate_contact and "Callback" on
 * schedule. If a row for this Estimate # already exists, updates it in
 * place (so a Lead row becomes a Callback row when the customer
 * schedules). Otherwise appends a new row.
 */
function upsertSummary(ss, d, leadType) {
  if (!d.estimateNumber) return;
  const sheet = getOrCreate(ss, SHEETS.summary);
  const c = d.contact || {};
  const p = d.price || {};
  const range = (p.low && p.high) ? '$' + p.low + '–$' + p.high : '';
  const jobType = SERVICE_NAMES[d.service] || d.service || '';
  // Address is preserved across updates — if the row already exists
  // and has a stored address, don't blow it away with an empty string
  // from a contact that didn't carry one (e.g. a schedule POST after
  // the crew tool already saved an address).
  let address = c.address || '';

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === d.estimateNumber) {
        if (!address) {
          // Preserve existing address (column 9 = index 8)
          const existingRow = sheet.getRange(i + 2, 1, 1, 9).getValues()[0];
          address = existingRow[8] || '';
        }
        const row = [d.estimateNumber, c.name || '', c.phone || '', c.email || '', c.zip || '', leadType, jobType, range, address];
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  const newRow = [d.estimateNumber, c.name || '', c.phone || '', c.email || '', c.zip || '', leadType, jobType, range, address];
  sheet.appendRow(newRow);
}

// ============================================================
// Pending-email queue (deduplicates lead vs callback emails)
// ============================================================

function queueLeadEmail(ss, d) {
  const c = d.contact || {};
  const phoneKey = normalizeKey(c.phone);
  const emailKey = normalizeKey(c.email);

  // Guard: if this phone/email already appears in Schedule Requests, the
  // customer scheduled before (or simultaneously with) submitting contact —
  // the callback email will fire, so we must NOT also send a lead email.
  const scheduledKeys = collectAllScheduleKeys(ss);
  if ((phoneKey && scheduledKeys.has(phoneKey)) || (emailKey && scheduledKeys.has(emailKey))) {
    return;
  }

  const sheet = getOrCreate(ss, SHEETS.pending);
  sheet.appendRow([
    new Date(),
    phoneKey,
    emailKey,
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

  // Check ALL schedule rows — no time limit. If someone's phone or email
  // appears anywhere in Schedule Requests (regardless of when they scheduled),
  // we never send a lead email for them. This covers the case where the person
  // spends more than EMAIL_DELAY_MINUTES on the result screen before clicking
  // "Schedule a Follow-Up" — the old time-bounded check would miss them.
  const scheduledKeys = collectAllScheduleKeys(ss);

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

/**
 * Returns a Set of all normalized phone and email keys that appear in the
 * Schedule Requests sheet — no time filter. Used by processPendingLeads to
 * ensure a lead email is never sent once someone has scheduled, regardless
 * of whether they scheduled before or after the EMAIL_DELAY_MINUTES window.
 */
function collectAllScheduleKeys(ss) {
  const sheet = ss.getSheetByName(SHEETS.schedule.name);
  const keys = new Set();
  if (!sheet) return keys;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;
  // Schedule Requests columns (1-indexed): 1=Estimate#, 2=Timestamp, 3=Name, 4=Phone, 5=Email
  const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (const r of rows) {
    const pk = normalizeKey(r[3]);
    const ek = normalizeKey(r[4]);
    if (pk) keys.add(pk);
    if (ek) keys.add(ek);
  }
  return keys;
}

function collectRecentScheduleKeys(ss, minutesBack) {
  const sheet = ss.getSheetByName(SHEETS.schedule.name);
  const keys = new Set();
  if (!sheet) return keys;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;

  const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
  // Schedule Requests columns: 1=Estimate#, 2=Timestamp, 3=Name, 4=Phone, 5=Email
  // (Was 4-col read at 1=Timestamp, 3=Phone, 4=Email before Estimate # was
  //  added as col 1 — that staleness caused a stray Bobo lead email to fire
  //  even after the callback was confirmed.)
  const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (const r of rows) {
    const ts = r[1] instanceof Date ? r[1] : new Date(r[1]);
    if (!isNaN(ts.getTime()) && ts < cutoff) continue;
    const pk = normalizeKey(r[3]);
    const ek = normalizeKey(r[4]);
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
      'Estimate submitted ' + EMAIL_DELAY_MINUTES + '+ minutes ago, no callback scheduled yet. ' +
      'If they schedule one later, you\'ll get a follow-up email referencing this same Estimate #.</p>',
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

  // Heading + subject reflect how the customer wants to be reached
  const method = d.contactMethod || 'phone_call';
  const methodHeading = method === 'text'  ? 'Followup Text Requested'
                      : method === 'email' ? 'Followup Email Requested'
                      :                     'Callback Requested';
  const subject = methodHeading + ' - ' + (service ? service + ' ' : '') + (c.name || 'Pine Point');

  // Contact reach-back row: show phone for call/text, email for email method
  const reachLabel  = method === 'email' ? 'Reply to'    : 'Call / text';
  const reachValue  = method === 'email' ? emailLink(c.email) : phoneLink(c.phone);
  const callerRows  = contactRows(c, d.areaCheck).concat([
    ['Reach via', '<strong>' + escapeHtml(methodHeading) + '</strong>'],
    [reachLabel,  reachValue],
    // Best time only relevant for phone call
    ...(method === 'phone_call'
      ? [['Best time', '<strong>' + escapeHtml(d.scheduledTime || '(any)') + '</strong>']]
      : [])
  ]);

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#222">',
    '<h2 style="margin:0 0 4px;color:#2D5A27">' + escapeHtml(methodHeading) + '</h2>',
    num ? '<p style="margin:0 0 12px;font-size:13px;color:#444">Estimate #: <strong>' + escapeHtml(num) + '</strong></p>' : '<div style="height:12px"></div>',
    leadFollowupBanner(d),
    outsideAreaBanner(d.areaCheck),
    htmlSection('Caller', callerRows),
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
  const rows = [
    ['Name', escapeHtml(c.name || '(none)')],
    ['Phone', phoneLink(c.phone)],
    ['Email', emailLink(c.email)],
    ['ZIP', escapeHtml(zipLine || '(none)')]
  ];
  if (usps && typeof usps.miles === 'number') {
    rows.push(['Distance', escapeHtml(usps.miles.toFixed(1) + ' mi from Leicester')]);
  }
  return rows;
}

/**
 * Yellow info banner shown on callback emails when the lead email
 * already went out earlier — tells Jason this is the SAME customer
 * he's already been notified about, not a brand-new lead.
 */
function leadFollowupBanner(d) {
  if (!d.leadEmailAlreadySent) return '';
  const when = d.priorEstimateAt
    ? Utilities.formatDate(new Date(d.priorEstimateAt), Session.getScriptTimeZone(), "MMM d, h:mm a")
    : '';
  const num = d.estimateNumber || '';
  return [
    '<div style="margin:0 0 16px;padding:10px 14px;background:#fff8d4;border:1px solid #d4ad1a;border-radius:4px;color:#5a4a00;font-size:14px">',
    '<strong>ℹ Update on existing lead' + (num ? ' #' + escapeHtml(num) : '') + '.</strong> ',
    'A "New Lead" email was already sent for this customer',
    when ? ' (estimate submitted ' + escapeHtml(when) + ')' : '',
    '. They are now scheduling the callback.',
    '</div>'
  ].join('');
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
    if (def.hidden) s.hideSheet();
  } else if (def.hidden && !s.isSheetHidden()) {
    s.hideSheet();
  }
  return s;
}

/**
 * Forwards a handoff-page submission as a plain email. Subject + body
 * come from the form fields; no sheet writes, no lead pipeline.
 *
 * Sent to fitfo@fitfosystems.com explicitly so it lands at the FITFO
 * inbox regardless of which Google account this script is deployed
 * under.
 */
// ============================================================
// /crew tool — internal estimate confirmation + quote tracking
// ============================================================

/**
 * Returns a list of leads for the crew tool. Reads from the All Leads
 * summary tab (one row per Estimate #). Filter "open" hides anything
 * already moved to Job Done / Invoiced via the Quotes tab.
 */
function listCrewLeads(ss, filter) {
  const summary = ss.getSheetByName(SHEETS.summary.name);
  if (!summary) return [];
  const lastRow = summary.getLastRow();
  if (lastRow < 2) return [];

  // Use getDisplayValues so leading-zero ZIPs survive (getValues turns
  // "01524" into the number 1524). Belt-and-suspenders: normalizeZip
  // pads any short numeric ZIPs after the read.
  const rows = summary.getRange(2, 1, lastRow - 1, 9).getDisplayValues();

  // Pull the Quotes tab to know which leads already have a Quote/Invoice in motion
  const quoteStatusByEst = readQuoteStatusByEstimate(ss);

  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {  // newest first (rows are appended)
    const r = rows[i];
    if (!r[0]) continue;
    const status = quoteStatusByEst[r[0]] || 'New';
    if (filter === 'open' && (status === 'Invoiced' || status === 'Job Done')) continue;
    out.push({
      estimateNumber: r[0],
      name: r[1] || '',
      phone: r[2] || '',
      email: r[3] || '',
      zip: normalizeZip(r[4]),
      leadType: r[5] || '',
      jobType: r[6] || '',
      estimateRange: r[7] || '',
      address: r[8] || '',
      status: status
    });
  }
  return out;
}

/**
 * Pads short numeric ZIPs back to 5 digits. Sheets coerces "01524"
 * into a number (1524), which loses the leading zero. Anything else
 * (full 5-digit ZIPs, ZIP+4 like 01524-1234, or already-formatted
 * strings) passes through.
 */
function normalizeZip(z) {
  if (z == null) return '';
  const s = String(z).trim();
  if (!s) return '';
  if (/^\d{1,4}$/.test(s)) return s.padStart(5, '0');
  return s;
}

/**
 * Build a map of Estimate # -> latest Quote status. If a customer has
 * multiple quotes (rare), the most recent wins.
 */
function readQuoteStatusByEstimate(ss) {
  const sheet = ss.getSheetByName(SHEETS.quotes.name);
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  // Columns: Quote # (1), Estimate # (2), Status (3) ...
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const out = {};
  for (let i = 0; i < data.length; i++) {
    const est = data[i][1];
    const status = data[i][2];
    if (est) out[est] = status || 'Draft';
  }
  return out;
}

/**
 * Returns full lead detail by Estimate # — pulls customer, service,
 * answers, the price range we showed them, address, and any existing
 * Quote draft so the crew can resume editing.
 */
function getCrewLead(ss, estimateNumber) {
  if (!estimateNumber) return null;
  const out = {
    estimateNumber: estimateNumber,
    contact: {},
    service: '',
    answers: {},
    customerEstimate: { low: '', typical: '', high: '' },
    photoLinks: [],
    quote: null,  // existing draft if any
    leadSource: ''
  };

  // Try Estimate Leads first (has full answers + price range).
  // getDisplayValues so leading-zero ZIPs etc. survive Sheet coercion.
  const leads = ss.getSheetByName(SHEETS.estimate_contact.name);
  if (leads && leads.getLastRow() > 1) {
    const rows = leads.getRange(2, 1, leads.getLastRow() - 1, leads.getLastColumn()).getDisplayValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === estimateNumber) {
        const row = rows[i];
        out.contact = {
          name:  row[2] || '', phone: row[3] || '', email: row[4] || '', zip: normalizeZip(row[5])
        };
        out.service = row[10] || '';
        out.answers = {
          treeCount:   row[11] || '',
          treeHeight:  row[12] || '',
          hazards:     row[13] || '',
          access:      row[14] || '',
          pruneType:   row[15] || '',
          lotSize:     row[16] || '',
          lotDensity:  row[17] || '',
          endGoal:     row[18] || ''
        };
        out.customerEstimate = {
          low:     row[19] || '',
          typical: row[20] || '',
          high:    row[21] || ''
        };
        out.notes = row[22] || '';
        out.photoLinks = parsePhotoLinks(row[23]);
        out.leadSource = 'estimate';
        break;
      }
    }
  }

  // Fall back / overlay with All Leads (carries Address)
  const summary = ss.getSheetByName(SHEETS.summary.name);
  if (summary && summary.getLastRow() > 1) {
    const rows = summary.getRange(2, 1, summary.getLastRow() - 1, 9).getDisplayValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === estimateNumber) {
        if (!out.contact.name)  out.contact.name  = rows[i][1] || '';
        if (!out.contact.phone) out.contact.phone = rows[i][2] || '';
        if (!out.contact.email) out.contact.email = rows[i][3] || '';
        if (!out.contact.zip)   out.contact.zip   = normalizeZip(rows[i][4]);
        out.contact.address = rows[i][8] || '';
        out.leadType = rows[i][5] || '';
        out.jobType  = rows[i][6] || '';
        if (!out.leadSource) out.leadSource = 'manual';
        break;
      }
    }
  }

  // Overlay any existing Quote draft so the crew can resume.
  out.quote = readLatestQuoteByEstimate(ss, estimateNumber);
  return out;
}

function parsePhotoLinks(cell) {
  if (!cell) return [];
  return String(cell).split(/\s*[\n,]+\s*/).filter(Boolean);
}

function readLatestQuoteByEstimate(ss, estimateNumber) {
  const sheet = ss.getSheetByName(SHEETS.quotes.name);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const cols = SHEETS.quotes.headers.length;
  // Use display values so leading-zero ZIPs survive Sheet coercion.
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getDisplayValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][1] === estimateNumber) {
      let trees = [];
      try { trees = JSON.parse(rows[i][9] || '[]'); } catch (e) {}
      return {
        quoteNumber:  rows[i][0],
        estimateNumber: rows[i][1],
        status:       rows[i][2],
        customer: {
          name: rows[i][3], address: rows[i][4], phone: rows[i][5], email: rows[i][6], zip: normalizeZip(rows[i][7])
        },
        service:     rows[i][8],
        trees:       trees,
        description: rows[i][10],
        total:       rows[i][11],
        customerEstimate: { low: rows[i][12], typical: rows[i][13], high: rows[i][14] },
        createdAt:    rows[i][15],
        sentAt:       rows[i][16],
        completedAt:  rows[i][17],
        invoicedAt:   rows[i][18],
        createdBy:    rows[i][19],
        notes:        rows[i][20],
        customerNote: rows[i][21] || '',
        pdfUrl:       rows[i][22] || ''
      };
    }
  }
  return null;
}

/**
 * Saves (or updates) a Quote row for a given Estimate #. Also
 * backfills the Address into the All Leads summary so the master
 * customer record stays in sync.
 *
 * Expected payload shape:
 *   formType: 'crew_save_quote'
 *   token: ...
 *   quote: {
 *     estimateNumber, customer: {name, address, phone, email, zip},
 *     service, trees: [{species, count, size, speciesOther?}],
 *     description, total,
 *     customerEstimate: {low, typical, high},
 *     notes
 *   }
 *   user: 'jason' | 'crew' | <email>
 */
function saveCrewQuote(ss, data) {
  const q = data.quote || {};
  if (!q.estimateNumber) return { error: 'missing estimateNumber' };

  const sheet = getOrCreate(ss, SHEETS.quotes);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = readLatestQuoteByEstimate(ss, q.estimateNumber);
    const quoteNumber = (existing && existing.quoteNumber) || nextQuoteNumber();
    const now = new Date();
    const c = q.customer || {};
    const ce = q.customerEstimate || {};
    // Pad short ZIPs and prefix with an apostrophe so Sheets stores
    // them as text — without this the cell value "01524" gets coerced
    // back to the number 1524 on write.
    const zipNorm = normalizeZip(c.zip || '');
    const zipForSheet = zipNorm ? "'" + zipNorm : '';
    const row = [
      quoteNumber,
      q.estimateNumber,
      (existing && existing.status) || 'Draft',
      c.name || '',
      c.address || '',
      c.phone || '',
      c.email || '',
      zipForSheet,
      q.service || '',
      JSON.stringify(q.trees || []),
      q.description || '',
      q.total || '',
      ce.low || '',
      ce.typical || '',
      ce.high || '',
      existing && existing.createdAt ? existing.createdAt : now,
      existing && existing.sentAt ? existing.sentAt : '',
      existing && existing.completedAt ? existing.completedAt : '',
      existing && existing.invoicedAt ? existing.invoicedAt : '',
      data.user || existing && existing.createdBy || '',
      q.notes || '',
      q.customerNote || '',
      existing && existing.pdfUrl ? existing.pdfUrl : ''
    ];

    if (existing) {
      // Find and update the existing row
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (ids[i][0] === existing.quoteNumber) {
            sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
            break;
          }
        }
      }
    } else {
      sheet.appendRow(row);
    }

    // Backfill address into All Leads so the master record carries it.
    backfillAddressOnSummary(ss, q.estimateNumber, c.address || '');

    return { ok: true, quoteNumber: quoteNumber };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Quote numbers share the Estimate # year-monotonic pattern so they're
 * easy to scan by date. Stored under quote_counter_<year>.
 */
function nextQuoteNumber() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const yyyy = String(new Date().getFullYear());
    const key = 'quote_counter_' + yyyy;
    const next = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(next));
    return 'Q' + yyyy + '_' + String(next).padStart(5, '0');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates the Address column in All Leads for a given Estimate #.
 * Only writes if the new address is non-empty AND differs from what's
 * there — never blanks out an existing address.
 */
function backfillAddressOnSummary(ss, estimateNumber, address) {
  if (!estimateNumber || !address) return;
  const sheet = ss.getSheetByName(SHEETS.summary.name);
  if (!sheet || sheet.getLastRow() < 2) return;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === estimateNumber) {
      // Address column is index 9 (1-based) per SHEETS.summary.headers
      sheet.getRange(i + 2, 9).setValue(address);
      return;
    }
  }
}

/**
 * Creates a manual lead — for phone-call leads that didn't come
 * through the online estimate. Generates a fresh Estimate #, writes
 * to All Leads as a "Lead", and returns the new ID so the crew tool
 * can immediately open it for editing.
 *
 * Expected payload:
 *   formType: 'crew_create_lead'
 *   token: ...
 *   contact: { name, phone, email, zip, address }
 *   service: 'removal' | 'trimming' | 'lot_clearing' | ''
 *   notes: string
 */
function createCrewLead(ss, data) {
  const c = data.contact || {};
  if (!c.name && !c.phone) return { error: 'name or phone required' };
  const estimateNumber = nextEstimateNumber();
  const summary = getOrCreate(ss, SHEETS.summary);
  const jobType = SERVICE_NAMES[data.service] || data.service || '';
  // Apostrophe-prefix the ZIP so Sheets stores it as text (preserves
  // leading zeros). normalizeZip pads any short numeric ZIPs first.
  const zipNorm = normalizeZip(c.zip || '');
  const zipForSheet = zipNorm ? "'" + zipNorm : '';
  summary.appendRow([
    estimateNumber,
    c.name || '',
    c.phone || '',
    c.email || '',
    zipForSheet,
    'Lead',
    jobType,
    '',  // Estimate Range — empty for manual leads
    c.address || ''
  ]);
  return { ok: true, estimateNumber: estimateNumber };
}

// ============================================================
// Quote / Invoice PDF generation
// ============================================================

/**
 * Returns the Drive folder where generated PDFs land. Created once
 * on first call, then reused.
 */
function getOrCreateQuoteFolder() {
  const it = DriveApp.getFoldersByName(QUOTES_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(QUOTES_FOLDER_NAME);
}

/**
 * One-time setup. Builds the Quote/Invoice template Doc with
 * placeholders Apps Script can replace per-quote. After install,
 * Jason can edit the Doc visually in Google Docs anytime — placeholder
 * tokens stay intact; layout / fonts / canned paragraphs are his.
 *
 * Run once from the Apps Script editor: Run -> installQuoteTemplate.
 * Re-running surfaces the existing template ID without rebuilding.
 * Use rebuildQuoteTemplate() to wipe the existing one and start fresh.
 */
function installQuoteTemplate() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('quote_template_doc_id');
  if (existing) {
    try {
      DriveApp.getFileById(existing);  // verify it still exists
      console.log('Quote template already installed at:');
      console.log('https://docs.google.com/document/d/' + existing + '/edit');
      return existing;
    } catch (e) {
      // Template was deleted; fall through and rebuild.
    }
  }
  const id = buildQuoteTemplateDoc_();
  props.setProperty('quote_template_doc_id', id);
  console.log('Quote template installed:');
  console.log('https://docs.google.com/document/d/' + id + '/edit');
  return id;
}

function rebuildQuoteTemplate() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('quote_template_doc_id');
  if (existing) {
    try { DriveApp.getFileById(existing).setTrashed(true); } catch (e) {}
  }
  const id = buildQuoteTemplateDoc_();
  props.setProperty('quote_template_doc_id', id);
  console.log('Template rebuilt: https://docs.google.com/document/d/' + id + '/edit');
  return id;
}

function buildQuoteTemplateDoc_() {
  const doc = DocumentApp.create('Pine Point Quote Template');
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);
  // Clear default empty paragraph so we don't leave a stray blank line at top.
  body.clear();

  // --- HEADER: logo (left) + company info (right) in a 2-col table ---
  let logoBlob = null;
  try {
    logoBlob = UrlFetchApp.fetch(LOGO_URL).getBlob().setName('PinePointLogo.png');
  } catch (e) {
    logoBlob = null;  // graceful fallback to text-only header if fetch fails
  }
  const headerTable = body.appendTable([['', '']]);
  headerTable.setBorderWidth(0);
  const logoCell = headerTable.getCell(0, 0);
  const infoCell = headerTable.getCell(0, 1);
  logoCell.setWidth(120);
  logoCell.clear();
  if (logoBlob) {
    logoCell.appendImage(logoBlob).setWidth(110).setHeight(110);
  } else {
    logoCell.appendParagraph('PINE POINT').setBold(true);
  }

  infoCell.clear();
  const companyTitle = infoCell.appendParagraph('Pine Point Tree Service LLC');
  companyTitle.setBold(true).setFontSize(16).setForegroundColor('#1C1C1C');
  const addr1 = infoCell.appendParagraph('710 Whittemore St   (774) 262-2145');
  addr1.setFontSize(10).setForegroundColor('#444444');
  const addr2 = infoCell.appendParagraph('Leicester, MA 01524   pinepointtreeservice@gmail.com');
  addr2.setFontSize(10).setForegroundColor('#444444');

  body.appendParagraph(' ').setFontSize(8);

  // --- Customer address (left) + Quote/Invoice number badge (right) ---
  const topTable = body.appendTable([['', '']]);
  topTable.setBorderWidth(0);
  const custCell = topTable.getCell(0, 0);
  const numCell  = topTable.getCell(0, 1);
  custCell.clear();
  custCell.appendParagraph('{{customer_name}}').setBold(true).setFontSize(11);
  custCell.appendParagraph('{{customer_address}}').setFontSize(11).setForegroundColor('#222222');

  numCell.clear();
  // Green badge with quote/invoice number
  const badge = numCell.appendParagraph('{{header_label}}{{quote_number}}');
  badge.setBold(true).setFontSize(13).setForegroundColor('#FFFFFF');
  badge.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  numCell.setBackgroundColor('#2D5A27');
  numCell.setPaddingTop(8).setPaddingBottom(8);

  body.appendParagraph(' ').setFontSize(8);

  // Issue date row
  const issueTable = body.appendTable([['Issue Date', '{{issue_date}}']]);
  issueTable.setBorderWidth(0);
  const issLabelCell = issueTable.getCell(0, 0);
  const issValueCell = issueTable.getCell(0, 1);
  issLabelCell.editAsText().setBold(true);
  issValueCell.editAsText().setBold(false);
  issLabelCell.setWidth(120);

  body.appendParagraph(' ').setFontSize(8);

  // --- Line item table: SERVICE | DESCRIPTION | TOTAL ---
  const lineTable = body.appendTable([
    ['SERVICE', 'DESCRIPTION', 'TOTAL'],
    ['TREE WORK', '{{description}}', '{{total}}']
  ]);
  // Header row styling
  for (let c = 0; c < 3; c++) {
    const hcell = lineTable.getCell(0, c);
    hcell.setBackgroundColor('#2D5A27');
    hcell.editAsText().setBold(true).setForegroundColor('#FFFFFF').setFontSize(10);
  }
  lineTable.getCell(0, 0).setWidth(110);
  lineTable.getCell(0, 2).setWidth(85);
  lineTable.getCell(1, 0).editAsText().setBold(true).setFontSize(11);
  lineTable.getCell(1, 1).editAsText().setFontSize(10);
  lineTable.getCell(1, 2).editAsText().setBold(true).setFontSize(11);
  lineTable.getCell(1, 2).setBackgroundColor('#FFFFFF');
  lineTable.getCell(1, 2).getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  body.appendParagraph(' ').setFontSize(6);

  // --- Total row ---
  const totalTable = body.appendTable([['Total', '{{total}}']]);
  totalTable.setBorderWidth(0);
  totalTable.getCell(0, 0).editAsText().setBold(true).setFontSize(11);
  totalTable.getCell(0, 1).editAsText().setBold(true).setFontSize(12);
  totalTable.getCell(0, 1).getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  body.appendParagraph(' ').setFontSize(8);

  // --- Optional customer note (replaced or stripped per-quote) ---
  const noteSep = body.appendParagraph('{{customer_note_block}}');
  noteSep.setFontSize(10).setForegroundColor('#222222').setItalic(true);

  body.appendParagraph(' ').setFontSize(6);

  // --- Authorization paragraph (canned — Jason can edit this in Docs anytime) ---
  const authP = body.appendParagraph(
    'Authorization: By signing below, the customer authorizes the work described in this proposal to be performed. Payment is due upon completion of the work.'
  );
  authP.setFontSize(10).setForegroundColor('#222222').setBold(false);

  body.appendParagraph(' ').setFontSize(8);

  // --- Signature line ---
  body.appendParagraph('Customer Signature: ____________________________   Date: ____________')
      .setFontSize(11).setBold(true);

  doc.saveAndClose();
  return doc.getId();
}

/**
 * Renders a quote into a PDF: copy template, replace placeholders,
 * export PDF, save in the Quotes folder, set sharing so the URL is
 * viewable by anyone with the link, return the URL set.
 *
 * options.asInvoice (bool) — flips the header label from Quote to Invoice.
 */
function generateQuotePdf(quote, options) {
  options = options || {};
  const props = PropertiesService.getScriptProperties();
  const templateId = props.getProperty('quote_template_doc_id');
  if (!templateId) throw new Error('Quote template missing — run installQuoteTemplate() once.');

  const headerLabel = options.asInvoice ? 'Invoice #' : 'Quote #';
  const tz = Session.getScriptTimeZone();
  const issueDate = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');
  const totalNum = Number(quote.total) || 0;
  const totalText = '$' + totalNum.toLocaleString('en-US');
  const noteBlock = quote.customerNote ? quote.customerNote : '';

  // Copy the template into a temp doc.
  const templateFile = DriveApp.getFileById(templateId);
  const tempCopy = templateFile.makeCopy('temp_quote_' + Date.now());
  const tempId = tempCopy.getId();
  try {
    const tempDoc = DocumentApp.openById(tempId);
    const tempBody = tempDoc.getBody();
    tempBody.replaceText('{{header_label}}', headerLabel);
    tempBody.replaceText('{{quote_number}}', quote.quoteNumber || '');
    tempBody.replaceText('{{customer_name}}', quote.customer && quote.customer.name ? quote.customer.name : '');
    tempBody.replaceText('{{customer_address}}', quote.customer && quote.customer.address ? quote.customer.address : '');
    tempBody.replaceText('{{issue_date}}', issueDate);
    tempBody.replaceText('{{description}}', quote.description || '');
    tempBody.replaceText('{{total}}', totalText);
    tempBody.replaceText('{{customer_note_block}}', noteBlock);
    tempDoc.saveAndClose();

    const pdfBlob = DriveApp.getFileById(tempId).getAs('application/pdf');
    const cleanName = (quote.customer && quote.customer.name ? quote.customer.name : 'customer').replace(/[^\w\s\-]/g, '').trim();
    const filename = (options.asInvoice ? 'Invoice_' : 'Quote_') + (quote.quoteNumber || '') + '_' + cleanName.replace(/\s+/g, '_') + '.pdf';
    pdfBlob.setName(filename);

    const folder = getOrCreateQuoteFolder();
    const pdfFile = folder.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return {
      url: pdfFile.getUrl(),
      embedUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId(),
      fileId: pdfFile.getId(),
      filename: filename
    };
  } finally {
    // Always trash the temp Doc copy.
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {}
  }
}

/**
 * Sends the quote/invoice PDF by email. mode 'customer' goes to the
 * customer; mode 'preview' goes to the script owner so Jason can
 * review before sending.
 */
function sendQuotePdfEmail(quote, pdfFileId, mode, options) {
  options = options || {};
  const isInvoice = !!options.asInvoice;
  const docLabel = isInvoice ? 'invoice' : 'quote';
  const subjectPrefix = isInvoice ? 'Pine Point Tree Service invoice' : 'Pine Point Tree Service quote';
  const subject = subjectPrefix + ' — ' + (isInvoice ? 'Invoice ' : 'Quote ') + (quote.quoteNumber || '');

  const cust = (quote.customer && quote.customer.name) || 'there';
  const customerNoteHtml = quote.customerNote ? '<p style="margin:0 0 12px 0">' + escapeHtml(quote.customerNote) + '</p>' : '';
  const greeting = isInvoice
    ? 'Hi ' + escapeHtml(cust) + ',<br><br>Attached is the invoice for the work we completed. Thanks for choosing Pine Point.'
    : 'Hi ' + escapeHtml(cust) + ',<br><br>Attached is the ' + docLabel + ' for the tree work we discussed. Let me know if anything looks off — otherwise sign and send back when you\'re ready.';

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#222">',
    customerNoteHtml,
    '<p style="margin:0 0 12px 0">' + greeting + '</p>',
    '<p style="margin:0 0 4px 0">— Jason, Pine Point Tree Service</p>',
    '<p style="margin:0;color:#444">(774) 262-2145</p>',
    '</div>'
  ].join('');

  const pdfBlob = DriveApp.getFileById(pdfFileId).getBlob();
  const recipient = (mode === 'customer')
    ? (quote.customer && quote.customer.email ? quote.customer.email : '')
    : Session.getEffectiveUser().getEmail();
  if (!recipient) return { error: 'no recipient (customer email missing?)' };

  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: html,
      replyTo: REPLY_TO_EMAIL,
      name: 'Pine Point Tree Service',
      attachments: [pdfBlob]
    });
    return { ok: true, sentTo: recipient };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * doPost handler for crew_send_quote — generates the PDF if missing
 * and emails per the requested mode (customer | preview). Caller
 * gets back { ok, pdfUrl, embedUrl, sentTo }.
 *
 * If options.asInvoice is true, this is the post-job send.
 */
function handleCrewSendQuote(ss, data) {
  if (!data.estimateNumber) return { error: 'missing estimateNumber' };
  const existing = readLatestQuoteByEstimate(ss, data.estimateNumber);
  if (!existing) return { error: 'no quote saved for this lead yet' };

  const asInvoice = !!data.asInvoice;
  const pdf = generateQuotePdf(existing, { asInvoice: asInvoice });
  let sendResult = null;
  if (data.mode === 'customer' || data.mode === 'preview') {
    sendResult = sendQuotePdfEmail(existing, pdf.fileId, data.mode, { asInvoice: asInvoice });
  }

  // Update the Quotes row with the latest PDF URL, status, and timestamps.
  const sheet = ss.getSheetByName(SHEETS.quotes.name);
  if (sheet && sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === existing.quoteNumber) {
        const row = i + 2;
        // Column 23 = PDF Url
        sheet.getRange(row, 23).setValue(pdf.url);
        // Status flips on a real send to customer
        if (data.mode === 'customer') {
          if (asInvoice) {
            sheet.getRange(row, 3).setValue('Invoiced');
            sheet.getRange(row, 19).setValue(new Date());  // Invoiced At
          } else {
            sheet.getRange(row, 3).setValue('Sent');
            sheet.getRange(row, 17).setValue(new Date());  // Sent At
          }
        }
        break;
      }
    }
  }

  return {
    ok: true,
    pdfUrl: pdf.url,
    embedUrl: pdf.embedUrl,
    fileId: pdf.fileId,
    sent: !!(sendResult && sendResult.ok),
    sentTo: sendResult ? sendResult.sentTo : '',
    sendError: sendResult && sendResult.error ? sendResult.error : ''
  };
}

/**
 * doPost handler for crew_mark_complete — flips a quote's status to
 * Job Done and stamps Completed At. The next "send invoice" call
 * generates the PDF with the Invoice header and updates status to
 * Invoiced.
 */
function handleCrewMarkComplete(ss, data) {
  if (!data.estimateNumber) return { error: 'missing estimateNumber' };
  const existing = readLatestQuoteByEstimate(ss, data.estimateNumber);
  if (!existing) return { error: 'no quote saved for this lead' };

  const sheet = ss.getSheetByName(SHEETS.quotes.name);
  if (!sheet) return { error: 'Quotes sheet missing' };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: 'no rows' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === existing.quoteNumber) {
      const row = i + 2;
      sheet.getRange(row, 3).setValue('Job Done');
      sheet.getRange(row, 18).setValue(new Date());  // Completed At
      return { ok: true, quoteNumber: existing.quoteNumber, status: 'Job Done' };
    }
  }
  return { error: 'quote row not found' };
}

/**
 * Writes a wood signup row to the dedicated "Wood Signups" tab.
 * Mirrors the schedule/estimate writers for consistency.
 */
function writeWoodSignup(ss, d) {
  const sheet = getOrCreate(ss, SHEETS.wood_signup);
  const c = d.contact || {};
  const ac = d.areaCheck || {};
  const distance = (ac.ok && typeof ac.miles === 'number') ? Number(ac.miles.toFixed(1)) : '';
  const outside = ac.ok ? (ac.withinServiceArea ? '' : 'YES') : '';
  const productLabel = {
    chips: 'Wood chips',
    logs:  'Log-length firewood',
    both:  'Chips + log-length firewood'
  }[d.productType] || d.productType || '';
  const mixLabel = {
    mixed:         'Hardwood + softwood mix',
    hardwood_only: 'Hardwood only'
  }[d.woodMix] || '';
  sheet.appendRow([
    new Date(),
    c.name || '', c.phone || '', c.email || '',
    c.zip || '', ac.city || '', ac.state || '', distance, outside,
    productLabel,
    mixLabel,
    d.notes || '',
    d.page || ''
  ]);
}

/**
 * Sends Jason an email alert when someone signs up for free wood.
 * Subject reflects the product type so he can scan the inbox.
 */
function sendWoodSignupEmail(d) {
  const c = d.contact || {};
  const productLabel = {
    chips: 'Chips',
    logs:  'Logs',
    both:  'Chips + Logs'
  }[d.productType] || 'Wood';
  const subject = 'New wood signup - ' + productLabel + ' - ' + (c.name || 'Pine Point');

  const productDisplay = {
    chips: 'Wood chips',
    logs:  'Log-length firewood',
    both:  'Both (chips + log-length firewood)'
  }[d.productType] || d.productType || '';

  const mixDisplay = (d.productType === 'chips')
    ? 'n/a (chips only)'
    : ({ mixed: 'Hardwood + softwood mix', hardwood_only: 'Hardwood only' }[d.woodMix] || '(not specified)');

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#222">',
    '<h2 style="margin:0 0 4px;color:#2D5A27">New Wood Signup</h2>',
    '<p style="margin:0 0 12px;font-size:13px;color:#444">Free chips / log-length firewood request from pinepointtrees.com.</p>',
    outsideAreaBanner(d.areaCheck),
    htmlSection('Caller', contactRows(c, d.areaCheck)),
    htmlSection('Wants', [
      ['Product', '<strong>' + escapeHtml(productDisplay) + '</strong>'],
      ['Wood mix', escapeHtml(mixDisplay)]
    ]),
    d.notes ? htmlSection('Their note', [['', escapeHtml(d.notes)]]) : '',
    '</div>'
  ].join('');

  sendHtmlEmail(subject, html);
}

function sendHandoffEmail(data) {
  const HANDOFF_NOTIFY = 'fitfo@fitfosystems.com';
  const subject = data._subject || ('[Pine Point handoff] ' + (data.formType || 'note'));
  const lines = [];
  if (data.message) lines.push(String(data.message));
  if (data.kind) lines.push('', '---', 'Kind: ' + data.kind);
  if (data.page) lines.push('Page: ' + data.page);
  if (data.ok_count != null || data.issue_count != null) {
    lines.push('OK: ' + (data.ok_count || 0) + ', Issues: ' + (data.issue_count || 0) + ', Untested: ' + (data.untested_count || 0));
  }
  const emailOpts = {};
  if (data.invoice_attachments) {
    try {
      const files = JSON.parse(data.invoice_attachments);
      if (Array.isArray(files) && files.length) {
        emailOpts.attachments = files.map(f =>
          Utilities.newBlob(Utilities.base64Decode(f.data_base64), f.mimeType || 'application/octet-stream', f.filename)
        );
      }
    } catch (e) {
      lines.push('(Note: invoice attachment decode failed — ' + String(e) + ')');
    }
  }
  try {
    MailApp.sendEmail(HANDOFF_NOTIFY, subject, lines.join('\n') || '(empty body)', emailOpts);
  } catch (e) {
    // Don't crash the request if email fails — POSTer doesn't need to know.
  }
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

/**
 * One-time setup for the /crew tool. Run once from the Apps Script
 * editor (Run → installCrewToken). Generates a 40-char random token,
 * stores it in ScriptProperties, and prints the URL Jason should save
 * to his phone home screen. Re-running surfaces the existing token
 * (does not rotate). Use rotateCrewToken() to force a new one.
 */
function installCrewToken() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('crew_access_token');
  if (existing) {
    console.log('Crew access token already set:');
    console.log(existing);
    console.log('Crew URL: https://pinepointtrees.com/crew?t=' + existing);
    return existing;
  }
  const token = generateCrewToken_();
  props.setProperty('crew_access_token', token);
  console.log('Crew access token created. Save the URL — share with crew via:');
  console.log('https://pinepointtrees.com/crew?t=' + token);
  return token;
}

/**
 * Rotate the crew token. Use if the URL leaks or someone leaves —
 * everyone needs the new URL on their phone after this.
 */
function rotateCrewToken() {
  const token = generateCrewToken_();
  PropertiesService.getScriptProperties().setProperty('crew_access_token', token);
  console.log('Crew access token rotated. New URL:');
  console.log('https://pinepointtrees.com/crew?t=' + token);
  return token;
}

function generateCrewToken_() {
  const bytes = Utilities.getUuid().replace(/-/g, '') +
                Utilities.getUuid().replace(/-/g, '');
  return bytes.slice(0, 40);
}
