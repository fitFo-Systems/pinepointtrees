# Decap CMS Implementation Plan — FITFO Client Self-Service

## Overview

Give clients a visual admin panel to manage their own website content — photos, text, services, reviews — without touching code or contacting FITFO for every change.

**Tool:** Decap CMS (formerly Netlify CMS)
**Cost:** Free, open source
**Works with:** GitHub Pages, Netlify, any static host
**Auth:** GitHub OAuth (free) or Netlify Identity (free tier)

---

## What the Client Gets

A clean admin panel at `their-site.com/admin` where they can:

- Add, remove, reorder gallery photos
- Edit service descriptions
- Update business info (phone, email, hours, service area)
- Manage reviews (add new ones, edit, remove)
- Update hero text and images
- Toggle emergency/storm banner on/off
- Edit About section content

They see a visual editor. No code, no terminal, no GitHub knowledge required.

---

## Architecture

```
Site Files (GitHub repo)
├── index.html          ← built from templates + content
├── admin/
│   └── index.html      ← Decap CMS admin panel
│   └── config.yml      ← defines what's editable
├── content/
│   ├── site.json       ← business info, phone, hours, etc.
│   ├── services.json   ← service cards
│   ├── reviews.json    ← testimonials
│   ├── gallery.json    ← photo list
│   └── settings.json   ← emergency banner toggle, etc.
├── images/
│   └── uploads/        ← client-uploaded images go here
└── js/
    └── site-builder.js ← reads JSON content, renders page
```

---

## Implementation Steps

### Phase 1: Content Extraction

Move all hardcoded content out of HTML into JSON data files:

**site.json**
```json
{
  "business_name": "Pine Point Tree Service",
  "phone": "(774) 262-2145",
  "email": "pinepointtreeservice@gmail.com",
  "address": "710 Whittemore St, Leicester, MA",
  "years_in_business": 3,
  "tagline": "Tree Service Done Right.",
  "subtitle": "Removal. Trimming. Lot Clearing.",
  "about_text": "Locally owned and operated...",
  "emergency_active": false,
  "emergency_text": "Storm Damage? We're Available for Emergency Tree Work."
}
```

**services.json**
```json
[
  {
    "title": "Tree Removal",
    "description": "Safe removal of any size tree..."
  },
  {
    "title": "Tree Trimming & Pruning",
    "description": "We trim back overgrown branches..."
  }
]
```

**reviews.json**
```json
[
  {
    "name": "Susan B.",
    "source": "Facebook",
    "stars": 5,
    "quote": "Pine Point did an excellent job..."
  }
]
```

**gallery.json** — already exists, keep as-is.

### Phase 2: Template Rendering

Update `index.html` to read from JSON files and render dynamically:

```javascript
// Load all content
Promise.all([
  fetch('content/site.json').then(r => r.json()),
  fetch('content/services.json').then(r => r.json()),
  fetch('content/reviews.json').then(r => r.json()),
  fetch('data/gallery.json').then(r => r.json())
]).then(([site, services, reviews, gallery]) => {
  renderSite(site, services, reviews, gallery);
});
```

This replaces all hardcoded content with data-driven rendering.

### Phase 3: Decap CMS Setup

**admin/index.html**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Manager</title>
  <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
</head>
<body></body>
</html>
```

**admin/config.yml**
```yaml
backend:
  name: github
  repo: keithcreelman/fitfo-pinepoint-preview
  branch: main

media_folder: "images/uploads"
public_folder: "/images/uploads"

collections:
  - name: "settings"
    label: "Site Settings"
    files:
      - name: "site"
        label: "Business Info"
        file: "content/site.json"
        fields:
          - { name: "business_name", label: "Business Name", widget: "string" }
          - { name: "phone", label: "Phone Number", widget: "string" }
          - { name: "email", label: "Email", widget: "string" }
          - { name: "address", label: "Address", widget: "string" }
          - { name: "years_in_business", label: "Years in Business", widget: "number" }
          - { name: "tagline", label: "Hero Tagline", widget: "string" }
          - { name: "subtitle", label: "Hero Subtitle", widget: "string" }
          - { name: "about_text", label: "About Section Text", widget: "text" }
          - { name: "emergency_active", label: "Show Emergency Banner", widget: "boolean" }
          - { name: "emergency_text", label: "Emergency Banner Text", widget: "string" }

  - name: "services"
    label: "Services"
    file: "content/services.json"
    fields:
      - name: "services"
        label: "Services"
        widget: "list"
        fields:
          - { name: "title", label: "Service Name", widget: "string" }
          - { name: "description", label: "Description", widget: "text" }

  - name: "reviews"
    label: "Reviews"
    file: "content/reviews.json"
    fields:
      - name: "reviews"
        label: "Reviews"
        widget: "list"
        fields:
          - { name: "name", label: "Customer Name", widget: "string" }
          - { name: "source", label: "Source (Facebook, Google, BBB)", widget: "string" }
          - { name: "stars", label: "Star Rating", widget: "number", min: 1, max: 5 }
          - { name: "quote", label: "Review Text", widget: "text" }

  - name: "gallery"
    label: "Gallery"
    file: "data/gallery.json"
    fields:
      - name: "photos"
        label: "Photos"
        widget: "list"
        fields:
          - { name: "src", label: "Image", widget: "image" }
          - { name: "alt", label: "Description", widget: "string" }
```

### Phase 4: Authentication

**Option A: GitHub OAuth (Recommended for FITFO-managed)**
- Register an OAuth app on GitHub
- Client logs in with a GitHub account you create for them
- Free, no additional services

**Option B: Netlify Identity (If hosted on Netlify)**
- Built-in auth, email/password login
- Free for up to 5 users
- Simpler for non-technical clients

**Option C: Git Gateway + Netlify Identity**
- Client doesn't need a GitHub account at all
- Logs in with email/password
- Netlify acts as proxy to GitHub
- Best UX for clients

**Recommendation for FITFO:** Option C if using Netlify hosting (free tier). Option A if staying on GitHub Pages.

---

## Hosting Decision

Decap CMS works best with:

1. **Netlify** (free tier) — best integration, Identity service, auto-deploys from GitHub
2. **GitHub Pages** — works but needs separate OAuth server for login
3. **GoDaddy** — works but requires manual deployment and external OAuth

**Recommendation:** Move hosting to Netlify (free). Keep domain on GoDaddy/Porkbun. Point DNS to Netlify. This gives:
- Auto-deploy on every content change
- Built-in auth for admin panel
- Free SSL
- Faster CDN than GoDaddy

---

## What This Means for FITFO

### Repeatable Pattern
Every FITFO client site follows the same structure:
1. Static site with JSON content files
2. Decap CMS admin panel
3. GitHub repo as source of truth
4. Netlify for hosting + auth

### Client Handoff
When a site ships, the client gets:
- A URL for their site
- A URL for their admin panel (`site.com/admin`)
- Login credentials
- A 5-minute walkthrough of how to edit content

### FITFO Retains
- Code-level changes (layout, features, estimate tool)
- Hosting management
- CMS configuration changes
- Anything structural

### Client Controls
- Text content
- Photos
- Reviews
- Business info
- Emergency banner toggle

---

## Timeline Estimate

| Task | Effort |
|------|--------|
| Extract content to JSON files | 1-2 hours |
| Build JS template renderer | 2-3 hours |
| Set up Decap CMS config | 1 hour |
| Set up Netlify + OAuth | 30 min |
| Test full edit flow | 1 hour |
| Client walkthrough | 30 min |
| **Total** | **~6-8 hours** |

---

## When to Build

**Not now.** Ship the current site for client feedback first.

Build the CMS layer after:
1. Jason confirms content and layout
2. Estimate flow decision is made
3. Photos are finalized
4. We're ready for final deployment

The CMS is the last step before handoff — it wraps around the finished product.

---

## Risk / Considerations

- **Content format changes:** If we restructure the site later, the CMS config needs updating too. Better to build it once the site is stable.
- **Image optimization:** Decap doesn't auto-optimize uploaded images. We may want to add a build step or use Netlify's image CDN.
- **Backup:** GitHub is the backup. Every change is a git commit. Can roll back anything.
- **Multiple clients:** Each client gets their own repo and Netlify site. FITFO has access to all of them.
