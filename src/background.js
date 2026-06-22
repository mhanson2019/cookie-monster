import { classifyCookie, loadTrackerDB } from './classifier/index.js';

// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  keepShoppingCarts: true,
  keepSocialLogins:  true,
  keepDisplayPrefs:  true,
  keepLiveChat:      false,
  keepSubscriptions: true,
  keepLocalization:  true,
  adTolerance:       2,
  loginPersistence:  3,
  googleTrust:       3,
  deletionMode:      'auto',
  onboardingComplete:false,
};

const DELETION_LOG_CAP = 500;

let trackerDB = null;
let userConfig = { ...DEFAULT_CONFIG };
let tabCookieMap = {};
// Cross-site audit accumulator. Keyed by `${name}|${cookieRoot}`.
// IMPORTANT: never stores cookie.value — only metadata.
let globalAccumulator = {};
let initPromise = null;

// Expose for the service-worker console test harness. The classifier never
// changes, so it can be exposed synchronously; trackerDB/userConfig are set
// once async init completes.
self.classifyCookie = classifyCookie;
self.trackerDB = null;
self.userConfig = userConfig;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  trackerDB = await loadTrackerDB();
  self.trackerDB = trackerDB;

  const stored = await chrome.storage.local.get(['userConfig', 'global_accumulator']);
  if (stored.userConfig) {
    userConfig = { ...DEFAULT_CONFIG, ...stored.userConfig };
  }
  self.userConfig = userConfig;
  globalAccumulator = stored.global_accumulator || {};

  updateGlobalBadge();
  return trackerDB;
}

function ensureReady() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRootDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.replace(/^\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/**
 * Strips a chrome.cookies.Cookie down to privacy-safe metadata.
 * Crucially, `value` is NEVER copied.
 */
function toMeta(cookie, tabRootDomain, classification) {
  return {
    name:          cookie.name,
    domain:        cookie.domain,
    cookieRoot:    extractRootDomain(cookie.domain),
    tabRootDomain,
    flag:          classification.flag,
    autoDelete:    classification.autoDelete,
    reason:        classification.reason,
    purpose:       classification.purpose,
    scope:         classification.scope,
    persistence:   classification.persistence,
    severity:      classification.severity,
    score:         classification.score,
    known:         classification.known,
    timestamp:     Date.now(),
  };
}

function accumulate(meta) {
  const key = `${meta.name}|${meta.cookieRoot}`;
  const existing = globalAccumulator[key];
  if (existing) {
    existing.lastSeen  = Date.now();
    existing.flag      = meta.flag;
    existing.purpose   = meta.purpose;
    existing.scope     = meta.scope;
    existing.severity  = meta.severity;
    existing.score     = meta.score;
    existing.reason    = meta.reason;
    if (!existing.sites.includes(meta.tabRootDomain)) {
      existing.sites.push(meta.tabRootDomain);
    }
  } else {
    // NOTE: no `value` field — metadata only.
    globalAccumulator[key] = {
      name:       meta.name,
      domain:     meta.domain,
      cookieRoot: meta.cookieRoot,
      flag:       meta.flag,
      purpose:    meta.purpose,
      scope:      meta.scope,
      severity:   meta.severity,
      score:      meta.score,
      reason:     meta.reason,
      firstSeen:  Date.now(),
      lastSeen:   Date.now(),
      sites:      [meta.tabRootDomain],
    };
  }
}

function updateGlobalBadge() {
  const count = Object.values(globalAccumulator).filter(c => c.flag).length;
  if (count === 0) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: count > 5 ? '#E53935' : '#FF6B35' });
  }
}

async function logDeletion(site, cookies) {
  if (!cookies.length) return;
  const stored = await chrome.storage.local.get('deletion_log');
  const log = stored.deletion_log || [];
  // `cookies` entries are privacy-safe metadata — no value field.
  log.push({ timestamp: Date.now(), site, cookies });
  const trimmed = log.length > DELETION_LOG_CAP ? log.slice(-DELETION_LOG_CAP) : log;
  await chrome.storage.local.set({ deletion_log: trimmed });
}

async function removeCookie(cookie) {
  const protocol = cookie.secure ? 'https' : 'http';
  const cleanDomain = cookie.domain.replace(/^\./, '');
  const path = cookie.path || '/';
  await chrome.cookies.remove({ url: `${protocol}://${cleanDomain}${path}`, name: cookie.name });
}

// ── Scan ──────────────────────────────────────────────────────────────────────

async function scanTabCookies(tabId, url) {
  await ensureReady();
  if (!url || !url.startsWith('http')) return;

  const tabRootDomain = extractRootDomain(new URL(url).hostname);
  const allCookies = await chrome.cookies.getAll({ url });

  const flagged = [];
  const safe = [];
  const deleted = [];

  for (const cookie of allCookies) {
    const classification = classifyCookie(cookie, tabRootDomain, userConfig, trackerDB);
    const meta = toMeta(cookie, tabRootDomain, classification);

    accumulate(meta);

    // Auto-deletion. makeDecision() already forces autoDelete=false in 'flag'
    // mode; the explicit guard is belt-and-suspenders so flag mode can never
    // delete anything.
    if (classification.autoDelete && userConfig.deletionMode !== 'flag') {
      await removeCookie(cookie);
      deleted.push({
        name:    meta.name,
        domain:  meta.domain,
        purpose: meta.purpose,
        reason:  meta.reason,
        score:   meta.score,
      });
      // Don't surface auto-deleted cookies in the live tab view.
      continue;
    }

    if (meta.flag) flagged.push({ ...meta, secure: cookie.secure });
    else safe.push({ ...meta, secure: cookie.secure });
  }

  tabCookieMap[tabId] = {
    url,
    tabRootDomain,
    flagged,
    safe,
    total: flagged.length + safe.length,
    scannedAt: Date.now(),
  };

  await logDeletion(tabRootDomain, deleted);
  await chrome.storage.local.set({ global_accumulator: globalAccumulator });
  updateGlobalBadge();

  return tabCookieMap[tabId];
}

// ── Listeners ─────────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    scanTabCookies(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) scanTabCookies(tabId, tab.url);
});

chrome.cookies.onChanged.addListener(async ({ removed }) => {
  if (removed) return; // ignore removals (incl. our own auto-deletions) to avoid loops
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id && tabs[0]?.url) {
    scanTabCookies(tabs[0].id, tabs[0].url);
  }
});

// Keep in-memory config in sync with settings/onboarding saves (no reload needed).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.userConfig) {
    userConfig = { ...DEFAULT_CONFIG, ...changes.userConfig.newValue };
    self.userConfig = userConfig;
  }
  if (changes.global_accumulator && changes.global_accumulator.newValue) {
    globalAccumulator = changes.global_accumulator.newValue;
    updateGlobalBadge();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ error: 'no tab' });

      let data = tabCookieMap[tab.id];
      if (!data) data = await scanTabCookies(tab.id, tab.url);
      sendResponse({ data, tabUrl: tab.url });
    });
    return true;
  }

  if (message.type === 'DELETE_COOKIE') {
    (async () => {
      const { name, domain, secure } = message.cookie;
      await removeCookie({ name, domain, secure });
      await logDeletion(extractRootDomain(domain), [{ name, domain }]);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'DELETE_ALL_FLAGGED') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      const data = tabCookieMap[tab?.id];
      if (!data) return sendResponse({ success: false });

      const removedMeta = [];
      for (const cookie of data.flagged) {
        await removeCookie(cookie);
        removedMeta.push({ name: cookie.name, domain: cookie.domain, reason: cookie.reason });
      }
      await logDeletion(data.tabRootDomain, removedMeta);
      await scanTabCookies(tab.id, tab.url);
      sendResponse({ success: true });
    });
    return true;
  }
});

ensureReady();
