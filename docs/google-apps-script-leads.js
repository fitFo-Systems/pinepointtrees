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
 * Setup once per deployment — see docs/LEAD-CAPTURE-SETUP.md for the full walk-through.
 * Short version:
 *   1. Paste this code into Code.gs in the Apps Script editor
 *   2. Run → installTrigger (creates the 1-min time trigger)
 *   3. Deploy → New deployment → Web app → "Anyone" access
 */

const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail();
const EMAIL_DELAY_MINUTES = 5;

const SHEETS = {
  estimate_contact: {
    name: 'Estimate Leads',
    headers: [
      'Timestamp', 'Name', 'Phone', 'Email', 'Town',
      'Service', 'Tree Count', 'Tree Height', 'Hazards', 'Access',
      'Prune Type', 'Lot Size', 'Lot Density', 'End Goal',
      'Price Low', 'Price Typical', 'Price High',
      'Notes', 'Page'
    ]
  },
  schedule: {
    name: 'Schedule Requests',
    headers: [
      'Timestamp', 'Name', 'Phone', 'Email', 'Best Time',
      'Service', 'Details', 'Price Typical', 'Notes', 'Page'
    ]
  },
  pending: {
    name: '_Pending Lead Emails',
    headers: ['Queued At', 'Phone Key', 'Email Key', 'Payload JSON']
  }
};

const SERVICE_NAMES = {
  removal: 'Tree Removal',
  trimming: 'Trimming & Pruning',
  lot_clearing: 'Lot Clearing'
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
      writeEstimate(ss, data);
      queueLeadEmail(ss, data);
    } else if (data.formType === 'schedule') {
      writeSchedule(ss, data);
      cancelPendingFor(ss, data);
      sendCallbackEmail(data);
    } else {
      writeUnknown(ss, data);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
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
  sheet.appendRow([
    new Date(),
    c.name || '', c.phone || '', c.email || '', c.town || '',
    d.service || '',
    a.treeCount || '', a.treeHeight || '', a.hazards || '', a.access || '',
    a.pruneType || '', a.lotSize || '', a.lotDensity || '', a.endGoal || '',
    p.low || '', p.typical || '', p.high || '',
    c.notes || '', d.page || ''
  ]);
}

function writeSchedule(ss, d) {
  const sheet = getOrCreate(ss, SHEETS.schedule);
  const c = d.contact || {};
  const p = d.price || {};
  sheet.appendRow([
    new Date(),
    c.name || '', c.phone || '', c.email || '',
    d.scheduledTime || '',
    d.service || '', JSON.stringify(d.answers || {}),
    p.typical || '',
    d.scheduleNotes || '',
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

function cancelPendingFor(ss, d) {
  const sheet = ss.getSheetByName(SHEETS.pending.name);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const c = d.contact || {};
  const phoneKey = normalizeKey(c.phone);
  const emailKey = normalizeKey(c.email);
  if (!phoneKey && !emailKey) return;

  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  // Iterate bottom-up so deleteRow indices stay correct.
  for (let i = rows.length - 1; i >= 0; i--) {
    const pendingPhone = rows[i][1];
    const pendingEmail = rows[i][2];
    const matchPhone = phoneKey && pendingPhone && phoneKey === pendingPhone;
    const matchEmail = emailKey && pendingEmail && emailKey === pendingEmail;
    if (matchPhone || matchEmail) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * Called by the 1-minute time trigger installed by installTrigger().
 * Walks the pending queue and sends a "New Lead" email for any entry older
 * than EMAIL_DELAY_MINUTES. Entries cancelled by a schedule submission are
 * already gone from the queue.
 */
function processPendingLeads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.pending.name);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const cutoff = new Date(Date.now() - EMAIL_DELAY_MINUTES * 60 * 1000);
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    const queuedAt = new Date(rows[i][0]);
    if (queuedAt > cutoff) continue;

    try {
      const data = JSON.parse(rows[i][3]);
      sendLeadEmail(data);
    } catch (e) {
      // Skip malformed rows but still remove from queue.
    }
    sheet.deleteRow(i + 2);
  }
}

// ============================================================
// Email composition
// ============================================================

function sendLeadEmail(d) {
  const c = d.contact || {};
  const p = d.price || {};
  const subject = 'New Lead — ' + (c.name || 'Pine Point');
  const body = [
    'NEW LEAD — Pine Point Tree Service',
    '(They got an estimate but did not schedule a callback)',
    '====================================================',
    '',
    'Contact:',
    '  Name:  ' + (c.name || '(none)'),
    '  Phone: ' + (c.phone || '(none)'),
    '  Email: ' + (c.email || '(none)'),
    '  Town:  ' + (c.town || '(none)'),
    '',
    'Service: ' + (SERVICE_NAMES[d.service] || d.service || ''),
    formatAnswers(d.service, d.answers),
    '',
    'Estimated price range:',
    '  Low:     $' + (p.low || '?'),
    '  Typical: $' + (p.typical || '?'),
    '  High:    $' + (p.high || '?'),
    '',
    'Their notes: ' + (c.notes || '(none)'),
    '',
    'Source page: ' + (d.page || '')
  ].join('\n');
  notify(subject, body);
}

function sendCallbackEmail(d) {
  const c = d.contact || {};
  const p = d.price || {};
  const subject = 'Callback Requested — ' + (c.name || 'Pine Point');
  const body = [
    'CALLBACK REQUESTED — Pine Point Tree Service',
    '(They want a call — qualified lead)',
    '============================================',
    '',
    (c.name || '(name)') + ' (' + (c.phone || '?') + ')',
    'Best time to call:  ' + (d.scheduledTime || '(any)'),
    'Email:              ' + (c.email || '(none)'),
    '',
    'Service: ' + (SERVICE_NAMES[d.service] || d.service || ''),
    formatAnswers(d.service, d.answers),
    '',
    'Estimated price (typical): $' + (p.typical || '?'),
    '',
    'Their note: ' + (d.scheduleNotes || '(none)')
  ].join('\n');
  notify(subject, body);
}

function formatAnswers(service, answers) {
  if (!service || !answers) return '';
  const labelMap = LABELS[service] || {};
  const lines = [];
  for (const key of Object.keys(answers)) {
    const labelName = KEY_LABELS[key] || humanizeKey(key);
    const valueLabels = labelMap[key];
    const display = (valueLabels && valueLabels[answers[key]]) || answers[key];
    lines.push('  - ' + labelName + ': ' + display);
  }
  return lines.length ? 'Job details:\n' + lines.join('\n') : '';
}

function humanizeKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }).trim();
}

function normalizeKey(s) {
  return (s || '').toString().toLowerCase().replace(/[^0-9a-z@.]/g, '');
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

function notify(subject, body) {
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
  } catch (e) {
    // Don't fail the submission if email fails — sheet write is the source of truth.
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
