/* =============================================
   Pine Point Tree Service — Wood Products Sign-up
   Free wood chips + log-length firewood lead form.
   Posts to the same Apps Script endpoints as the
   estimate flow with formType: 'wood_signup'.
   ============================================= */

// Lead capture endpoints — kept in sync with js/estimate.js.
const APPS_SCRIPT_URL_FITFO  = 'https://script.google.com/macros/s/AKfycbz68dVyIGyruTPSofHei6UqcbkBuDZKhGybFLFjcowc2uCSIkDol4NWOJ0FOZdqlxOXpQ/exec';
const APPS_SCRIPT_URL_CLIENT = 'https://script.google.com/macros/s/AKfycby5Ss1I9EUZP2e0ZuGGkP48JPDYIWjllVY7BadNjRpqiK2JHUyEDgzc_e5-VaVzosi6QQ/exec';

const woodState = {
  productType: null,   // 'chips' | 'logs' | 'both'
  woodMix:     null,   // 'mixed' | 'hardwood_only' | null
};

document.addEventListener('DOMContentLoaded', () => {
  attachPhoneFormatter(document.getElementById('wood-phone'));
});

function onProductSelect(btn) {
  const value = btn.dataset.value;
  woodState.productType = value;
  btn.closest('.estimate-options').querySelectorAll('.estimate-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  const mixGroup = document.getElementById('woodMixGroup');
  if (value === 'logs' || value === 'both') {
    mixGroup.style.display = '';
  } else {
    mixGroup.style.display = 'none';
    woodState.woodMix = null;
    mixGroup.querySelectorAll('.estimate-option').forEach(b => b.classList.remove('selected'));
  }
  // Clear any product error
  const err = btn.closest('.form-group').querySelector('.field-error');
  if (err) err.textContent = '';
}

function onMixSelect(btn) {
  woodState.woodMix = btn.dataset.value;
  btn.closest('.estimate-options').querySelectorAll('.estimate-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const err = btn.closest('.form-group').querySelector('.field-error');
  if (err) err.textContent = '';
}

// --- Validation helpers (mirrors js/estimate.js) ---
function isValidPhone(s) {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  return true;
}
function isValidEmail(s) {
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isValidZip(s) {
  return /^\d{5}(-\d{4})?$/.test(String(s || '').trim());
}
function formatPhoneAsTyped(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return '(' + digits;
  if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
  if (digits.length <= 10) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  return '+' + digits.slice(0, 1) + ' (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
}
function attachPhoneFormatter(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    input.value = formatPhoneAsTyped(input.value);
    if (isValidPhone(input.value)) clearFieldError(input);
  });
}
function showFieldError(input, message) {
  if (!input) return;
  let err = input.parentElement.querySelector('.field-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'field-error';
    input.parentElement.appendChild(err);
  }
  err.textContent = message;
  input.classList.add('input--error');
  input.setCustomValidity(message);
  input.focus();
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearFieldError(input) {
  if (!input) return;
  const err = input.parentElement.querySelector('.field-error');
  if (err) err.textContent = '';
  input.classList.remove('input--error');
  input.setCustomValidity('');
}
function showGroupError(groupEl, message) {
  let err = groupEl.querySelector('.field-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'field-error';
    groupEl.appendChild(err);
  }
  err.textContent = message;
  groupEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitWood(e) {
  e.preventDefault();

  // Validate product selection
  if (!woodState.productType) {
    const productGroup = document.querySelector('[data-key="productType"]')?.closest('.form-group');
    if (productGroup) showGroupError(productGroup, 'Pick at least one product so we know what to set aside for you.');
    return;
  }

  // Validate wood mix when relevant
  if ((woodState.productType === 'logs' || woodState.productType === 'both') && !woodState.woodMix) {
    const mixGroup = document.getElementById('woodMixGroup');
    if (mixGroup) showGroupError(mixGroup, 'Pick hardwood-mix or hardwood-only for the log option.');
    return;
  }

  const nameInput  = document.getElementById('wood-name');
  const phoneInput = document.getElementById('wood-phone');
  const emailInput = document.getElementById('wood-email');
  const zipInput   = document.getElementById('wood-zip');
  const notesInput = document.getElementById('wood-notes');

  if (!isValidPhone(phoneInput.value)) {
    showFieldError(phoneInput, 'Enter a 10-digit phone number we can text or call.');
    return;
  }
  clearFieldError(phoneInput);

  if (!isValidEmail(emailInput.value)) {
    showFieldError(emailInput, "That email doesn't look right. Double-check the @ and the domain, or leave it blank.");
    return;
  }
  clearFieldError(emailInput);

  if (!isValidZip(zipInput.value)) {
    showFieldError(zipInput, 'Enter a 5-digit ZIP code.');
    return;
  }
  clearFieldError(zipInput);

  const payload = {
    formType:    'wood_signup',
    productType: woodState.productType,
    woodMix:     woodState.woodMix,
    contact: {
      name:  nameInput.value,
      phone: phoneInput.value,
      email: emailInput.value,
      zip:   zipInput.value.trim(),
    },
    notes: notesInput.value,
    page:  location.href,
  };

  postLead(payload);

  // Show confirmation
  document.querySelectorAll('.estimate-step').forEach(s => s.classList.remove('active'));
  document.querySelector('[data-step="wood-confirm"]').classList.add('active');
  window.scrollTo({ top: 0 });
}

// Fire-and-forget POST to both Apps Script endpoints (FITFO + client).
function postLead(payload) {
  const body = JSON.stringify(payload);
  const opts = { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body };
  if (APPS_SCRIPT_URL_CLIENT) {
    fetch(APPS_SCRIPT_URL_CLIENT, opts).catch(err => console.warn('[wood] client post failed', err));
  }
  if (APPS_SCRIPT_URL_FITFO) {
    fetch(APPS_SCRIPT_URL_FITFO, opts).catch(err => console.warn('[wood] fitfo post failed', err));
  }
}
