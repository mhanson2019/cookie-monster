const sliderLabels = {
  login:  ['Always fresh','Lean fresh','Balanced','Stay logged in','Always stay logged in'],
  locale: ['Delete all','Delete most','Neutral','Keep most','Always keep'],
  ads:    ['Delete all','Delete most','Neutral','Keep most','Keep all'],
  google: ['Flag all','Flag most','Flag unusual only','Trust most','Whitelist all']
};

function initSlider(id, labelKey, val) {
  const input = document.getElementById(`slider-${id}`);
  const valEl = document.getElementById(`slider-${id}-val`);
  if (!input) return;
  input.value = val;
  const update = () => {
    const v = parseInt(input.value);
    const pct = ((v-1)/4)*100;
    input.style.background = `linear-gradient(to right,#A0522D ${pct}%,#1C1510 ${pct}%)`;
    if (valEl) valEl.textContent = sliderLabels[labelKey][v-1];
    markDirty();
  };
  input.addEventListener('input', update);
  update();
}

let dirty = false;
function markDirty() {
  dirty = true;
  document.getElementById('save-hint').textContent = 'Unsaved changes';
  document.getElementById('save-btn').classList.remove('saved');
}

async function loadStats() {
  const stored = await chrome.storage.local.get('deletion_log');
  const log = stored.deletion_log || [];
  const weekAgo = Date.now() - 7*24*60*60*1000;
  const weekEntries = log.filter(e => e.timestamp > weekAgo);
  const weekDeleted = weekEntries.reduce((s,e) => s + e.cookies.length, 0);
  const totalDeleted = log.reduce((s,e) => s + e.cookies.length, 0);
  const sites = new Set(weekEntries.map(e => e.site)).size;

  document.getElementById('stat-week-deleted').textContent = weekDeleted;
  document.getElementById('stat-total-deleted').textContent = totalDeleted;
  document.getElementById('stat-sites').textContent = sites;
  document.getElementById('stat-week-sub').textContent = `from ${weekEntries.length} site visit${weekEntries.length !== 1 ? 's' : ''}`;
}

async function loadConfig() {
  const stored = await chrome.storage.local.get('userConfig');
  const c = stored.userConfig || {};

  // Toggles
  document.getElementById('toggle-cart').checked = !!c.keepShoppingCarts;
  document.getElementById('toggle-social').checked = !!c.keepSocialLogins;
  document.getElementById('toggle-subs').checked = !!c.keepSubscriptions;
  document.getElementById('toggle-chat').checked = !!c.keepLiveChat;
  document.getElementById('toggle-display').checked = !!c.keepDisplayPrefs;
  document.getElementById('toggle-locale').checked = c.keepLocalization !== false;

  // Sliders
  initSlider('login',  'login',  c.loginPersistence || 3);
  initSlider('ads',    'ads',    c.adTolerance || 2);
  initSlider('google', 'google', c.googleTrust || 3);

  // Mode
  const mode = c.deletionMode || 'auto';
  document.querySelectorAll('.mode-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.val === mode);
  });

  // Wire toggles
  document.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', markDirty));

  dirty = false;
  document.getElementById('save-hint').textContent = 'All changes saved';
}

// Mode selector
document.querySelectorAll('.mode-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.mode-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    markDirty();
  });
});

// Save
document.getElementById('save-btn').addEventListener('click', async () => {
  const config = {
    keepShoppingCarts:  document.getElementById('toggle-cart').checked,
    keepSocialLogins:   document.getElementById('toggle-social').checked,
    keepSubscriptions:  document.getElementById('toggle-subs').checked,
    keepLiveChat:       document.getElementById('toggle-chat').checked,
    keepDisplayPrefs:   document.getElementById('toggle-display').checked,
    keepLocalization:   document.getElementById('toggle-locale').checked,
    loginPersistence:   parseInt(document.getElementById('slider-login').value),
    adTolerance:        parseInt(document.getElementById('slider-ads').value),
    googleTrust:        parseInt(document.getElementById('slider-google').value),
    deletionMode:       document.querySelector('.mode-opt.selected')?.dataset.val || 'auto',
    onboardingComplete: true,
    configuredAt:       Date.now()
  };

  await chrome.storage.local.set({ userConfig: config });
  dirty = false;
  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saved ✓';
  btn.classList.add('saved');
  document.getElementById('save-hint').textContent = 'All changes saved';
  setTimeout(() => { btn.textContent = 'Save Settings'; }, 2000);
});

loadConfig();
loadStats();
