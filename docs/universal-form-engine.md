# FITFO Systems — Universal Form Engine
## Architecture & Implementation Guide

---

## Overview

One backend handles all FITFO client forms — feedback, estimates, intake, contact. Each project gets its own config entry. New clients get onboarded by adding a config block, not rebuilding infrastructure.

---

## Architecture

```
Any FITFO client form (HTML)
        ↓
  fetch() POST with project_id + form_type
        ↓
  Google Apps Script (single deployment)
        ↓
  Reads config for that project_id + form_type
        ↓
  Three actions:
    1. Write row to project-specific Google Sheet
    2. Save uploads to project-specific Drive folder
    3. Send email notification to project-specific recipients
        ↓
  Return success response
```

---

## Config Structure

All project routing lives in one config object inside the Apps Script:

```javascript
const PROJECTS = {
  'pinepoint': {
    name: 'Pine Point Tree Service',
    forms: {
      'feedback': {
        sheetId: '1abc123...',
        sheetTab: 'Feedback',
        driveFolderId: '1xyz789...',
        notifyEmails: ['fitfo@fitfosystems.com'],
        columns: [
          'timestamp', 'strengths', 'changes', 'services_accurate',
          'custom_carving', 'services_notes', 'photos_quality',
          'photos_notes', 'estimate_flow', 'estimate_pricing',
          'estimate_notes', 'review_susan', 'review_roger',
          'review_isaac', 'additional_reviews', 'phone',
          'jason_phone', 'years', 'emergency', 'service_area',
          'additional'
        ],
        confirmationMessage: 'Thanks — we\'ve got your feedback.'
      },
      'estimate': {
        sheetId: '1abc123...',
        sheetTab: 'Estimates',
        driveFolderId: '1xyz789...',
        notifyEmails: ['fitfo@fitfosystems.com', 'pinepointtreeservice@gmail.com'],
        columns: [
          'timestamp', 'service', 'answers_json', 'estimate_low',
          'estimate_typical', 'estimate_high', 'name', 'phone',
          'email', 'town', 'notes', 'photo_links'
        ],
        confirmationMessage: 'Sent! We\'ll be in touch soon.'
      },
      'carving': {
        sheetId: '1abc123...',
        sheetTab: 'Carving Requests',
        driveFolderId: '1xyz789...',
        notifyEmails: ['fitfo@fitfosystems.com', 'pinepointtreeservice@gmail.com'],
        columns: [
          'timestamp', 'name', 'phone', 'email', 'location',
          'description', 'photo_links'
        ],
        confirmationMessage: 'Request received — we\'ll follow up within 1-2 business days.'
      },
      'schedule': {
        sheetId: '1abc123...',
        sheetTab: 'Callbacks',
        driveFolderId: null,
        notifyEmails: ['fitfo@fitfosystems.com', 'pinepointtreeservice@gmail.com'],
        columns: [
          'timestamp', 'name', 'phone', 'email', 'preferred_time',
          'notes', 'service_context', 'estimate_context'
        ],
        confirmationMessage: 'You\'re on the list — we\'ll call during your preferred window.'
      }
    }
  },

  // Future client example
  'smithlandscaping': {
    name: 'Smith Landscaping',
    forms: {
      'feedback': {
        sheetId: '1def456...',
        sheetTab: 'Feedback',
        driveFolderId: '1uvw321...',
        notifyEmails: ['fitfo@fitfosystems.com'],
        columns: ['timestamp', 'strengths', 'changes', 'additional'],
        confirmationMessage: 'Thanks — we\'ve received your feedback.'
      }
    }
  }
};
```

---

## Backend (Google Apps Script)

### Single Deployment — All Projects

```javascript
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var projectId = payload._project || 'pinepoint';
    var formType = payload._formType || 'feedback';

    // Look up config
    var project = PROJECTS[projectId];
    if (!project) throw new Error('Unknown project: ' + projectId);

    var formConfig = project.forms[formType];
    if (!formConfig) throw new Error('Unknown form type: ' + formType);

    // 1. Write to Google Sheet
    var ss = SpreadsheetApp.openById(formConfig.sheetId);
    var sheet = ss.getSheetByName(formConfig.sheetTab);
    if (!sheet) {
      sheet = ss.insertSheet(formConfig.sheetTab);
      sheet.appendRow(formConfig.columns);
      sheet.getRange(1, 1, 1, formConfig.columns.length).setFontWeight('bold');
    }

    var row = formConfig.columns.map(function(col) {
      if (col === 'timestamp') return new Date().toLocaleString();
      return payload[col] || '';
    });
    sheet.appendRow(row);

    // 2. Handle uploads (if Drive folder configured and photos present)
    var photoLinks = [];
    if (formConfig.driveFolderId && payload._photos && payload._photos.length > 0) {
      var folder = DriveApp.getFolderById(formConfig.driveFolderId);
      var subfolder = folder.createFolder(
        new Date().toISOString().split('T')[0] + ' - ' + (payload.name || 'Unknown')
      );

      payload._photos.forEach(function(photo, i) {
        var blob = Utilities.newBlob(
          Utilities.base64Decode(photo.data),
          photo.mimeType || 'image/jpeg',
          photo.filename || ('photo-' + (i + 1) + '.jpg')
        );
        var file = subfolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoLinks.push(file.getUrl());
      });

      // Update the row with photo links
      var lastRow = sheet.getLastRow();
      var photoCol = formConfig.columns.indexOf('photo_links');
      if (photoCol >= 0) {
        sheet.getRange(lastRow, photoCol + 1).setValue(photoLinks.join('\n'));
      }
    }

    // 3. Send notification email
    formConfig.notifyEmails.forEach(function(email) {
      MailApp.sendEmail({
        to: email,
        subject: project.name + ' — ' + capitalize(formType) + ' Submission',
        body: formatNotification(project.name, formType, payload, photoLinks)
      });
    });

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: formConfig.confirmationMessage
    })).setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status: 'ready'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatNotification(projectName, formType, data, photoLinks) {
  var lines = [];
  lines.push('NEW ' + formType.toUpperCase() + ' — ' + projectName);
  lines.push('========================================');
  lines.push('Submitted: ' + new Date().toLocaleString());
  lines.push('');

  // Output all fields (skip internal ones)
  Object.keys(data).forEach(function(key) {
    if (key.startsWith('_')) return; // skip _project, _formType, _photos
    if (!data[key]) return; // skip empty
    lines.push(key.replace(/_/g, ' ').toUpperCase() + ': ' + data[key]);
  });

  if (photoLinks && photoLinks.length > 0) {
    lines.push('');
    lines.push('PHOTOS (' + photoLinks.length + '):');
    photoLinks.forEach(function(link) {
      lines.push('  → ' + link);
    });
  }

  lines.push('');
  lines.push('========================================');
  lines.push('FITFO Systems — fitfosystems.com');
  return lines.join('\n');
}
```

---

## Frontend Form Requirements

Every FITFO form must include two hidden fields:

```html
<input type="hidden" name="_project" value="pinepoint">
<input type="hidden" name="_formType" value="feedback">
```

The submit function collects all form data plus these identifiers:

```javascript
const data = {
  _project: 'pinepoint',
  _formType: 'feedback',
  strengths: form.strengths.value,
  changes: form.changes.value,
  // ... all other fields
};

fetch(FITFO_FORM_URL, {
  method: 'POST',
  mode: 'no-cors',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});
```

---

## Image Upload Handling

### Client Side

```javascript
// Compress and encode photos before sending
async function preparePhotos(fileInput) {
  const photos = [];
  for (const file of fileInput.files) {
    const compressed = await compressImage(file, 1200, 0.7);
    photos.push({
      filename: file.name,
      mimeType: file.type,
      data: compressed // Base64 string without prefix
    });
  }
  return photos;
}
```

Photos are included in the POST body as `_photos` array. The backend reads `_project` to determine which Drive folder to save them in.

### Storage Structure

```
Google Drive/
├── FITFO Clients/
│   ├── Pine Point/
│   │   ├── Estimates/
│   │   │   ├── 2026-03-28 - John Smith/
│   │   │   │   ├── photo-1.jpg
│   │   │   │   └── photo-2.jpg
│   │   ├── Carving Requests/
│   │   └── Feedback/
│   ├── Smith Landscaping/
│   │   └── Feedback/
```

---

## Google Sheets Strategy

**Separate sheet per project.** Each project gets its own Google Spreadsheet with tabs per form type.

```
Pine Point Leads (Google Spreadsheet)
├── Tab: Estimates
├── Tab: Callbacks
├── Tab: Carving Requests
├── Tab: Feedback

Smith Landscaping (Google Spreadsheet)
├── Tab: Feedback
├── Tab: Intake
```

Why separate sheets:
- Client can be given view access to their own sheet without seeing other clients
- Cleaner data management
- No filtering needed
- Easy to share or export per client

---

## Onboarding a New Client

### Steps (15 minutes)

1. Create a Google Sheet for the client
2. Create a Drive folder for the client (if uploads needed)
3. Add a config block to `PROJECTS` in the Apps Script
4. Save the script (no redeployment needed — config is runtime)
5. Build the frontend form with `_project` and `_formType` hidden fields
6. Done

### No redeployment required

The Apps Script reads config at runtime. Adding a new project to the `PROJECTS` object only requires saving the script — the deployed URL stays the same.

---

## Scaling

| Clients | Approach | Effort |
|---------|----------|--------|
| 1-5 | Current setup (one Apps Script, separate sheets) | Config change only |
| 5-20 | Same, consider folder organization in Drive | Minimal |
| 20+ | Consider moving to a proper backend (Supabase, Firebase) | Migration |

The Google Apps Script approach works well up to ~20 active clients. Beyond that, execution time limits and quota caps become a factor.

---

## Current Pine Point Migration

To convert the existing Pine Point setup to the universal engine:

1. Update the Apps Script code to the universal version
2. Add Pine Point config with existing Sheet ID
3. Add `_project: 'pinepoint'` and `_formType: 'feedback'` to the feedback form
4. Same URL, same Sheet — no disruption

The estimate tool, schedule modal, and carving form each get their own `_formType` entry and route to appropriate tabs in the same spreadsheet.

---

## Summary

| Component | Owner | Reusable |
|-----------|-------|----------|
| Apps Script backend | FITFO (one deployment) | Yes — all clients |
| Config object | FITFO (in script) | Add per client |
| Google Sheet | Per client | Created per client |
| Drive folder | Per client | Created per client |
| Frontend form | Per project | Custom, but follows standard |
| URL endpoint | FITFO | One URL for everything |

One engine. Many clients. No rebuilding.

---

*FITFO Systems — fitfosystems.com*
