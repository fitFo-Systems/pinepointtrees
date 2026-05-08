/* =============================================
   Pine Point Tree Service — /crew tool (Phase 1)
   Token-gated internal page for confirming a
   customer's submitted estimate, capturing the
   street address + tree species/count, drafting
   a job description, and locking in a final
   total. Saves to a "Quotes" tab in the lead
   sheet via the existing Apps Script endpoint.
   PDF / email come in Phase 2.
   ============================================= */

// Apps Script endpoints. The crew tool reads/writes against ONE
// endpoint (the JSONP read needs a single target). During QA we route
// it through FITFO's deployment because that's where the new crew_*
// handlers are live; once Jason redeploys his copy with the same
// handlers, swap CREW_BACKEND_URL to APPS_SCRIPT_URL_CLIENT.
const APPS_SCRIPT_URL_CLIENT = 'https://script.google.com/macros/s/AKfycby5Ss1I9EUZP2e0ZuGGkP48JPDYIWjllVY7BadNjRpqiK2JHUyEDgzc_e5-VaVzosi6QQ/exec';
const APPS_SCRIPT_URL_FITFO  = 'https://script.google.com/macros/s/AKfycbz68dVyIGyruTPSofHei6UqcbkBuDZKhGybFLFjcowc2uCSIkDol4NWOJ0FOZdqlxOXpQ/exec';
const CREW_BACKEND_URL = APPS_SCRIPT_URL_FITFO;
// Mirror crew writes to the other endpoint as a fire-and-forget so
// production data ends up in both Sheets once Jason is online.
const CREW_MIRROR_URL  = APPS_SCRIPT_URL_CLIENT;

const STORAGE_KEY_TOKEN = 'pinepoint.crew.token.v1';

const SPECIES_OPTIONS = [
  { value: 'oak',     label: 'Oak' },
  { value: 'maple',   label: 'Maple' },
  { value: 'pine',    label: 'White Pine' },
  { value: 'hemlock', label: 'Hemlock' },
  { value: 'birch',   label: 'Birch' },
  { value: 'ash',     label: 'Ash' },
  { value: 'other',   label: 'Other' }
];

const SIZE_OPTIONS = [
  { value: 'small',  label: 'Small (<25 ft)' },
  { value: 'medium', label: 'Medium (25–50 ft)' },
  { value: 'large',  label: 'Large (50–75 ft)' },
  { value: 'xlarge', label: 'Very Large (75+ ft)' }
];

const SERVICE_LABELS = {
  removal: 'Tree Removal',
  trimming: 'Trimming & Pruning',
  lot_clearing: 'Lot Clearing',
  other: 'Other'
};

// Maps for translating the customer's submitted estimator answers
// into human-readable strings on the read-only "What the customer
// said" panel. Keys mirror the values stored on the Estimate Leads
// sheet (and js/estimate.js's labels object).
const ANSWER_LABELS = {
  treeCount:  { '1': '1 tree', '2-3': '2–3 trees', '4-6': '4–6 trees', '7+': '7 or more trees' },
  treeHeight: { small: 'Small (<25 ft)', medium: 'Medium (25–50 ft)', large: 'Large (50–75 ft)', xlarge: 'Very large (75+ ft)' },
  hazards:    { none: 'Open area', house: 'Near structure', powerlines: 'Near power lines', both: 'Near structure and lines' },
  access:     { easy: 'Easy access', limited: 'Tight but possible', none: 'Difficult — manual carry' },
  pruneType:  { overhang: 'Branches over house / driveway', shaping: 'General shaping or thinning', deadwood: 'Dead or dangerous limbs', clearance: 'Clearance from lines / fence / structure' },
  lotSize:    { small: 'Small area (<1/4 acre)', medium: 'Medium (1/4–1/2 acre)', large: 'Large (1/2–1 acre)', xlarge: '1+ acres' },
  lotDensity: { brush: 'Brush + small trees', mixed: 'Mixed', heavy: 'Dense woods + large trees' },
  endGoal:    { build: 'Construction prep', yard: 'Yard or lawn finish', thin: 'Selective thinning', as_is: 'Leave as is (no finishing)' },
  trunkWood:  { yes: 'Wood stays on property', no: 'Smaller wood chipped, 9 inch+ stays' }
};

// Order of fields to show under "What the customer said" per service
// type. Customer answers we don't have nice labels for fall through.
const ANSWER_ORDER = {
  removal:      ['treeCount', 'treeHeight', 'hazards', 'access', 'trunkWood'],
  trimming:     ['treeCount', 'treeHeight', 'pruneType', 'access'],
  lot_clearing: ['lotSize',   'lotDensity', 'access',    'endGoal', 'trunkWood']
};
const ANSWER_FIELD_LABELS = {
  treeCount: 'Tree count', treeHeight: 'Tree height', hazards: 'Hazards', access: 'Truck access',
  pruneType: 'Prune type', lotSize: 'Lot size', lotDensity: 'Density', endGoal: 'End goal',
  trunkWood: 'Wood handling'
};

const state = {
  token: null,
  filter: 'open',
  leads: [],
  searchTerm: '',
  currentLead: null,    // full lead detail being edited
  trees: [],            // [{species, count, size, speciesOther?}]
  isManual: false,      // true when editing a brand-new manual lead
  // Saved-quote context for the "Saved" view actions:
  savedQuote: null,     // { quoteNumber, estimateNumber, customerName, customerEmail, total, pdfUrl, status }
};

// =============================================
// Boot
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  const urlToken = new URLSearchParams(location.search).get('t');
  if (urlToken) {
    state.token = urlToken;
    try { localStorage.setItem(STORAGE_KEY_TOKEN, urlToken); } catch (e) {}
    // Strip the token from the URL so it doesn't sit in history.
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  } else {
    try { state.token = localStorage.getItem(STORAGE_KEY_TOKEN) || null; } catch (e) {}
  }

  if (!state.token) {
    showView('locked');
    return;
  }

  wireListView();
  wireEditView();
  wireSavedView();
  loadLeads();
  showView('list');
});

// =============================================
// View routing
// =============================================
function showView(name) {
  document.getElementById('crew-locked').style.display = name === 'locked' ? '' : 'none';
  document.getElementById('crew-list').style.display   = name === 'list'   ? '' : 'none';
  document.getElementById('crew-edit').style.display   = name === 'edit'   ? '' : 'none';
  document.getElementById('crew-saved').style.display  = name === 'saved'  ? '' : 'none';
  window.scrollTo({ top: 0 });
}

// =============================================
// LIST VIEW
// =============================================
function wireListView() {
  document.querySelectorAll('.crew-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.crew-filter-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.filter = btn.dataset.filter;
      loadLeads();
    });
  });

  const searchInput = document.getElementById('crew-search');
  searchInput.addEventListener('input', () => {
    state.searchTerm = searchInput.value.trim().toLowerCase();
    renderLeads();
  });

  document.getElementById('crew-new-lead-btn').addEventListener('click', () => {
    openManualLead();
  });
}

function loadLeads() {
  const loadingEl = document.getElementById('crew-list-loading');
  const errorEl = document.getElementById('crew-list-error');
  const rowsEl = document.getElementById('crew-list-rows');
  const emptyEl = document.getElementById('crew-list-empty');

  loadingEl.style.display = '';
  errorEl.style.display = 'none';
  rowsEl.innerHTML = '';
  emptyEl.style.display = 'none';

  jsonp({ action: 'crew_list', token: state.token, filter: state.filter })
    .then(res => {
      loadingEl.style.display = 'none';
      if (res.error === 'unauthorized') {
        // Bad/stale token — wipe and lock.
        try { localStorage.removeItem(STORAGE_KEY_TOKEN); } catch (e) {}
        state.token = null;
        showView('locked');
        return;
      }
      if (res.error) {
        errorEl.textContent = 'Could not load leads: ' + res.error;
        errorEl.style.display = '';
        return;
      }
      state.leads = res.leads || [];
      renderLeads();
    })
    .catch(err => {
      loadingEl.style.display = 'none';
      errorEl.textContent = 'Network error loading leads. Check your connection and try again.';
      errorEl.style.display = '';
      console.error('[crew] list error', err);
    });
}

function renderLeads() {
  const rowsEl = document.getElementById('crew-list-rows');
  const emptyEl = document.getElementById('crew-list-empty');
  const term = state.searchTerm;

  const matched = state.leads.filter(lead => {
    if (!term) return true;
    return ((lead.name || '') + ' ' + (lead.phone || '')).toLowerCase().includes(term);
  });

  if (!matched.length) {
    rowsEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  rowsEl.innerHTML = matched.map(lead => {
    const status = lead.status || 'New';
    const statusClass = 'crew-pill crew-pill--' + status.toLowerCase().replace(/\s+/g, '-');
    return `
      <button type="button" class="crew-lead-row" data-est="${escapeAttr(lead.estimateNumber)}">
        <div class="crew-lead-row__main">
          <div class="crew-lead-row__name">${escapeText(lead.name || '(no name)')}</div>
          <div class="crew-lead-row__sub">${escapeText(lead.phone || '')} · ${escapeText(lead.jobType || lead.leadType || '—')}</div>
        </div>
        <div class="crew-lead-row__right">
          <span class="${statusClass}">${escapeText(status)}</span>
          <span class="crew-lead-row__est">${escapeText(lead.estimateNumber || '')}</span>
        </div>
      </button>
    `;
  }).join('');

  rowsEl.querySelectorAll('.crew-lead-row').forEach(btn => {
    btn.addEventListener('click', () => {
      // Immediate visual feedback so the click feels instant even when the
      // server is cold-starting (~1-2s on first hit).
      rowsEl.querySelectorAll('.crew-lead-row').forEach(b => b.classList.remove('is-loading'));
      btn.classList.add('is-loading');
      openLead(btn.dataset.est);
    });
  });
}

// =============================================
// EDIT / CONFIRM VIEW
// =============================================
function wireEditView() {
  document.getElementById('crew-back-btn').addEventListener('click', () => {
    showView('list');
  });
  document.getElementById('crew-trees-add').addEventListener('click', () => {
    addTreeRow({ species: '', count: 1, size: 'medium', speciesOther: '' });
  });

  // Auto-format phone as user types
  document.getElementById('crew-phone').addEventListener('input', (e) => {
    e.target.value = formatPhoneAsTyped(e.target.value);
  });

  document.getElementById('crew-save-btn').addEventListener('click', () => {
    saveQuote();
  });

  // Re-draft description whenever trees / service change (only if user hasn't customized).
  document.getElementById('crew-service').addEventListener('change', () => {
    updateTreesVisibility();
    maybeRedraftDescription();
  });
}

/**
 * Trees grid is hidden for lot clearing — there's no per-tree
 * tracking happening; the job is by area + density + end goal. Crew
 * can still type a description; the auto-draft uses lot vocabulary.
 */
function updateTreesVisibility() {
  const treesEl = document.getElementById('crew-trees');
  const service = document.getElementById('crew-service').value;
  treesEl.style.display = (service === 'lot_clearing') ? 'none' : '';
}

/**
 * Renders the "What the customer said" read-only panel. Hidden for
 * manual leads (no customer-side data). Only shows answers/notes —
 * never appears on the customer's quote/invoice.
 */
function renderCustomerSaid(lead) {
  const wrap = document.getElementById('crew-customer-said');
  const rowsEl = document.getElementById('crew-customer-said-rows');
  const notesWrap = document.getElementById('crew-customer-said-notes');
  const notesBody = document.getElementById('crew-customer-said-notes-body');

  // No data to show? Hide entirely.
  const isEstimateLead = lead && lead.leadSource === 'estimate';
  const hasNotes = !!(lead && lead.notes);
  const hasAnswers = lead && lead.answers && Object.values(lead.answers).some(v => v);
  if (!isEstimateLead && !hasNotes && !hasAnswers) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  const rows = [];
  // Service the customer picked
  if (lead.service) {
    rows.push({ label: 'Service', value: SERVICE_LABELS[lead.service] || lead.service });
  }
  // Customer's answers in the order that fits their service path
  const order = ANSWER_ORDER[lead.service] || [];
  order.forEach(key => {
    const v = (lead.answers || {})[key];
    if (!v) return;
    const label = ANSWER_FIELD_LABELS[key] || key;
    const human = (ANSWER_LABELS[key] && ANSWER_LABELS[key][v]) || v;
    rows.push({ label, value: human });
  });
  // Customer's price range (what we showed them)
  const ce = lead.customerEstimate || {};
  if (ce.low || ce.typical || ce.high) {
    rows.push({
      label: 'Price they saw',
      value: 'Low $' + (ce.low || '?') + ' · Typical $' + (ce.typical || '?') + ' · High $' + (ce.high || '?')
    });
  }

  rowsEl.innerHTML = rows.map(r =>
    '<div class="crew-readonly-row"><div class="crew-readonly-row__label">' + escapeText(r.label) + '</div>' +
    '<div class="crew-readonly-row__value">' + escapeText(r.value) + '</div></div>'
  ).join('');

  if (hasNotes) {
    notesWrap.style.display = '';
    notesBody.textContent = lead.notes;
  } else {
    notesWrap.style.display = 'none';
  }
}

function openLead(estimateNumber) {
  state.isManual = false;
  state.currentLead = null;
  state.trees = [];

  jsonp({ action: 'crew_get', token: state.token, id: estimateNumber })
    .then(res => {
      if (res.error === 'unauthorized') {
        try { localStorage.removeItem(STORAGE_KEY_TOKEN); } catch (e) {}
        state.token = null;
        showView('locked');
        return;
      }
      if (res.error) {
        alert('Could not load this lead: ' + res.error);
        return;
      }
      state.currentLead = res.lead;
      hydrateEditForm(res.lead);
      showView('edit');
    })
    .catch(err => {
      alert('Network error loading this lead.');
      console.error('[crew] get error', err);
    });
}

function openManualLead() {
  state.isManual = true;
  state.currentLead = null;
  state.trees = [];
  hydrateEditForm({
    estimateNumber: '(new — assigned on save)',
    contact: { name: '', phone: '', email: '', zip: '', address: '' },
    service: '',
    answers: {},
    customerEstimate: { low: '', typical: '', high: '' },
    quote: null,
    leadSource: 'manual'
  });
  showView('edit');
}

function hydrateEditForm(lead) {
  const c = lead.contact || {};
  const q = lead.quote || null;
  const ce = lead.customerEstimate || { low: '', typical: '', high: '' };

  document.getElementById('crew-edit-title').textContent =
    state.isManual ? 'New manual lead' : 'Confirm details';

  const metaParts = [];
  if (!state.isManual) metaParts.push('Estimate ' + (lead.estimateNumber || '?'));
  if (q && q.quoteNumber) metaParts.push('Quote ' + q.quoteNumber + ' · ' + (q.status || 'Draft'));
  if (lead.leadSource) metaParts.push(lead.leadSource === 'estimate' ? 'From online estimate' : 'Manual entry');
  document.getElementById('crew-edit-meta').textContent = metaParts.join(' · ');

  // Customer fields — prefer existing Quote draft over the lead row
  const useQuote = q && q.customer;
  document.getElementById('crew-name').value    = (useQuote && q.customer.name)    || c.name    || '';
  document.getElementById('crew-phone').value   = formatPhoneAsTyped((useQuote && q.customer.phone) || c.phone || '');
  document.getElementById('crew-email').value   = (useQuote && q.customer.email)   || c.email   || '';
  document.getElementById('crew-zip').value     = (useQuote && q.customer.zip)     || c.zip     || '';
  document.getElementById('crew-address').value = (useQuote && q.customer.address) || c.address || '';

  // Service
  document.getElementById('crew-service').value = (q && q.service) || lead.service || '';

  // What the customer said — read-only panel, only when there's something to show.
  renderCustomerSaid(lead);

  // Trees: from existing draft, or seed one blank row
  state.trees = (q && Array.isArray(q.trees) && q.trees.length)
    ? q.trees.map(t => ({ species: t.species || '', count: Number(t.count) || 1, size: t.size || 'medium', speciesOther: t.speciesOther || '' }))
    : [{ species: '', count: 1, size: 'medium', speciesOther: '' }];
  renderTreeRows();
  updateTreesVisibility();

  // Description
  const descEl = document.getElementById('crew-description');
  if (q && q.description) {
    descEl.value = q.description;
    descEl.dataset.userEdited = '1';
  } else {
    descEl.value = '';
    delete descEl.dataset.userEdited;
    maybeRedraftDescription();
  }
  // Track manual edits so auto-redraft doesn't overwrite them
  descEl.addEventListener('input', () => { descEl.dataset.userEdited = '1'; }, { once: true });

  // Total
  document.getElementById('crew-total').value = (q && q.total) || ce.typical || '';

  // Customer estimate side-display
  const estEl = document.getElementById('crew-customer-est');
  if (ce.low || ce.typical || ce.high) {
    estEl.innerHTML = '<span class="crew-customer-est__label">Customer saw:</span> ' +
      'Low <strong>$' + (ce.low || '?') + '</strong> · ' +
      'Typical <strong>$' + (ce.typical || '?') + '</strong> · ' +
      'High <strong>$' + (ce.high || '?') + '</strong>';
  } else {
    estEl.textContent = state.isManual ? 'No customer-side estimate (manual lead).' : '';
  }

  // Customer-facing note + internal notes
  document.getElementById('crew-customer-note').value = (q && q.customerNote) || '';
  document.getElementById('crew-notes').value = (q && q.notes) || '';

  // Reset save hint
  document.getElementById('crew-save-hint').textContent = '';
}

function addTreeRow(tree) {
  state.trees.push(tree);
  renderTreeRows();
}

function renderTreeRows() {
  const wrap = document.getElementById('crew-trees-rows');
  wrap.innerHTML = state.trees.map((t, i) => `
    <div class="crew-tree-row" data-idx="${i}">
      <div class="crew-tree-row__main">
        <select class="crew-tree-row__species" data-field="species">
          <option value="">— species —</option>
          ${SPECIES_OPTIONS.map(o => `<option value="${o.value}" ${t.species === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <input type="number" class="crew-tree-row__count" data-field="count" min="1" step="1" value="${Number(t.count) || 1}">
        <select class="crew-tree-row__size" data-field="size">
          ${SIZE_OPTIONS.map(o => `<option value="${o.value}" ${t.size === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <button type="button" class="crew-tree-row__remove" data-idx="${i}" aria-label="Remove tree">×</button>
      </div>
      <input type="text" class="crew-tree-row__other" data-field="speciesOther" placeholder="Other species (e.g. cherry, locust)" value="${escapeAttr(t.speciesOther || '')}" ${t.species === 'other' ? '' : 'style="display:none"'}>
    </div>
  `).join('');

  wrap.querySelectorAll('.crew-tree-row').forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('change', () => {
        const field = input.dataset.field;
        let value = input.value;
        if (field === 'count') value = Math.max(1, parseInt(value, 10) || 1);
        state.trees[idx][field] = value;
        if (field === 'species') {
          const otherEl = row.querySelector('[data-field="speciesOther"]');
          if (otherEl) otherEl.style.display = (value === 'other') ? '' : 'none';
          if (value !== 'other') state.trees[idx].speciesOther = '';
        }
        maybeRedraftDescription();
      });
    });
    row.querySelector('.crew-tree-row__remove').addEventListener('click', () => {
      state.trees.splice(idx, 1);
      if (!state.trees.length) state.trees.push({ species: '', count: 1, size: 'medium', speciesOther: '' });
      renderTreeRows();
      maybeRedraftDescription();
    });
  });
}

// Auto-draft a job description from current trees + service. Skips if
// the user has already edited the description.
function maybeRedraftDescription() {
  const descEl = document.getElementById('crew-description');
  if (descEl.dataset.userEdited === '1') return;
  const service = document.getElementById('crew-service').value;
  descEl.value = draftDescription(service, state.trees);
}

function draftDescription(service, trees) {
  const treesPhrase = (trees || [])
    .filter(t => t.species)
    .map(t => {
      const speciesLabel = t.species === 'other'
        ? (t.speciesOther || 'tree')
        : (SPECIES_OPTIONS.find(o => o.value === t.species) || {}).label || t.species;
      const sizeLabel = (SIZE_OPTIONS.find(o => o.value === t.size) || {}).label || '';
      const sizeShort = (sizeLabel.split(' ')[0] || '').toLowerCase();
      const plural = (Number(t.count) > 1) ? 's' : '';
      return Number(t.count) + ' ' + (sizeShort ? sizeShort + ' ' : '') + speciesLabel.toLowerCase() + plural;
    })
    .filter(Boolean);

  if (!treesPhrase.length) return '';

  const lines = [];
  if (service === 'removal') {
    lines.push('Take down ' + joinList(treesPhrase) + '.');
    lines.push('Chip limbs up to 8". Wood 9 inches and larger stays on property; smaller wood is chipped and hauled.');
    lines.push('Cut stumps as low as possible.');
  } else if (service === 'trimming') {
    lines.push('Prune ' + joinList(treesPhrase) + '.');
    lines.push('Chip limbs and haul away brush.');
  } else if (service === 'lot_clearing') {
    lines.push('Clear ' + joinList(treesPhrase) + ' plus brush from the work area.');
    lines.push('Chip what we can; haul the rest.');
  } else {
    lines.push('Tree work: ' + joinList(treesPhrase) + '.');
  }
  return lines.join(' ');
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

// =============================================
// SAVE
// =============================================
function saveQuote() {
  const hint = document.getElementById('crew-save-hint');
  const btn = document.getElementById('crew-save-btn');

  const customer = {
    name:    document.getElementById('crew-name').value.trim(),
    phone:   document.getElementById('crew-phone').value.trim(),
    email:   document.getElementById('crew-email').value.trim(),
    zip:     document.getElementById('crew-zip').value.trim(),
    address: document.getElementById('crew-address').value.trim()
  };

  if (!customer.name)    return showHint(hint, 'Need a name.', 'error');
  if (!customer.phone)   return showHint(hint, 'Need a phone number.', 'error');
  if (!customer.address) return showHint(hint, 'Need a street address.', 'error');

  const total = parseFloat(document.getElementById('crew-total').value);
  if (!Number.isFinite(total) || total <= 0) {
    return showHint(hint, 'Set a final total.', 'error');
  }

  const trees = state.trees
    .filter(t => t.species)
    .map(t => ({
      species: t.species,
      count: Math.max(1, parseInt(t.count, 10) || 1),
      size: t.size || 'medium',
      speciesOther: t.species === 'other' ? (t.speciesOther || '') : ''
    }));

  const service = document.getElementById('crew-service').value;
  const description = document.getElementById('crew-description').value.trim();
  const customerNote = document.getElementById('crew-customer-note').value.trim();
  const notes = document.getElementById('crew-notes').value.trim();

  btn.disabled = true;
  showHint(hint, 'Saving…', 'pending');

  // Manual leads need the lead row created first so they have an Estimate #.
  const ensureEstimate = state.isManual
    ? createManualLead({ contact: customer, service, notes })
    : Promise.resolve({ ok: true, estimateNumber: state.currentLead.estimateNumber });

  ensureEstimate
    .then(res => {
      if (res.error) throw new Error(res.error);
      const estimateNumber = res.estimateNumber;
      const customerEstimate = (state.currentLead && state.currentLead.customerEstimate) || { low: '', typical: '', high: '' };
      return postQuote({
        estimateNumber,
        customer,
        service,
        trees,
        description,
        total,
        customerEstimate,
        notes,
        customerNote
      });
    })
    .then(res => {
      if (res.error) throw new Error(res.error);
      showHint(hint, '', 'ok');
      btn.disabled = false;
      // Capture the saved-quote context for the saved view actions.
      state.savedQuote = {
        quoteNumber: res.quoteNumber || '',
        estimateNumber: state.isManual ? res.quoteNumber : (state.currentLead && state.currentLead.estimateNumber) || '',
        customerName: customer.name,
        customerEmail: customer.email,
        total: total,
        status: 'Draft',
        pdfUrl: ''
      };
      // For manual leads we need to remember the new Estimate # so subsequent
      // sends know which row to operate on.
      if (state.isManual && state.currentLead === null) {
        // Fetch the freshly-created lead so future actions have full context.
        // (Server returned us a quoteNumber + the estimateNumber from createCrewLead;
        // we already stashed estimateNumber on currentLead during ensureEstimate.)
      }
      document.getElementById('crew-saved-num').textContent = state.savedQuote.quoteNumber || '(saved)';
      document.getElementById('crew-saved-customer').textContent = customer.name + ' · $' + total.toLocaleString('en-US');
      document.getElementById('crew-saved-title').textContent = 'Quote saved';
      // Buttons stay enabled — first click on View PDF generates if needed,
      // first click on Send to customer with no email shows a clear error
      // (a disabled button silently does nothing, which is worse UX).
      const viewBtn = document.getElementById('crew-saved-view-pdf');
      viewBtn.disabled = false;
      viewBtn.textContent = 'View PDF';
      const sendCustomerBtn = document.getElementById('crew-saved-send-customer');
      sendCustomerBtn.disabled = false;
      sendCustomerBtn.textContent = customer.email ? 'Send to customer' : 'Send to customer';
      // Mark complete only when status is Sent or later
      document.getElementById('crew-saved-mark-complete').style.display = 'none';
      document.getElementById('crew-saved-hint').textContent = '';
      showView('saved');
      // Eagerly generate the PDF in the background so by the time the
      // crew taps View PDF the URL is already set and the open call
      // happens synchronously inside the user-gesture window (no popup
      // blocker headaches).
      sendQuoteAction({ mode: '', silentSuccess: true });
    })
    .catch(err => {
      btn.disabled = false;
      showHint(hint, 'Save failed: ' + err.message, 'error');
      console.error('[crew] save error', err);
    });
}

function postQuote(quote) {
  return postWithReply({
    formType: 'crew_save_quote',
    token: state.token,
    quote: quote,
    user: 'crew'
  });
}

function createManualLead(payload) {
  return postWithReply({
    formType: 'crew_create_lead',
    token: state.token,
    contact: payload.contact,
    service: payload.service,
    notes: payload.notes
  });
}

// =============================================
// SAVED VIEW — PDF generation, send to customer / preview, mark complete
// =============================================
function wireSavedView() {
  document.getElementById('crew-saved-back').addEventListener('click', () => {
    loadLeads();
    showView('list');
  });
  document.getElementById('crew-saved-edit').addEventListener('click', () => {
    showView('edit');
  });

  document.getElementById('crew-saved-view-pdf').addEventListener('click', async () => {
    const url = (state.savedQuote && state.savedQuote.pdfUrl) || '';
    if (url) {
      // Synchronous click path — no async wait, no popup blocker.
      openInNewTab(url);
      return;
    }
    // No URL yet (eager generation either hasn't finished or hasn't started).
    // Open about:blank synchronously inside this click event so we keep the
    // user-gesture context, then redirect that tab to the PDF when it's ready.
    const placeholderTab = window.open('about:blank', '_blank');
    await sendQuoteAction({ mode: '' });
    const finalUrl = state.savedQuote && state.savedQuote.pdfUrl;
    if (placeholderTab && !placeholderTab.closed && finalUrl) {
      placeholderTab.location.href = finalUrl;
    } else if (finalUrl) {
      // Placeholder tab was blocked or closed — fall back to anchor click.
      openInNewTab(finalUrl);
    } else if (placeholderTab && !placeholderTab.closed) {
      placeholderTab.close();
    }
  });

  document.getElementById('crew-saved-send-customer').addEventListener('click', async () => {
    const sq = state.savedQuote || {};
    let email = sq.customerEmail || '';
    if (!email) {
      const prompted = window.prompt(
        "No email on file for " + (sq.customerName || 'this customer') + ".\n\n" +
        "Enter their email address to send the quote:"
      );
      if (prompted === null) return;  // user cancelled the prompt
      const trimmed = String(prompted).trim();
      if (!trimmed) { setSavedHint('No email entered.', 'error'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setSavedHint("That email doesn't look right — check the @ and the domain.", 'error');
        return;
      }
      email = trimmed;
      state.savedQuote.customerEmail = email;  // remember locally so they don't have to re-enter
    }
    const ok = window.confirm('Email this quote to ' + sq.customerName + ' at ' + email + '?');
    if (!ok) return;
    await sendQuoteAction({ mode: 'customer', overrideEmail: email });
  });

  document.getElementById('crew-saved-send-self').addEventListener('click', async () => {
    await sendQuoteAction({ mode: 'preview' });
  });

  document.getElementById('crew-saved-mark-complete').addEventListener('click', async () => {
    const sq = state.savedQuote || {};
    const ok = window.confirm('Mark the job done and email the invoice to ' + (sq.customerName || 'customer') +
      (sq.customerEmail ? ' at ' + sq.customerEmail : '') + '?');
    if (!ok) return;
    await markCompleteAndSendInvoice();
  });
}

function setSavedHint(msg, kind) {
  const el = document.getElementById('crew-saved-hint');
  el.textContent = msg;
  el.className = 'crew-action-hint';
  if (kind) el.classList.add('crew-action-hint--' + kind);
}

/**
 * Opens a URL in a new tab via a programmatic anchor click. Browsers
 * (esp. Safari) will silently block window.open() to a different
 * origin even from a click handler if there's any async wait between
 * the click and the call. A real anchor with target=_blank doesn't
 * trigger popup blockers — Drive PDF URLs open reliably this way.
 */
function openInNewTab(url) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); }, 0);
}

/**
 * mode === 'customer' -> emails the customer + flips status to Sent
 * mode === 'preview'  -> emails the script owner only
 * mode === ''         -> just generates the PDF, no email (used by View PDF)
 */
async function sendQuoteAction(opts) {
  opts = opts || {};
  const sq = state.savedQuote || {};
  if (!sq.estimateNumber) {
    if (!opts.silentSuccess) setSavedHint('No saved quote in scope — try saving again.', 'error');
    return;
  }
  if (!opts.silentSuccess) setSavedHint('Generating PDF…', 'pending');
  try {
    const res = await postWithReply({
      formType: 'crew_send_quote',
      token: state.token,
      estimateNumber: sq.estimateNumber,
      mode: opts.mode || '',
      asInvoice: !!opts.asInvoice,
      overrideCustomerEmail: opts.overrideEmail || ''
    });
    if (res.error) {
      if (!opts.silentSuccess) setSavedHint('Failed: ' + res.error, 'error');
      return;
    }
    if (res.pdfUrl) {
      state.savedQuote.pdfUrl = res.pdfUrl;
      const viewBtn = document.getElementById('crew-saved-view-pdf');
      viewBtn.disabled = false;
      viewBtn.textContent = 'View PDF';
    }
    if (opts.mode === 'customer' && res.sent) {
      state.savedQuote.status = 'Sent';
      setSavedHint('Sent to ' + res.sentTo, 'ok');
      document.getElementById('crew-saved-mark-complete').style.display = '';
    } else if (opts.mode === 'preview' && res.sent) {
      setSavedHint('Preview emailed to ' + res.sentTo, 'ok');
    } else if (!opts.mode && !opts.silentSuccess) {
      setSavedHint('PDF ready', 'ok');
    } else if (res.sendError) {
      setSavedHint('PDF generated but email failed: ' + res.sendError, 'error');
    } else if (!opts.mode && opts.silentSuccess) {
      // Eager-generation success — quietly mark "PDF ready" without
      // overwriting any user-facing hint.
      const hintEl = document.getElementById('crew-saved-hint');
      if (hintEl && !hintEl.textContent) setSavedHint('PDF ready', 'ok');
    }
  } catch (err) {
    if (!opts.silentSuccess) setSavedHint('Network error — try again.', 'error');
    console.error('[crew] send error', err);
  }
}

async function markCompleteAndSendInvoice() {
  const sq = state.savedQuote || {};
  setSavedHint('Marking complete…', 'pending');
  try {
    const markRes = await postWithReply({
      formType: 'crew_mark_complete',
      token: state.token,
      estimateNumber: sq.estimateNumber
    });
    if (markRes.error) { setSavedHint('Mark complete failed: ' + markRes.error, 'error'); return; }
    setSavedHint('Generating invoice PDF…', 'pending');
    const sendRes = await postWithReply({
      formType: 'crew_send_quote',
      token: state.token,
      estimateNumber: sq.estimateNumber,
      mode: sq.customerEmail ? 'customer' : '',
      asInvoice: true
    });
    if (sendRes.error) { setSavedHint('Send failed: ' + sendRes.error, 'error'); return; }
    if (sendRes.pdfUrl) state.savedQuote.pdfUrl = sendRes.pdfUrl;
    state.savedQuote.status = 'Invoiced';
    document.getElementById('crew-saved-title').textContent = 'Invoice sent';
    setSavedHint(sendRes.sent ? 'Invoice emailed to ' + sendRes.sentTo : 'Invoice generated. No email sent (no customer email on file).', 'ok');
    document.getElementById('crew-saved-mark-complete').style.display = 'none';
    const viewBtn = document.getElementById('crew-saved-view-pdf');
    viewBtn.disabled = false;
    viewBtn.textContent = 'View invoice PDF';
  } catch (err) {
    setSavedHint('Network error — try again.', 'error');
    console.error('[crew] mark complete error', err);
  }
}

// =============================================
// Helpers
// =============================================
function showHint(el, msg, kind) {
  el.textContent = msg;
  el.className = 'crew-action-hint';
  if (kind) el.classList.add('crew-action-hint--' + kind);
}

function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = String(s == null ? '' : s);
  return div.innerHTML;
}
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatPhoneAsTyped(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return '(' + digits;
  if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
  if (digits.length <= 10) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  return '+' + digits.slice(0, 1) + ' (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
}

// JSONP fetcher — Apps Script web apps don't send CORS headers on GET,
// so we load via <script> tag and a callback. POSTs use no-cors and
// don't get a response back; for crew operations we want a response,
// so we use sendBeacon-style fetch with a Content-Type that bypasses
// preflight (text/plain), and read the JSON via our companion JSONP
// "ack" pattern below.
let _jsonpSeq = 0;
function jsonp(params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = '__pp_cb_' + (++_jsonpSeq) + '_' + Date.now();
    const qs = Object.keys(params || {})
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const url = CREW_BACKEND_URL + '?' + qs + '&callback=' + cbName;
    const script = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Request timed out'));
    }, timeoutMs || 12000);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Script load failed'));
    };
    script.src = url;
    document.head.appendChild(script);
  });
}

// POST with reply via fetch + text/plain (avoids CORS preflight).
// Apps Script returns JSON; we read it directly from the response.
// During QA the primary backend is FITFO; CREW_MIRROR_URL gets a
// fire-and-forget copy so once Jason's deployment catches up, both
// Sheets stay in sync.
function postWithReply(payload) {
  if (CREW_MIRROR_URL && CREW_MIRROR_URL !== CREW_BACKEND_URL) {
    fetch(CREW_MIRROR_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }
  return fetch(CREW_BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  })
    .then(r => r.text())
    .then(text => {
      try { return JSON.parse(text); } catch (e) { return { error: 'invalid response: ' + text.slice(0, 200) }; }
    });
}
