# FITFO Systems — Client Preview Environment
## Architecture & Long-Term Strategy

---

## Current Setup

### Pine Point Preview
- **URL:** fitfosystems.com/previews/pinepoint
- **Status:** Public (acceptable for this stage)
- **Purpose:** Client review and staging before deployment to GoDaddy

### What Gets Deployed to Preview
The full Pine Point site files:
- index.html, estimate.html, feedback.html
- css/, js/, images/ directories
- All assets needed to render the site

### What Does NOT Go to Preview
- docs/ folder (internal documents, PDFs, architecture notes)
- versions/ folder (version archives)
- import_images/ (source photos)
- .claude/ (project metadata)
- generate_pdfs.py and related tooling

---

## Directory Structure on fitfosystems.com

```
fitfosystems.com/
├── previews/
│   ├── pinepoint/              ← Pine Point Tree Service
│   │   ├── index.html
│   │   ├── estimate.html
│   │   ├── feedback.html
│   │   ├── css/
│   │   ├── js/
│   │   └── images/
│   ├── [future-client]/        ← Next client project
│   └── .htaccess               ← Optional: password protection layer
```

### Naming Convention
`/previews/[client-short-name]/`

Examples:
- `/previews/pinepoint/`
- `/previews/smithlandscaping/`
- `/previews/centralplumbing/`

Use lowercase, no spaces, no special characters. Match the client's business name or domain.

---

## How to Reference the Preview

### In Client Documents
"We've set up a preview version of your site for review. You can view it on any device at:"

**fitfosystems.com/previews/pinepoint**

"This is a working preview — not the final live site. Once you're happy with it, we'll deploy it to your domain."

### In Conversation
- "the preview link"
- "the review version"
- "the staging site"

### Do Not Say
- "your website is live"
- "the site is up"
- "visit your new site"

---

## Long-Term Preview System

### Phase 1: Current (Public Previews)
- Simple directory on fitfosystems.com
- No authentication
- Acceptable for small client base
- Easy to set up and share

### Phase 2: Basic Protection
Add .htaccess password protection per preview:

```apache
# /previews/pinepoint/.htaccess
AuthType Basic
AuthName "Preview Access"
AuthUserFile /path/to/.htpasswd
Require valid-user
```

- One username/password per client
- Share credentials alongside the preview link
- Low effort, adequate privacy

### Phase 3: Client Portal (Future)
If FITFO scales to multiple concurrent clients:

- Landing page at fitfosystems.com/previews/
- Client enters a project code or logs in
- Each preview isolated with its own access
- Dashboard showing project status, feedback form link, preview link
- Could use a lightweight auth layer (Cloudflare Access, simple session cookies, or a static site generator with auth)

---

## Archive Strategy After Launch

When a project goes live on the client's domain:

### Immediate (launch day)
- Keep preview active for 30 days as a reference
- Add a banner or redirect notice: "This project is now live at [client-domain.com]"

### After 30 Days
- Archive the preview directory (zip and store locally)
- Replace the preview with a redirect to the live site
- OR remove the directory entirely

### Archive Storage
```
fitfosystems.com/
├── previews/
│   └── pinepoint/          ← Active preview
└── archive/
    └── pinepoint-2026-04/  ← Archived after launch
```

### Cleanup Checklist
- [ ] Client confirms live site is working
- [ ] Preview archived (zip stored locally)
- [ ] Preview directory removed or redirected
- [ ] .htpasswd entry removed (if Phase 2)
- [ ] Internal docs updated to reflect "deployed" status

---

## Feedback Form Hosting

During preview phase:
- Feedback form lives at `fitfosystems.com/previews/pinepoint/feedback.html`
- Same directory as the preview site

After launch:
- Feedback form is no longer needed on the live site
- Gets removed during archive cleanup
- OR moves to a FITFO-managed client feedback system if one is built

---

## Deployment to Preview

### Manual (Current)
1. FTP/SFTP into fitfosystems.com
2. Upload site files to `/previews/pinepoint/`
3. Verify the site loads at the preview URL
4. Share link with client

### Future (Automated)
- Git push to deploy
- GitHub Actions or similar CI/CD
- Automatic preview URLs per branch
- Not needed now, but worth considering if FITFO takes on more projects

---

## Summary

| Item | Current | Future |
|------|---------|--------|
| **Access** | Public | Password-protected or login |
| **Structure** | `/previews/[client]/` | Same, with auth layer |
| **Archive** | Manual | Automated with 30-day window |
| **Feedback** | Same directory | Dedicated FITFO feedback system |
| **Deploy** | Manual FTP | CI/CD pipeline |
