# Pine Point Tree Service — Form + Submission Architecture
## FITFO Systems

---

## Overview

All form submissions (estimates, custom carving requests, client feedback) flow through a single backend owned and hosted by FITFO Systems. No paid services required.

---

## Architecture

```
Customer fills form on pinepointtrees.com
        ↓
  fetch() POST to Google Apps Script (deployed as web app)
        ↓
  Apps Script does three things:
    1. Writes structured row to Google Sheet ("Pine Point Leads")
    2. Saves uploaded photos to Google Drive subfolder
    3. Sends email notification to owner with all details + photo links
```

---

## Components

### Frontend (on pinepointtrees.com)
- HTML form with service-specific question paths
- Client-side image compression before upload (reduces payload)
- Photos converted to Base64 for inclusion in POST body
- Single fetch() call to Apps Script endpoint

### Backend (Google Apps Script — free, FITFO-controlled)
- Deployed as web app with "anyone can access" permission
- Receives JSON payload with form data + Base64 images
- Processes in three steps (see above)
- Returns JSON success/error response

### Storage (Google Sheets — free)
- One spreadsheet: "Pine Point Leads"
- Columns: timestamp, service type, all answers, contact info, estimate shown, photo links, status
- Client can view on phone anytime
- Filter by service type, date, status

### File Storage (Google Drive — free, 15GB)
- Folder: "Pine Point / Customer Photos"
- Subfolder per submission: "[Date] - [Name] - [Service]"
- Each photo saved as JPG
- Shareable links generated automatically
- Links included in email notification and Sheet row

### Notifications (Gmail — free)
- Triggered by Apps Script on each submission
- Sent to owner's email (pinepointtreeservice@gmail.com)
- Includes: customer name, phone, service type, all answers, estimate range, photo links

---

## Cost

| Component | Cost |
|-----------|------|
| Google Apps Script | $0 |
| Google Sheets | $0 |
| Google Drive (15GB) | $0 |
| Gmail notifications | $0 |
| **Total** | **$0/year** |

---

## Image Upload Handling

### Client Side
- Accept up to 6 images (JPG, PNG, HEIC)
- Compress to max 1200px wide before encoding (reduces upload size)
- Convert to Base64 strings
- Include in POST body as array

### Server Side (Apps Script)
- Decode Base64 to Blob
- Create subfolder in Drive: "[Date] - [Customer Name]"
- Save each image as file
- Generate shareable link per image
- Include links in notification email and Sheet row

### Limits
- Google Apps Script payload limit: ~50MB per request
- 6 compressed phone photos: typically 3-8MB total
- Well within limits

---

## Form Submission Payload Structure

```json
{
  "formType": "estimate",
  "service": "tree_removal",
  "answers": {
    "treeCount": "2-3",
    "treeHeight": "large",
    "nearStructures": "house",
    "access": "limited",
    "stumpRemoval": "yes",
    "cleanupNeeded": "full"
  },
  "estimate": {
    "low": 1890,
    "typical": 2360,
    "high": 2950
  },
  "contact": {
    "name": "John Smith",
    "phone": "(508) 555-0147",
    "email": "jsmith@gmail.com",
    "town": "Spencer"
  },
  "notes": "Two large oaks near the driveway, one is leaning toward the garage.",
  "photos": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."],
  "timestamp": "2026-03-28T14:34:00-04:00"
}
```

---

## Feedback Form

The client feedback form (feedback.html) uses the same backend architecture.

### Hosting
- Form page hosted on fitfosystems.com for the review phase
- After site goes live, can optionally move to pinepointtrees.com
- Submissions go to a separate "Feedback" tab in the same Google Sheet

---

## Setup Steps

1. Create Google Sheet "Pine Point Leads" in the client's Google account
2. Create Google Drive folder "Pine Point / Customer Photos"
3. Write Apps Script (doPost function) that handles the three tasks
4. Deploy Apps Script as web app
5. Update form fetch() URLs to point to the deployed endpoint
6. Test end-to-end with a sample submission
7. Verify email arrives, Sheet row populates, Drive folder creates

---

## Security Notes

- Apps Script endpoint accepts POST only
- Origin validation can be added (only accept from pinepointtrees.com)
- No sensitive data stored (no passwords, no payment info)
- Google's infrastructure handles availability and security
- Photos are stored in a private Drive folder (only owner + shared parties can access)
