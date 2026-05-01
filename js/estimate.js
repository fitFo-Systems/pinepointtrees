/* =============================================
   Pine Point Tree Service — Estimate Tool
   Service-specific question paths with
   branching logic and targeted pricing.
   ============================================= */

// Lead capture endpoint — Google Apps Script Web App URL.
// Empty string = leads logged to console only (dev mode). Replace after deploy:
// docs/LEAD-CAPTURE-SETUP.md
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz68dVyIGyruTPSofHei6UqcbkBuDZKhGybFLFjcowc2uCSIkDol4NWOJ0FOZdqlxOXpQ/exec';

// --- Photo limits (kept under Apps Script's ~50 MB POST cap after base64 overhead) ---
const MAX_PHOTOS = 6;
const MAX_PHOTOS_TOTAL_BYTES = 25 * 1024 * 1024;

// --- State ---
const state = {
  service: null,
  answers: {},
  contact: {},
  photos: [],            // Array of File objects, capped at MAX_PHOTOS
  price: null,
  history: ['service'],  // step navigation history for back button
  currentStep: 'service'
};

// --- Service Flow Definitions ---
// Each service defines its ordered steps. The last step triggers estimate calculation.
const serviceFlows = {
  removal:      ['removal-1', 'removal-2', 'removal-3', 'removal-4'],
  trimming:     ['trimming-1', 'trimming-2', 'trimming-3', 'trimming-4'],
  lot_clearing: ['lot_clearing-1', 'lot_clearing-2', 'lot_clearing-3', 'lot_clearing-4']
};

// --- Pricing Model ---
const pricing = {
  removal: {
    base: { small: 300, medium: 700, large: 1400, xlarge: 2200 },
    access: { easy: 1.0, limited: 1.2, none: 1.45 },
    hazards: { none: 1.0, house: 1.15, powerlines: 1.3, both: 1.5 },
    volume: { '1': 1.0, '2-3': 1.85, '4-6': 3.2, '7+': 5.0 },
    stumpAddon: { small: 80, medium: 110, large: 140, xlarge: 180 }
  },
  trimming: {
    base: { small: 150, medium: 280, large: 450, xlarge: 600 },
    access: { easy: 1.0, limited: 1.15, none: 1.35 },
    pruneType: { overhang: 1.15, shaping: 1.0, deadwood: 1.1, clearance: 1.25 },
    volume: { '1': 1.0, '2-3': 1.8, '4-6': 3.0, '7+': 4.5 }
  },
  // stump standalone removed — stump addon pricing is in removal.stumpAddon
  lot_clearing: {
    base: { small: 1500, medium: 3500, large: 6000, xlarge: 10000 },
    access: { easy: 1.0, limited: 1.2, none: 1.5 },
    density: { brush: 0.7, mixed: 1.0, heavy: 1.4 },
    endGoal: { build: 1.15, yard: 1.0, thin: 0.8 }
  }
};

// --- Human-readable labels for breakdown ---
const labels = {
  removal: {
    treeCount: { '1': '1 tree', '2-3': '2-3 trees', '4-6': '4-6 trees', '7+': '7+ trees' },
    treeHeight: { small: 'small', medium: 'medium', large: 'large', xlarge: 'very large' },
    hazards: { none: 'open area', house: 'near structure', powerlines: 'near power lines', both: 'near house & lines' },
    access: { easy: 'easy access', limited: 'limited access', none: 'difficult access' },
    stumpRemoval: { yes: 'stumps included', no: 'trees only', not_sure: '' }
  },
  trimming: {
    treeCount: { '1': '1 tree', '2-3': '2-3 trees', '4-6': '4-6 trees', '7+': '7+ trees' },
    pruneType: { overhang: 'overhang clearing', shaping: 'shaping', deadwood: 'deadwood removal', clearance: 'structure clearance' },
    treeHeight: { small: 'small', medium: 'medium', large: 'large', xlarge: 'very large' },
    access: { easy: 'easy access', limited: 'limited access', none: 'difficult access' }
  },
  lot_clearing: {
    lotSize: { small: 'small area', medium: 'medium lot', large: 'large lot', xlarge: '1+ acres' },
    lotDensity: { brush: 'brush/small trees', mixed: 'mixed', heavy: 'dense woods' },
    access: { easy: 'easy access', limited: 'limited access', none: 'difficult access' },
    endGoal: { build: 'construction prep', yard: 'yard/lawn', thin: 'selective thinning' }
  }
};

const serviceNames = {
  removal: 'Tree Removal',
  trimming: 'Trimming & Pruning',
  lot_clearing: 'Lot Clearing'
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  updateProgress();
  setupPhotoInput();
});

// --- Photo selection UI ---
function setupPhotoInput() {
  const input = document.getElementById('contact-photos');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const incoming = Array.from(e.target.files || []);
    for (const f of incoming) {
      if (state.photos.length >= MAX_PHOTOS) break;
      // Skip duplicates by name + size to avoid double-adding when user re-opens picker.
      const dup = state.photos.some(p => p.name === f.name && p.size === f.size);
      if (!dup) state.photos.push(f);
    }
    // Reset the native input so the user can pick more files later.
    input.value = '';
    renderPhotoList();
  });
  renderPhotoList();
}

function renderPhotoList() {
  const list = document.getElementById('photo-list');
  const status = document.getElementById('photo-status');
  if (!list || !status) return;

  list.innerHTML = state.photos.map((f, i) => {
    const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
    return (
      '<div class="photo-list-item">' +
        '<span class="photo-list-item__name">' + escapeText(f.name) + '</span>' +
        '<span class="photo-list-item__size">' + sizeMB + ' MB</span>' +
        '<button type="button" class="photo-list-item__delete" aria-label="Remove" onclick="removePhoto(' + i + ')">&times;</button>' +
      '</div>'
    );
  }).join('');

  const total = state.photos.reduce((a, f) => a + f.size, 0);
  const totalMB = (total / (1024 * 1024)).toFixed(1);
  const limitMB = (MAX_PHOTOS_TOTAL_BYTES / (1024 * 1024)).toFixed(0);

  if (state.photos.length === 0) {
    status.textContent = '';
    status.className = 'photo-status';
  } else if (total > MAX_PHOTOS_TOTAL_BYTES) {
    status.textContent = 'Total photos exceed ' + limitMB + ' MB (currently ' + totalMB + ' MB). Remove some to continue.';
    status.className = 'photo-status photo-status--error';
  } else {
    status.textContent = state.photos.length + ' / ' + MAX_PHOTOS + ' photos · ' + totalMB + ' / ' + limitMB + ' MB';
    status.className = 'photo-status';
  }
}

function removePhoto(idx) {
  state.photos.splice(idx, 1);
  renderPhotoList();
}

function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = String(s == null ? '' : s);
  return div.innerHTML;
}

function photosTotalBytes() {
  return state.photos.reduce((a, f) => a + f.size, 0);
}

// --- Field validation (keeps obvious garbage out without nagging real users) ---
function isValidPhone(s) {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(\d)\1+$/.test(digits)) return false; // all same digit
  return true;
}

function isValidEmail(s) {
  if (!s) return true; // optional field
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Format-only check; the server fetches USPS-backed validity (zippopotam.us)
// and decides if it's inside the service area.
function isValidZip(s) {
  return /^\d{5}(-\d{4})?$/.test(String(s || '').trim());
}

function flagInvalid(input, message) {
  if (!input) return;
  input.setCustomValidity(message);
  input.reportValidity();
}

function clearInvalid(input) {
  if (input) input.setCustomValidity('');
}

// --- Service Selection ---
function selectService(service) {
  state.service = service;
  state.answers = {};
  state.photos = [];
  renderPhotoList();

  // Highlight selected button
  document.querySelectorAll('[data-step="service"] .estimate-option').forEach(b => {
    b.classList.toggle('selected', b.dataset.value === service);
  });

  const flow = serviceFlows[service];
  if (!flow) return;

  setTimeout(() => {
    goToStep(flow[0]);
  }, 200);
}

// --- Answer a Question ---
function answer(btn, isLast) {
  const key = btn.dataset.key;
  const value = btn.dataset.value;

  // Save answer
  state.answers[key] = value;

  // Highlight
  btn.closest('.estimate-options').querySelectorAll('.estimate-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  // Determine next step
  const flow = serviceFlows[state.service];
  const currentIndex = flow.indexOf(state.currentStep);

  if (isLast || currentIndex === flow.length - 1) {
    // Last question — go to contact form (price shown after submit)
    setTimeout(() => {
      goToStep('contact');
    }, 200);
  } else {
    setTimeout(() => {
      goToStep(flow[currentIndex + 1]);
    }, 200);
  }
}

// --- Navigation ---
function goToStep(stepId) {
  // Track history for back navigation
  if (stepId !== state.currentStep) {
    state.history.push(stepId);
  }
  state.currentStep = stepId;

  // Hide all, show target
  document.querySelectorAll('.estimate-step').forEach(s => s.classList.remove('active'));
  const target = document.querySelector(`[data-step="${stepId}"]`);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0 });
  }

  updateProgress();
}

function goBack() {
  if (state.history.length > 1) {
    state.history.pop(); // remove current
    const prev = state.history[state.history.length - 1];
    state.currentStep = prev;

    document.querySelectorAll('.estimate-step').forEach(s => s.classList.remove('active'));
    const target = document.querySelector(`[data-step="${prev}"]`);
    if (target) {
      target.classList.add('active');
      window.scrollTo({ top: 0 });
    }
    updateProgress();
  }
}

function updateProgress() {
  const fill = document.getElementById('progressFill');
  if (!fill) return;

  if (state.currentStep === 'service') {
    fill.style.width = '0%';
    return;
  }
  if (state.currentStep === 'result' || state.currentStep === 'carving') {
    fill.style.width = '100%';
    return;
  }

  const flow = serviceFlows[state.service];
  if (!flow) return;
  const idx = flow.indexOf(state.currentStep);
  const pct = ((idx + 1) / flow.length) * 90 + 5;
  fill.style.width = pct + '%';
}

// --- Calculate Estimate ---
function showResult() {
  const estimate = calculateEstimate();
  document.getElementById('priceLow').textContent = formatPrice(estimate.low);
  document.getElementById('priceTypical').textContent = formatPrice(estimate.typical);
  document.getElementById('priceHigh').textContent = formatPrice(estimate.high);

  // Build breakdown
  const svcLabels = labels[state.service] || {};
  const parts = [serviceNames[state.service]];
  for (const [key, value] of Object.entries(state.answers)) {
    const labelMap = svcLabels[key];
    if (labelMap && labelMap[value]) {
      parts.push(labelMap[value]);
    }
  }
  document.getElementById('resultBreakdown').textContent = 'Based on: ' + parts.join(' · ');
}

function calculateEstimate() {
  const svc = state.service;
  const a = state.answers;
  const p = pricing[svc];
  if (!p) return { low: 0, typical: 0, high: 0 };

  let total = 0;

  switch (svc) {
    case 'removal': {
      const base = p.base[a.treeHeight] || p.base.medium;
      const accessMult = p.access[a.access] || 1.0;
      const hazardMult = p.hazards[a.hazards] || 1.0;
      const volumeMult = p.volume[a.treeCount] || 1.0;
      total = base * accessMult * hazardMult * volumeMult;

      // Add stump grinding if requested
      if (a.stumpRemoval === 'yes') {
        const stumpBase = p.stumpAddon[a.treeHeight] || 110;
        const stumpCount = parseFloat(a.treeCount) || 1;
        const countNum = { '1': 1, '2-3': 2.5, '4-6': 5, '7+': 8 }[a.treeCount] || 1;
        total += stumpBase * countNum * 0.85; // slight discount when bundled
      }
      break;
    }

    case 'trimming': {
      const base = p.base[a.treeHeight] || p.base.medium;
      const accessMult = p.access[a.access] || 1.0;
      const pruneMult = p.pruneType[a.pruneType] || 1.0;
      const volumeMult = p.volume[a.treeCount] || 1.0;
      total = base * accessMult * pruneMult * volumeMult;
      break;
    }

    case 'lot_clearing': {
      const base = p.base[a.lotSize] || p.base.medium;
      const accessMult = p.access[a.access] || 1.0;
      const densityMult = p.density[a.lotDensity] || 1.0;
      const goalMult = p.endGoal[a.endGoal] || 1.0;
      total = base * accessMult * densityMult * goalMult;
      break;
    }
  }

  // Apply $500 minimum floor — ensure differentiation between tiers
  const MIN_ESTIMATE = 500;
  let low = Math.round(total * 0.80);
  let typical = Math.round(total);
  let high = Math.round(total * 1.25);

  // If the calculated total falls below minimum, set floor with spread
  if (typical < MIN_ESTIMATE) {
    low = MIN_ESTIMATE;
    typical = Math.round(MIN_ESTIMATE * 1.15);  // $575
    high = Math.round(MIN_ESTIMATE * 1.35);     // $675
  } else if (low < MIN_ESTIMATE) {
    low = MIN_ESTIMATE;
  }

  return { low, typical, high };
}

function formatPrice(amount) {
  return '$' + amount.toLocaleString('en-US');
}

// --- Form Submissions ---
function submitLead(e) {
  e.preventDefault();
  document.getElementById('leadForm').style.display = 'none';
  document.getElementById('leadConfirmation').style.display = 'block';
}

function submitCarving(e) {
  e.preventDefault();
  const photoInput = document.getElementById('carving-photos');
  if (photoInput && photoInput.files.length > 6) {
    alert('Please select up to 6 photos.');
    return;
  }
  document.getElementById('carvingForm').style.display = 'none';
  document.getElementById('carvingConfirmation').style.display = 'block';
}

// --- Schedule Follow-Up Modal ---
function openScheduleModal() {
  const c = state.contact || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('sched-name', c.name);
  set('sched-phone', c.phone);
  set('sched-email', c.email);
  document.getElementById('scheduleModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').style.display = 'none';
  document.body.style.overflow = '';
}

function submitContact(e) {
  e.preventDefault();

  const nameInput  = document.getElementById('contact-name');
  const phoneInput = document.getElementById('contact-phone');
  const emailInput = document.getElementById('contact-email');
  const zipInput   = document.getElementById('contact-zip');
  const notesInput = document.getElementById('contact-notes');

  // Validate phone, email, and ZIP before doing anything else.
  if (!isValidPhone(phoneInput.value)) {
    flagInvalid(phoneInput, 'Please enter a valid phone number we can call you back on.');
    return;
  }
  clearInvalid(phoneInput);

  if (!isValidEmail(emailInput.value)) {
    flagInvalid(emailInput, 'Please enter a valid email address (or leave it blank).');
    return;
  }
  clearInvalid(emailInput);

  if (!isValidZip(zipInput.value)) {
    flagInvalid(zipInput, 'Please enter a valid 5-digit ZIP code.');
    return;
  }
  clearInvalid(zipInput);

  if (photosTotalBytes() > MAX_PHOTOS_TOTAL_BYTES) {
    const status = document.getElementById('photo-status');
    if (status) status.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  state.contact = {
    name:  nameInput.value,
    phone: phoneInput.value,
    email: emailInput.value,
    zip:   zipInput.value.trim(),
    notes: notesInput.value,
  };
  state.price = calculateEstimate();

  // Snapshot the payload now so subsequent state changes (e.g. user starts a
  // second estimate) can't corrupt the in-flight submission.
  const payloadBase = {
    formType: 'estimate_contact',
    service: state.service,
    answers: { ...state.answers },
    price: { ...state.price },
    contact: { ...state.contact },
    page: location.href,
  };

  // Photos are read asynchronously (FileReader); submit without blocking the UI.
  readPhotos().then(photos => {
    postLead({ ...payloadBase, photos });
  });

  showResult();
  goToStep('result');
}

// Read every File in state.photos as a base64 data URL. Resolves to an array of
// { name, mimeType, dataUrl, size }. The selection UI already enforces count
// and total-size limits, so this just does the encoding.
function readPhotos() {
  if (!state.photos.length) return Promise.resolve([]);
  const reads = state.photos.map(file => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type,
      dataUrl: reader.result,
      size: file.size,
    });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  }));
  return Promise.all(reads).then(results => results.filter(Boolean));
}

function submitSchedule(e) {
  e.preventDefault();

  const phoneInput = document.getElementById('sched-phone');
  const emailInput = document.getElementById('sched-email');

  if (!isValidPhone(phoneInput.value)) {
    flagInvalid(phoneInput, 'Please enter a valid phone number we can call you back on.');
    return;
  }
  clearInvalid(phoneInput);

  if (!isValidEmail(emailInput.value)) {
    flagInvalid(emailInput, 'Please enter a valid email address (or leave it blank).');
    return;
  }
  clearInvalid(emailInput);

  const sched = {
    name:  document.getElementById('sched-name').value,
    phone: phoneInput.value,
    email: emailInput.value,
    time:  document.getElementById('sched-time').value,
    notes: document.getElementById('sched-notes').value,
  };

  postLead({
    formType: 'schedule',
    service: state.service,
    answers: state.answers,
    price: state.price || calculateEstimate(),
    contact: { name: sched.name, phone: sched.phone, email: sched.email },
    scheduledTime: sched.time,
    scheduleNotes: sched.notes,
    page: location.href
  });

  document.getElementById('scheduleForm').style.display = 'none';
  document.getElementById('scheduleConfirmation').style.display = 'block';
}

// Fire-and-forget POST to the Apps Script endpoint. Never blocks the UX —
// the user always sees the success state, even if the network request fails.
function postLead(payload) {
  if (!APPS_SCRIPT_URL) {
    console.log('[lead] APPS_SCRIPT_URL not set, would have sent:', payload);
    return;
  }
  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.warn('[lead] post failed', err));
}

// Close modal on overlay click
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    closeScheduleModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeScheduleModal();
  }
});
