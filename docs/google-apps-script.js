/**
 * Pine Point Feedback — Google Apps Script Backend
 *
 * SETUP:
 * 1. Paste this into Code.gs (replace everything)
 * 2. Update YOUR_EMAIL below
 * 3. Run the "setup" function once (Run > setup) — this creates the spreadsheet
 * 4. Authorize when prompted (allow Sheets + Mail + Drive access)
 * 5. Deploy > New Deployment > Web app > Anyone > Deploy
 * 6. Copy the URL into feedback.html
 */

const YOUR_EMAIL = 'fitfo@fitfosystems.com'; // ← Change this to your email
const SHEET_ID = ''; // ← Leave blank first time. After running setup(), paste the Sheet ID here.

// Run this once to create the spreadsheet
function setup() {
  const ss = SpreadsheetApp.create('Pine Point Feedback');
  const sheet = ss.getActiveSheet();
  sheet.setName('Responses');
  sheet.appendRow([
    'Timestamp', 'What Works', 'What to Change', 'Services OK', 'Custom Carving',
    'Services Notes', 'Photos', 'Photos Notes', 'Estimate Flow', 'Estimate Pricing',
    'Estimate Notes', 'Susan B.', 'Roger R.', 'Isaac H.', 'Additional Reviews',
    'Phone', 'Jason Phone', 'Years', 'Emergency', 'Service Area', 'Additional'
  ]);
  sheet.getRange(1, 1, 1, 21).setFontWeight('bold');
  Logger.log('Sheet created! ID: ' + ss.getId());
  Logger.log('URL: ' + ss.getUrl());
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Open sheet — if SHEET_ID is set use it, otherwise find by name
    var ss;
    if (SHEET_ID) {
      ss = SpreadsheetApp.openById(SHEET_ID);
    } else {
      var files = DriveApp.getFilesByName('Pine Point Feedback');
      if (files.hasNext()) {
        ss = SpreadsheetApp.open(files.next());
      } else {
        ss = SpreadsheetApp.create('Pine Point Feedback');
        var sheet = ss.getActiveSheet();
        sheet.setName('Responses');
        sheet.appendRow([
          'Timestamp', 'What Works', 'What to Change', 'Services OK', 'Custom Carving',
          'Services Notes', 'Photos', 'Photos Notes', 'Estimate Flow', 'Estimate Pricing',
          'Estimate Notes', 'Susan B.', 'Roger R.', 'Isaac H.', 'Additional Reviews',
          'Phone', 'Jason Phone', 'Years', 'Emergency', 'Service Area', 'Additional'
        ]);
        sheet.getRange(1, 1, 1, 21).setFontWeight('bold');
      }
    }

    var sheet = ss.getSheetByName('Responses') || ss.getActiveSheet();

    sheet.appendRow([
      new Date().toLocaleString(),
      data.strengths || '',
      data.changes || '',
      data.services_accurate || '',
      data.custom_carving || '',
      data.services_notes || '',
      data.photos_quality || '',
      data.photos_notes || '',
      data.estimate_flow || '',
      data.estimate_pricing || '',
      data.estimate_notes || '',
      data.review_susan || '',
      data.review_roger || '',
      data.review_isaac || '',
      data.additional_reviews || '',
      data.phone || '',
      data.jason_phone || '',
      data.years || '',
      data.emergency || '',
      data.service_area || '',
      data.additional || ''
    ]);

    // Send email
    MailApp.sendEmail({
      to: YOUR_EMAIL,
      subject: 'Pine Point Feedback Submitted',
      body: formatEmail(data)
    });

    return ContentService.createTextOutput(JSON.stringify({status: 'success'}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status: 'ready'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatEmail(data) {
  var lines = [];
  lines.push('NEW FEEDBACK — Pine Point Tree Service');
  lines.push('========================================');
  lines.push('Submitted: ' + new Date().toLocaleString());
  lines.push('');
  if (data.strengths) { lines.push('WHAT WORKS: ' + data.strengths); lines.push(''); }
  if (data.changes) { lines.push('WHAT TO CHANGE: ' + data.changes); lines.push(''); }
  if (data.services_accurate) lines.push('✓ Services accurate');
  if (data.custom_carving) lines.push('✓ Keep custom carving');
  if (data.services_notes) { lines.push('Services notes: ' + data.services_notes); }
  lines.push('');
  if (data.photos_quality) lines.push('Photos: ' + data.photos_quality);
  if (data.photos_notes) lines.push('Photos notes: ' + data.photos_notes);
  lines.push('');
  if (data.estimate_flow) lines.push('✓ Estimate flow OK');
  if (data.estimate_pricing) lines.push('✓ Estimate pricing OK');
  if (data.estimate_notes) lines.push('Estimate notes: ' + data.estimate_notes);
  lines.push('');
  lines.push('REVIEWS:');
  lines.push('  Susan B.: ' + (data.review_susan ? '✓ Approved' : '○ Not confirmed'));
  lines.push('  Roger R.: ' + (data.review_roger ? '✓ Approved' : '○ Not confirmed'));
  lines.push('  Isaac H.: ' + (data.review_isaac ? '✓ Approved' : '○ Not confirmed'));
  if (data.additional_reviews) lines.push('  Additional: ' + data.additional_reviews);
  lines.push('');
  if (data.phone) lines.push('Phone: ' + data.phone);
  if (data.jason_phone) lines.push('Jason: ' + data.jason_phone);
  if (data.years) lines.push('Years in business: ' + data.years);
  if (data.emergency) lines.push('Emergency: ' + data.emergency);
  if (data.service_area) lines.push('Service area: ' + data.service_area);
  if (data.additional) { lines.push(''); lines.push('ADDITIONAL: ' + data.additional); }
  lines.push('');
  lines.push('========================================');
  lines.push('FITFO Systems');
  return lines.join('\n');
}
