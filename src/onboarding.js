const TOTAL = 10;
let current = 1;
const answers = {};

const sliderLabels = {
  2: ['Not important — reset every visit', 'Slightly important', 'Somewhat important', 'Quite important', 'Very important — always keep'],
  5: ['Delete all ad cookies', 'Delete most ad cookies', 'Neutral — delete only known trackers', 'Keep personalization cookies', 'Keep all ad cookies'],
  7: ['Always log in fresh', 'Lean toward fresh logins', 'Balance security and convenience', 'Stay logged in usually', 'Stay logged in everywhere'],
  9: ['Flag all Google cookies', 'Flag most Google cookies', 'Flag unusual Google cookies only', 'Trust most Google cookies', 'Whitelist all Google cookies']
};

function updateProgress() {
  const pct = (current / TOTAL) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `Question ${current} of ${TOTAL}`;
}

function getCardAnswer(card) {
  const type = card.dataset.type;
  if (type === 'yn') {
    const sel = card.querySelector('.yn-btn.selected-yes, .yn-btn.selected-no');
    return sel ? sel.dataset.val : null;
  }
  if (type === 'slider') {
    const input = card.querySelector('input[type=range]');
    return input ? input.value : null;
  }
  if (type === 'multi') {
    const sel = card.querySelector('.multi-opt.selected');
    return sel ? sel.dataset.val : null;
  }
  return null;
}

function canProceed() {
  const card = document.querySelector(`.question-card[data-q="${current}"]`);
  if (!card) return true;
  return getCardAnswer(card) !== null;
}

function updateNextBtn() {
  document.getElementById('nav-next').disabled = !canProceed();
}

function showQuestion(n) {
  document.querySelectorAll('.question-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`.question-card[data-q="${n}"]`);
  if (card) card.classList.add('active');

  document.getElementById('hero').style.display = n === 1 ? 'block' : 'none';
  document.getElementById('nav-back').disabled = n === 1;
  document.getElementById('nav-next').textContent = n === TOTAL ? 'Finish →' : 'Next →';
  updateProgress();
  updateNextBtn();
}

function buildSummary() {
  const items = [
    { label: 'Shopping cart memory', val: answers.keepShoppingCarts === 'true' ? 'Enabled' : 'Disabled', on: answers.keepShoppingCarts === 'true' },
    { label: 'Social logins (Google/Facebook)', val: answers.keepSocialLogins === 'true' ? 'Protected' : 'Not used', on: true },
    { label: 'Live chat cookies', val: answers.keepLiveChat === 'true' ? 'Kept' : 'Deleted', on: answers.keepLiveChat === 'true' },
    { label: 'Subscription access cookies', val: answers.keepSubscriptions === 'true' ? 'Kept' : 'Deleted', on: answers.keepSubscriptions === 'true' },
    { label: 'Ad personalization', val: ['Delete all', 'Delete most', 'Neutral', 'Keep most', 'Keep all'][parseInt(answers.adTolerance || 2) - 1], on: parseInt(answers.adTolerance || 2) >= 3 },
    { label: 'Deletion mode', val: { flag: 'Flag only', auto: 'Auto-delete + notify', strict: 'Maximum protection' }[answers.deletionMode] || 'Auto-delete', on: true },
  ];

  const box = document.getElementById('summary-box');
  box.innerHTML = '<div class="summary-title">Your Configuration</div>' +
    items.map(i => `
      <div class="summary-item">
        <span class="summary-key">${i.label}</span>
        <span class="summary-val ${i.on ? 'on' : 'off'}">${i.val}</span>
      </div>`).join('');
}

async function showComplete() {
  document.querySelectorAll('.question-card').forEach(c => c.classList.remove('active'));
  document.getElementById('nav-controls').style.display = 'none';
  document.getElementById('progress-label').style.display = 'none';
  document.querySelector('.progress-bar').style.display = 'none';
  document.getElementById('hero').style.display = 'none';
  document.getElementById('complete-screen').classList.add('active');
  buildSummary();

  // Trigger live scan of current open tabs
  const liveEl = document.getElementById('live-scan-result');
  if (!liveEl) return;

  liveEl.innerHTML = `<div class="live-scanning">scanning your open tabs...</div>`;

  try {
    // Ask background to scan all open tabs and return aggregate counts
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const httpTabs = tabs.filter(t => t.url && t.url.startsWith('http'));

    if (httpTabs.length === 0) {
      liveEl.innerHTML = `<div class="live-result"><div class="live-num live-safe">0</div><div class="live-label">No web tabs open yet — visit any site to see Cookie Monster in action</div></div>`;
      return;
    }

    // Count cookies across all open tabs
    const allCookies = await new Promise(resolve => chrome.cookies.getAll({}, resolve));
    const totalCookies = allCookies.length;
    const uniqueDomains = new Set(allCookies.map(c => c.domain.replace(/^\./, '').split('.').slice(-2).join('.'))).size;

    liveEl.innerHTML = `
      <div class="live-result">
        <div class="live-stat-row">
          <div class="live-stat">
            <div class="live-num">${totalCookies.toLocaleString()}</div>
            <div class="live-label">cookies in your browser</div>
          </div>
          <div class="live-stat">
            <div class="live-num live-domain">${uniqueDomains}</div>
            <div class="live-label">domains they're from</div>
          </div>
          <div class="live-stat">
            <div class="live-num live-tabs">${httpTabs.length}</div>
            <div class="live-label">tabs being watched</div>
          </div>
        </div>
        <div class="live-note">Cookie Monster is now active. Visit any site to see what gets flagged and deleted in real time.</div>
      </div>`;
  } catch (e) {
    liveEl.innerHTML = `<div class="live-note">Cookie Monster is active. Visit any site to see it in action.</div>`;
  }
}

async function saveAndFinish() {
  const config = {
    keepShoppingCarts: answers.keepShoppingCarts === 'true',
    keepLocalization: answers.localizationTolerance ? parseInt(answers.localizationTolerance) >= 3 : true,
    keepSocialLogins: answers.keepSocialLogins === 'true',
    keepDisplayPrefs: answers.keepDisplayPrefs === 'true',
    adTolerance: parseInt(answers.adTolerance || 2),
    keepLiveChat: answers.keepLiveChat === 'true',
    loginPersistence: parseInt(answers.loginPersistence || 3),
    keepSubscriptions: answers.keepSubscriptions === 'true',
    googleTrust: parseInt(answers.googleTrust || 3),
    deletionMode: answers.deletionMode || 'auto',
    onboardingComplete: true,
    configuredAt: Date.now()
  };
  await chrome.storage.local.set({ userConfig: config });
}

// Wire up yn buttons
document.querySelectorAll('.yn-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.question-card');
    card.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('selected-yes', 'selected-no'));
    btn.classList.add(btn.dataset.val === 'true' ? 'selected-yes' : 'selected-no');
    answers[card.dataset.key] = btn.dataset.val;
    updateNextBtn();
  });
});

// Wire up multi buttons
document.querySelectorAll('.multi-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.question-card');
    card.querySelectorAll('.multi-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    answers[card.dataset.key] = btn.dataset.val;
    updateNextBtn();
  });
});

// Wire up sliders
document.querySelectorAll('input[type=range]').forEach(input => {
  const qNum = input.id.split('-')[1];
  const valEl = document.getElementById(`slider-val-${qNum}`);
  const card = input.closest('.question-card');

  const update = () => {
    const v = parseInt(input.value);
    const labels = sliderLabels[qNum];
    if (valEl && labels) valEl.textContent = labels[v - 1];
    answers[card.dataset.key] = input.value;
    // Fill track color
    const pct = ((v - 1) / 4) * 100;
    input.style.background = `linear-gradient(to right, #A0522D ${pct}%, #1C1510 ${pct}%)`;
    updateNextBtn();
  };

  input.addEventListener('input', update);
  // Initialize
  answers[card.dataset.key] = input.value;
  update();
});

// Nav buttons
document.getElementById('nav-next').addEventListener('click', () => {
  const card = document.querySelector(`.question-card[data-q="${current}"]`);
  if (card) {
    const val = getCardAnswer(card);
    if (val !== null) answers[card.dataset.key] = val;
  }
  if (current < TOTAL) {
    current++;
    showQuestion(current);
  } else {
    saveAndFinish().then(showComplete);
  }
});

document.getElementById('nav-back').addEventListener('click', () => {
  if (current > 1) { current--; showQuestion(current); }
});

document.getElementById('start-btn').addEventListener('click', (e) => {
  e.preventDefault();
  window.close();
});

// Init
showQuestion(1);
