let cookieDict = null;
let lookupCache = {};
let tabDomainMap = {};
let tabCookieMap = {};
let tabSnapshots = {};
let debounceTimers = {};
let scanInProgress = {};

// ─── Global accumulator ──────────────────────────────────────────────────────
// Tracks all flagged cookies across all tabs since popup was last opened.
// Key: "name||domain", value: { cookie data + site }
let globalAccumulator = {};

async function saveAccumulator() {
  await chrome.storage.local.set({ global_accumulator: globalAccumulator });
}

async function loadAccumulator() {
  const stored = await chrome.storage.local.get('global_accumulator');
  globalAccumulator = stored.global_accumulator || {};
}

function addToAccumulator(siteName, siteUrl, cookies) {
  for (const c of cookies) {
    const key = `${c.name}||${c.domain}`;
    globalAccumulator[key] = { ...c, site: siteName, siteUrl };
  }
  saveAccumulator();
}

function removeFromAccumulator(keys) {
  for (const k of keys) delete globalAccumulator[k];
  saveAccumulator();
}

function getAccumulatorBySite() {
  const bySite = {};
  for (const [key, cookie] of Object.entries(globalAccumulator)) {
    const site = cookie.site || 'unknown';
    if (!bySite[site]) bySite[site] = { site, siteUrl: cookie.siteUrl, cookies: [] };
    bySite[site].cookies.push({ ...cookie, _key: key });
  }
  return Object.values(bySite).sort((a, b) => b.cookies.length - a.cookies.length);
}

// ─── Dictionary ──────────────────────────────────────────────────────────────

async function loadDictionary() {
  const url = chrome.runtime.getURL('data/cookies.json');
  const res = await fetch(url);
  cookieDict = await res.json();
  cookieDict._trackerSet = new Set(cookieDict.known_tracker_domains);
}

function extractRootDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.replace(/^\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function matchesPattern(name, pattern) {
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1));
  return name === pattern;
}

function lookupCookie(name) {
  if (!cookieDict) return null;
  if (lookupCache[name] !== undefined) return lookupCache[name];
  let result = null;
  for (const [pattern, info] of Object.entries(cookieDict.known)) {
    if (matchesPattern(name, pattern)) { result = info; break; }
  }
  lookupCache[name] = result;
  return result;
}

function isKnownTrackerDomain(domain) {
  if (!cookieDict?._trackerSet) return false;
  return cookieDict._trackerSet.has(extractRootDomain(domain));
}

function hasSuspiciousPattern(name) {
  if (!cookieDict) return null;
  const lower = name.toLowerCase();
  for (const { pattern, reason } of cookieDict.suspicious_patterns) {
    if (lower.includes(pattern)) return reason;
  }
  return null;
}

function classifyCookie(cookie, tabRootDomain) {
  const cookieRoot = extractRootDomain(cookie.domain);
  const isFirstParty = cookieRoot === tabRootDomain || cookie.domain.includes(tabRootDomain);
  if (isFirstParty) return { flag: false, reason: 'first-party', known: null };

  const known = lookupCookie(cookie.name);
  if (known) return { flag: false, reason: 'known-third-party', known };

  if (isKnownTrackerDomain(cookie.domain)) {
    return { flag: true, severity: 'high', reason: 'Known ad tracker domain', known: null };
  }

  const suspiciousReason = hasSuspiciousPattern(cookie.name);
  if (suspiciousReason) {
    return { flag: true, severity: 'medium', reason: `Suspicious pattern: ${suspiciousReason}`, known: null };
  }

  return { flag: true, severity: 'low', reason: 'Unknown third-party cookie', known: null };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

async function deleteCookie(name, domain) {
  const clean = domain.startsWith('.') ? domain.slice(1) : domain;
  await new Promise(r => chrome.cookies.remove({ url: `https://${clean}`, name }, r));
  await new Promise(r => chrome.cookies.remove({ url: `http://${clean}`, name }, r));
  await new Promise(r => chrome.cookies.remove({ url: `https://www.${clean}`, name }, r));
}

// ─── History log ─────────────────────────────────────────────────────────────

async function logDeletedCookies(site, cookies) {
  const stored = await chrome.storage.local.get('deletion_log');
  const log = stored.deletion_log || [];
  log.unshift({
    site,
    timestamp: Date.now(),
    cookies: cookies.map(c => ({ name: c.name, domain: c.domain, severity: c.severity, reason: c.reason }))
  });
  if (log.length > 500) log.splice(500);
  await chrome.storage.local.set({ deletion_log: log });
}

// ─── Notification ────────────────────────────────────────────────────────────

function showDeleteNotification(siteName, autoDeleted, flaggedCount) {
  const lines = [`🛡 Auto-deleted ${autoDeleted} known tracker${autoDeleted > 1 ? 's' : ''}`];
  if (flaggedCount > 0) lines.push(`⚑ ${flaggedCount} more suspicious — open extension to review`);
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: `Cookie Monster — ${siteName}`,
      message: lines.join('\n'),
      priority: 0,
      silent: true
    });
  } catch (e) { /* notifications not permitted, silent fail */ }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

async function snapshotCookies() {
  return new Promise(resolve => {
    chrome.cookies.getAll({}, cookies => {
      resolve(new Set(cookies.map(c => `${c.name}||${c.domain}`)));
    });
  });
}

// ─── webRequest tracker ──────────────────────────────────────────────────────

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!tabDomainMap[details.tabId]) tabDomainMap[details.tabId] = new Set();
    try { tabDomainMap[details.tabId].add(new URL(details.url).hostname); } catch {}
  },
  { urls: ['<all_urls>'] }
);

// ─── Core scan ───────────────────────────────────────────────────────────────

async function scanTabCookies(tabId, url) {
  if (!cookieDict) await loadDictionary();
  if (!url || !url.startsWith('http')) return;
  if (scanInProgress[tabId]) return;

  scanInProgress[tabId] = true;
  try {
    const urlObj = new URL(url);
    const tabRootDomain = extractRootDomain(urlObj.hostname);
    const siteName = urlObj.hostname.replace(/^www\./, '');
    const contactedDomains = tabDomainMap[tabId] || new Set();

    const domainList = Array.from(contactedDomains);
    const cookiePromises = domainList.map(domain =>
      new Promise(resolve => chrome.cookies.getAll({ domain }, c => resolve(c || [])))
    );
    cookiePromises.push(new Promise(resolve =>
      chrome.cookies.getAll({ domain: urlObj.hostname }, c => resolve(c || []))
    ));

    const cookieArrays = await Promise.all(cookiePromises);
    const seen = new Set();
    const allCookies = [];
    for (const arr of cookieArrays) {
      for (const c of arr) {
        const key = `${c.name}||${c.domain}`;
        if (!seen.has(key)) { seen.add(key); allCookies.push(c); }
      }
    }

    const results = allCookies.map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      secure: cookie.secure,
      cookieRoot: extractRootDomain(cookie.domain),
      tabRootDomain,
      ...classifyCookie(cookie, tabRootDomain),
      timestamp: Date.now()
    }));

    const allFlagged = results.filter(r => r.flag);
    const autoDelete = allFlagged.filter(c => c.severity === 'high');
    const remaining = allFlagged.filter(c => c.severity !== 'high');

    if (autoDelete.length > 0) {
      await Promise.all(autoDelete.map(c => deleteCookie(c.name, c.domain)));
      await logDeletedCookies(siteName, autoDelete);
      showDeleteNotification(siteName, autoDelete.length, remaining.length);
    }

    // Add remaining flagged cookies to global accumulator
    if (remaining.length > 0) {
      addToAccumulator(siteName, url, remaining);
    }
    // Also track auto-deleted in accumulator with a flag so UI can show them
    if (autoDelete.length > 0) {
      const tagged = autoDelete.map(c => ({ ...c, wasAutoDeleted: true }));
      addToAccumulator(siteName, url, tagged);
    }

    const safe = results.filter(r => !r.flag);

    // Add safe cookies to accumulator too so Safe tab works globally
    if (safe.length > 0) {
      const taggedSafe = safe.map(c => ({ ...c, isSafe: true }));
      addToAccumulator(siteName, url, taggedSafe);
    }

    tabCookieMap[tabId] = {
      url,
      tabRootDomain,
      flagged: remaining,
      autoDeleted: autoDelete,
      safe,
      total: results.length,
      scannedAt: Date.now()
    };

    // Update global badge (total pending across all tabs)
    updateGlobalBadge();
    chrome.storage.local.set({ [`tab_${tabId}`]: tabCookieMap[tabId] });

    chrome.action.setTitle({
      tabId,
      title: autoDelete.length > 0
        ? `Cookie Monster — ${autoDelete.length} deleted, ${remaining.length} flagged for review`
        : remaining.length > 0
          ? `Cookie Monster — ${remaining.length} suspicious cookie${remaining.length > 1 ? 's' : ''} to review`
          : 'Cookie Monster — All cookies look clean'
    });

    return tabCookieMap[tabId];
  } finally {
    scanInProgress[tabId] = false;
  }
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function updateGlobalBadge() {
  // Badge shows total pending flagged across ALL tabs (not auto-deleted)
  const pendingCount = Object.values(globalAccumulator)
    .filter(c => !c.wasAutoDeleted).length;

  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (pendingCount === 0) {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
      } else {
        chrome.action.setBadgeText({ text: String(pendingCount), tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#A0622A', tabId: tab.id });
      }
    }
  });
}

function debouncedScan(tabId, url, delay = 1500) {
  if (debounceTimers[tabId]) clearTimeout(debounceTimers[tabId]);
  debounceTimers[tabId] = setTimeout(() => {
    delete debounceTimers[tabId];
    scanTabCookies(tabId, url);
  }, delay);
}

async function restoreBadges() {
  await loadAccumulator();
  updateGlobalBadge();
}

// ─── Tab lifecycle ────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    tabDomainMap[tabId] = new Set();
    delete tabCookieMap[tabId];
    chrome.storage.local.remove(`tab_${tabId}`);
  }
  if (changeInfo.status === 'complete' && tab.url) {
    setTimeout(() => scanTabCookies(tabId, tab.url), 3000);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return;
  let data = tabCookieMap[tabId];
  if (!data) {
    const stored = await chrome.storage.local.get(`tab_${tabId}`);
    data = stored[`tab_${tabId}`];
    if (data) tabCookieMap[tabId] = data;
  }
  const isFresh = data && (Date.now() - data.scannedAt < 30000);
  if (!isFresh) scanTabCookies(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabDomainMap[tabId];
  delete tabCookieMap[tabId];
  delete tabSnapshots[tabId];
  delete debounceTimers[tabId];
  delete scanInProgress[tabId];
  chrome.storage.local.remove(`tab_${tabId}`);
});

chrome.cookies.onChanged.addListener(async ({ removed }) => {
  if (removed) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id && tabs[0]?.url) debouncedScan(tabs[0].id, tabs[0].url, 1500);
});

// ─── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'GET_TAB_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ error: 'no tab' });
      let data = tabCookieMap[tab.id];
      if (!data) {
        const stored = await chrome.storage.local.get(`tab_${tab.id}`);
        data = stored[`tab_${tab.id}`];
      }
      if (!data) data = await scanTabCookies(tab.id, tab.url);
      sendResponse({ data, tabUrl: tab.url });
    });
    return true;
  }

  if (message.type === 'GET_GLOBAL_DATA') {
    const bySite = getAccumulatorBySite();
    const totalFlagged = Object.values(globalAccumulator).filter(c => !c.wasAutoDeleted && !c.isSafe).length;
    const totalDeleted = Object.values(globalAccumulator).filter(c => c.wasAutoDeleted).length;
    const totalSafe = Object.values(globalAccumulator).filter(c => c.isSafe).length;
    sendResponse({ bySite, totalFlagged, totalDeleted, totalSafe });
    return true;
  }

  if (message.type === 'GET_DELETION_LOG') {
    chrome.storage.local.get('deletion_log', (result) => {
      sendResponse({ log: result.deletion_log || [] });
    });
    return true;
  }

  if (message.type === 'DELETE_COOKIE') {
    const { name, domain } = message.cookie;
    deleteCookie(name, domain).then(() => {
      // Remove from accumulator
      removeFromAccumulator([`${name}||${domain}`]);
      updateGlobalBadge();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'DELETE_ALL_FLAGGED') {
    // Delete flagged on current tab only
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      const data = tabCookieMap[tab?.id];
      if (!data) return sendResponse({ success: false });
      await Promise.all(data.flagged.map(c => deleteCookie(c.name, c.domain)));
      const siteName = new URL(data.url).hostname.replace(/^www\./, '');
      await logDeletedCookies(siteName, data.flagged);
      // Remove from accumulator
      const keys = data.flagged.map(c => `${c.name}||${c.domain}`);
      removeFromAccumulator(keys);
      updateGlobalBadge();
      setTimeout(async () => {
        await scanTabCookies(tab.id, tab.url);
        sendResponse({ success: true });
      }, 500);
    });
    return true;
  }

  if (message.type === 'DELETE_ALL_GLOBAL') {
    // Delete ALL flagged cookies across all sites in the accumulator
    (async () => {
      const pending = Object.values(globalAccumulator).filter(c => !c.wasAutoDeleted && !c.isSafe);
      await Promise.all(pending.map(c => deleteCookie(c.name, c.domain)));

      // Log by site
      const bySite = {};
      for (const c of pending) {
        if (!bySite[c.site]) bySite[c.site] = [];
        bySite[c.site].push(c);
      }
      for (const [site, cookies] of Object.entries(bySite)) {
        await logDeletedCookies(site, cookies);
      }

      // Clear entire accumulator
      globalAccumulator = {};
      await saveAccumulator();
      updateGlobalBadge();

      // Rescan all open tabs
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url?.startsWith('http')) {
          delete tabCookieMap[tab.id];
          chrome.storage.local.remove(`tab_${tab.id}`);
        }
      }

      sendResponse({ success: true, deleted: pending.length });
    })();
    return true;
  }

  if (message.type === 'DELETE_SITE_FLAGGED') {
    // Delete all flagged cookies for a specific site
    (async () => {
      const { site } = message;
      const toDelete = Object.entries(globalAccumulator)
        .filter(([, c]) => c.site === site && !c.wasAutoDeleted && !c.isSafe)
        .map(([key, c]) => ({ key, ...c }));

      await Promise.all(toDelete.map(c => deleteCookie(c.name, c.domain)));
      await logDeletedCookies(site, toDelete);
      removeFromAccumulator(toDelete.map(c => c.key));
      updateGlobalBadge();

      sendResponse({ success: true, deleted: toDelete.length });
    })();
    return true;
  }

  if (message.type === 'CLEAR_ACCUMULATOR') {
    globalAccumulator = {};
    saveAccumulator();
    updateGlobalBadge();
    sendResponse({ success: true });
    return true;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

loadDictionary();
restoreBadges();

// ─── Onboarding ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const stored = await chrome.storage.local.get('userConfig');
    if (!stored.userConfig?.onboardingComplete) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding.html') });
    }
  }
});
