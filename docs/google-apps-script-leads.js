/**
 * Pine Point — Lead Capture Endpoint
 *
 * Receives JSON POSTs from pinepointtrees.com (estimate.html):
 *   - formType: "estimate_contact" — user submitted contact form on the estimate page
 *   - formType: "schedule"         — user clicked "Schedule a Follow-Up" after seeing price
 *
 * Writes each submission as a row to the bound Google Sheet (separate tab per type)
 * and emails a notification to NOTIFY_EMAIL. Designed to run as a Web App deployed
 * with "Anyone" access so the website can POST anonymously.
 *
 * Setup steps live in docs/LEAD-CAPTURE-SETUP.md.
 */

// Sends notifications to whoever owns this Apps Script (the Google account used to deploy).
// Replace with a different email if you want notifications elsewhere.
const NOTIFY_EMAIL = Session.getEffectiveUser().getEmail();

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
  }
};

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.formType === 'estimate_contact') {
      writeEstimate(ss, data);
    } else if (data.formType === 'schedule') {
      writeSchedule(ss, data);
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

  notify(
    'New Estimate Lead — Pine Point',
    [
      'NEW LEAD — Pine Point Tree Service',
      '====================================',
      'Submitted: ' + new Date().toLocaleString(),
      '',
      'Name:  ' + (c.name || '(none)'),
      'Phone: ' + (c.phone || '(none)'),
      'Email: ' + (c.email || '(none)'),
      'Town:  ' + (c.town || '(none)'),
      '',
      'Service: ' + (d.service || ''),
      'Details: ' + JSON.stringify(a),
      '',
      'Estimated price: $' + (p.low || '?') + '–$' + (p.high || '?') +
        ' (typical $' + (p.typical || '?') + ')',
      '',
      'Notes: ' + (c.notes || '(none)'),
      '',
      'Page: ' + (d.page || '')
    ].join('\n')
  );
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

  notify(
    'New Schedule Request — Pine Point',
    [
      'CALL REQUEST — Pine Point Tree Service',
      '======================================',
      'Submitted: ' + new Date().toLocaleString(),
      '',
      c.name + ' (' + c.phone + ') wants a call: ' + (d.scheduledTime || ''),
      'Email: ' + (c.email || '(none)'),
      '',
      'Service: ' + (d.service || ''),
      'Details: ' + JSON.stringify(d.answers || {}),
      'Estimate (typical): $' + (p.typical || '?'),
      '',
      'Notes: ' + (d.scheduleNotes || '(none)')
    ].join('\n')
  );
}

function writeUnknown(ss, d) {
  const sheet = getOrCreate(ss, { name: 'Other', headers: ['Timestamp', 'Raw'] });
  sheet.appendRow([new Date(), JSON.stringify(d)]);
}

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
