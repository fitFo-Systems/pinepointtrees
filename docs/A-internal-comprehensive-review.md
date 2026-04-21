# Pine Point Tree Service — Internal Project Review
## FITFO Systems | March 2026

**INTERNAL — NOT FOR CLIENT DISTRIBUTION**

---

## Current State

The site has been through five major iterations. Every core section is built, styled, and functional. The estimate tool has service-specific question paths with working pricing logic. Mobile experience is optimized with sticky call bar, carousel gallery, and compact scheduling modal. GoDaddy credentials are in hand.

What remains before deployment: wire the Google Apps Script backend, optimize images, and get client sign-off on content accuracy.

---

## What's Built

### Homepage (index.html)
- Sticky nav (transparent to solid on scroll, hamburger on mobile)
- Hero with truck/equipment photo, text shadow for legibility, dual CTAs
- Trust bar: Fully Insured, Licensed, Free Estimates, Cleanup Included
- Four service cards with expanded descriptions
- About section with four trust points (text-first on mobile)
- Our Work: self-hosted video lead, 4 before/after sliders (carousel on mobile), lot clearing timeline, stump carving spotlight
- Three verified reviews (Susan B., Roger R., Isaac H.)
- Emergency storm banner (toggleable via CSS class)
- Service area: real OpenStreetMap-based static map with 15-mile radius
- Final CTA section
- Footer with contact, service area, Facebook link

### Estimate Tool (estimate.html)
- Five service paths with targeted questions:
  - Removal: 5 steps (count, height, hazards, access, stump addon)
  - Trimming: 4 steps (count, concern type, height, access)
  - Stump Grinding: 4 steps (count, diameter size, access, replant intent)
  - Lot Clearing: 4 steps (acreage, density, equipment access, end goal)
  - Custom Carving: dedicated request form with photo upload
- Prices shown immediately — no gating
- Dual result CTAs: "Schedule a Follow-Up" (modal) + "Call Now"
- Compact scheduling modal: name, phone, time window, optional email/note. No scrollbar, fits mobile viewport.

### Feedback Form (feedback.html)
- Seven sections: overall impression, services, photos, estimate tool, review confirmation, contact/business details, open notes
- Standalone page, linked from client documents
- Clean form design, checkbox + text hybrid

### Technical Foundation
- Favicon, Open Graph tags, schema.org LocalBusiness markup
- Self-hosted video (replacing Facebook embed)
- Lazy loading on images and mobile video
- Static service area map (real CartoDB tiles, MA geography visible)

---

## Strengths

- **Estimate tool is genuinely differentiated.** No other local tree service offers instant pricing with service-specific question flows. The branching logic (removal asks about hazards, stump asks about diameter, lot clearing asks about density) shows real product thinking.

- **Mobile UX is solid.** Sticky call bar, carousel gallery, compact modal, text-first About section, reduced padding. The site functions as a tool on mobile, not just a scaled-down desktop page.

- **Section flow follows decision logic.** Services → About → Work → Reviews → Contact. Each section answers the next question a homeowner would ask.

- **Real content, not placeholders.** Actual job photos, verified customer reviews, self-hosted video of precision work, real business contact info.

- **Dual CTA strategy on estimate result.** "Schedule a Follow-Up" and "Call Now" give users two clear paths based on their preference. The scheduling modal is fast — 5 fields, no scroll, 10-second completion.

---

## Weaknesses

### Must Fix Before Client Presentation
- **Review accuracy unconfirmed.** The three quotes need explicit client approval before publishing. Liability risk if published incorrectly.
- **Estimate pricing is uncalibrated.** Based on general industry ranges, not Pine Point's actual jobs. Needs stress-testing against recent invoices.

### Should Fix Before Deployment
- **No form backend.** Forms show confirmation messages but capture nothing. Google Apps Script integration needed (documented in form-architecture.md, 2-3 hour setup).
- **Images not optimized.** Raw JPGs being served. Video is 19MB. WebP conversion and compression needed.
- **No owner photo.** About section describes "owner on every job" but doesn't show who that person is. Phone photo would help.
- **No years in business.** Homeowners weigh experience. This should be visible.

### Lower Priority
- **Before/after photo angles don't match.** Different shooting positions between before and after weaken comparisons. Fixable only with new photos from future jobs.
- **Logo is raster.** Transparent PNG works but isn't crisp at all sizes. Vector version would be better long-term.
- **Google Business Profile incomplete.** Reviews cite Facebook and BBB because GBP isn't set up. Post-launch priority.
- **Emergency response details unconfirmed.** Banner exists but we don't know if they handle storm calls or what response time is realistic.

---

## Conversion Assessment

The site is significantly more likely to generate leads than the original GoDaddy placeholder.

### What's Working
- **Sticky call bar** — highest-impact element for mobile local service traffic. One tap from any position.
- **Open estimate flow** — shows price without demanding contact info. Builds trust. Optional follow-up captures engaged leads.
- **Schedule modal** — low-friction alternative to calling. 5 fields, fits mobile screen, submits in 10 seconds.
- **Decision funnel** — each section answers the next logical question. Minimal drop-off reasoning.

### Main Gap
- **Backend not wired.** Until Google Apps Script is deployed, only phone calls convert. Estimate submissions and schedule requests go nowhere.

---

## Form Backend Strategy

**Recommended: Google Apps Script + Google Sheets + Google Drive ($0/year)**

- All form submissions (estimates, schedule requests, carving inquiries, feedback) POST to a single Apps Script endpoint
- Data writes to Google Sheet rows — client can view lead database on phone
- Photos save to Google Drive subfolder per submission
- Email notification fires immediately with all details + photo links
- Setup: 2-3 hours, one-time. Documented in form-architecture.md.

---

## Before Client Review

- [ ] Confirm three review quotes are word-for-word accurate
- [ ] Verify phone number (774) 262-2145 and email are current
- [ ] Ask: add Jason's number?
- [ ] Ask: confirm custom stump carving emphasis
- [ ] Ask: how long in business?

## Before Deployment

- [ ] Wire Google Apps Script form backend
- [ ] Optimize all images to WebP
- [ ] Compress video or add quality tiers
- [ ] Get owner photo for About section
- [ ] Confirm service area town list
- [ ] Set up HTTPS on GoDaddy
- [ ] Stress-test estimate pricing against 3-5 recent real jobs

## Post-Launch

- [ ] Google Business Profile setup
- [ ] Start collecting real job data for estimate calibration
- [ ] Coach crew on before/after photo consistency
- [ ] Google review automation workflow
- [ ] Seasonal banner toggle mechanism

---

## Roadmap (Documented, Not Built)

- **Google Review Response Workflow** — draft responses for owner approval, delayed posting, careful negative review handling. Controlled process, not automatic.
- **Town Page Monitoring** — watch local Facebook groups for tree-related posts. Pre-written response templates. Helpful neighbor tone, not sales pitch.
- **Invoice Data Ingestion** — parse past invoice PDFs to extract real pricing data. Feed into estimate model to improve accuracy over time.
- **Seasonal Banner Toggle** — CSS class-based show/hide. Future: simple config variable or admin switch.
- **Paid Advertising** — Facebook/Instagram ads targeting homeowners within 25 miles of Leicester. Before/after creative. Drive to estimate tool. Start at $5-10/day.

---

## Final Synthesis

### Where does the project stand?
The proof of concept is complete and ready for client review. The site functions, looks professional, and has genuine differentiating features. The estimate tool with service-specific paths is production-quality UX. The mobile experience is optimized for real-world use.

### What is genuinely strong?
The estimate tool, the page flow, the mobile call bar, the scheduling modal, and the real customer reviews. These aren't decorative — they solve real conversion problems for a small tree service operator.

### What still needs cleanup?
Form backend is the critical gap. Without it, the estimate tool is a visual demo. Image optimization is needed before deployment. Client confirmation on reviews and pricing is required before publishing.

### What improved most significantly during iteration?
The estimate tool evolution — from a generic 5-question funnel with gated pricing to service-specific question paths with immediate results and a compact scheduling modal. This is a meaningfully better product than what was originally planned.

### Any weak spots introduced by iteration?
The page is longer than the original concept. More sections means more scroll. The mobile optimizations (reduced padding, carousel, lazy loading) mitigate this, but it's worth monitoring whether real users scroll through the full page or drop off.

---

*FITFO Systems — fitfosystems.com*
