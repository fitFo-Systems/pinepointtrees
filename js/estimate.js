/* =============================================
   Pine Point Tree Service — Estimate Tool
   Service-specific question paths with
   branching logic and targeted pricing.
   ============================================= */

// --- State ---
const state = {
  service: null,
  answers: {},
  contact: {},
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
});

// --- Service Selection ---
function selectService(service) {
  state.service = service;
  state.answers = {};

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
  state.contact = {
    name:  document.getElementById('contact-name').value,
    phone: document.getElementById('contact-phone').value,
    email: document.getElementById('contact-email').value,
    town:  document.getElementById('contact-town').value,
  };
  // Calculate estimate and show result
  showResult();
  goToStep('result');
  // In production: POST contact info + estimate data to Google Apps Script
}

function submitSchedule(e) {
  e.preventDefault();
  // In production: POST to Google Apps Script with estimate context + contact info
  document.getElementById('scheduleForm').style.display = 'none';
  document.getElementById('scheduleConfirmation').style.display = 'block';
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
