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

const state = {
  token: null,
  filter: 'open',
  leads: [],
  searchTerm: '',
  currentLead: null,    // full lead detail being edited
  trees: [],            // [{species, count, size, speciesOther?}]
  isManual: false       // true when editing a brand-new manual lead
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
    btn.addEventListener('click', () => openLead(btn.dataset.est));
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
  document.getElementById('crew-service').addEventListener('change', maybeRedraftDescription);
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

  // Trees: from existing draft, or seed one blank row
  state.trees = (q && Array.isArray(q.trees) && q.trees.length)
    ? q.trees.map(t => ({ species: t.species || '', count: Number(t.count) || 1, size: t.size || 'medium', speciesOther: t.speciesOther || '' }))
    : [{ species: '', count: 1, size: 'medium', speciesOther: '' }];
  renderTreeRows();

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

  // Notes
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
      <select class="crew-tree-row__species" data-field="species">
        <option value="">— species —</option>
        ${SPECIES_OPTIONS.map(o => `<option value="${o.value}" ${t.species === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <input type="text" class="crew-tree-row__other" data-field="speciesOther" placeholder="Other species" value="${escapeAttr(t.speciesOther || '')}" ${t.species === 'other' ? '' : 'style="display:none"'}>
      <input type="number" class="crew-tree-row__count" data-field="count" min="1" step="1" value="${Number(t.count) || 1}">
      <select class="crew-tree-row__size" data-field="size">
        ${SIZE_OPTIONS.map(o => `<option value="${o.value}" ${t.size === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <button type="button" class="crew-tree-row__remove" data-idx="${i}" aria-label="Remove tree">×</button>
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
          // Toggle the "other" text field visibility
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
        notes
      });
    })
    .then(res => {
      if (res.error) throw new Error(res.error);
      showHint(hint, '', 'ok');
      btn.disabled = false;
      // Show the saved view
      document.getElementById('crew-saved-num').textContent = res.quoteNumber || '(saved)';
      document.getElementById('crew-saved-customer').textContent = customer.name + ' · $' + total.toLocaleString('en-US');
      // Update local state so "Edit this quote" goes back to the right lead
      if (state.isManual) {
        state.isManual = false;
        // We need to re-fetch this newly-created lead next time.
      }
      showView('saved');
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
// SAVED VIEW
// =============================================
function wireSavedView() {
  document.getElementById('crew-saved-back').addEventListener('click', () => {
    loadLeads();
    showView('list');
  });
  document.getElementById('crew-saved-edit').addEventListener('click', () => {
    showView('edit');
  });
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
