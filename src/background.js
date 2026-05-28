importScripts('../data/cookies.json');

let cookieDict = null;
let tabCookieMap = {};

async function loadDictionary() {
  const url = chrome.runtime.getURL('data/cookies.json');
  const res = await fetch(url);
  cookieDict = await res.json();
}

function extractRootDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.replace(/^\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function matchesPattern(name, pattern) {
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith('*')) {
    return name.endsWith(pattern.slice(1));
  }
  return name === pattern;
}

function lookupCookie(name) {
  if (!cookieDict) return null;
  for (const [pattern, info] of Object.entries(cookieDict.known)) {
    if (matchesPattern(name, pattern)) {
      return info;
    }
  }
  return null;
}

function isKnownTrackerDomain(domain) {
  if (!cookieDict) return false;
  const root = extractRootDomain(domain);
  return cookieDict.known_tracker_domains.includes(root);
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
  const known = lookupCookie(cookie.name);
  const isTrackerDomain = isKnownTrackerDomain(cookie.domain);
  const suspiciousReason = hasSuspiciousPattern(cookie.name);
  const isFirstParty = cookieRoot === tabRootDomain || cookie.domain.includes(tabRootDomain);

  if (isFirstParty) {
    return { flag: false, reason: 'first-party', known };
  }

  if (known) {
    return { flag: false, reason: 'known-third-party', known };
  }

  if (isTrackerDomain) {
    return {
      flag: true,
      severity: 'high',
      reason: 'Known ad tracker domain',
      known: null
    };
  }

  if (suspiciousReason) {
    return {
      flag: true,
      severity: 'medium',
      reason: `Suspicious name pattern: ${suspiciousReason}`,
      known: null
    };
  }

  return {
    flag: true,
    severity: 'low',
    reason: 'Unknown third-party cookie',
    known: null
  };
}

async function scanTabCookies(tabId, url) {
  if (!cookieDict) await loadDictionary();
  if (!url || !url.startsWith('http')) return;

  const urlObj = new URL(url);
  const tabRootDomain = extractRootDomain(urlObj.hostname);

  const allCookies = await chrome.cookies.getAll({ url });

  const results = allCookies.map(cookie => {
    const classification = classifyCookie(cookie, tabRootDomain);
    return {
      name: cookie.name,
      domain: cookie.domain,
      cookieRoot: extractRootDomain(cookie.domain),
      tabRootDomain,
      ...classification,
      timestamp: Date.now()
    };
  });

  const flagged = results.filter(r => r.flag);
  const safe = results.filter(r => !r.flag);

  tabCookieMap[tabId] = {
    url,
    tabRootDomain,
    flagged,
    safe,
    total: results.length,
    scannedAt: Date.now()
  };

  updateBadge(tabId, flagged.length);
  return tabCookieMap[tabId];
}

function updateBadge(tabId, count) {
  if (count === 0) {
    chrome.action.setBadgeText({ text: '', tabId });
  } else {
    chrome.action.setBadgeText({ text: String(count), tabId });
    chrome.action.setBadgeBackgroundColor({ color: count > 5 ? '#E53935' : '#FF6B35', tabId });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    scanTabCookies(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) scanTabCookies(tabId, tab.url);
});

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id && tabs[0]?.url) {
    scanTabCookies(tabs[0].id, tabs[0].url);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse({ error: 'no tab' });

      let data = tabCookieMap[tab.id];
      if (!data) {
        data = await scanTabCookies(tab.id, tab.url);
      }
      sendResponse({ data, tabUrl: tab.url });
    });
    return true;
  }

  if (message.type === 'DELETE_COOKIE') {
    const { name, domain, secure } = message.cookie;
    const protocol = secure ? 'https' : 'http';
    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
    chrome.cookies.remove({
      url: `${protocol}://${cleanDomain}`,
      name
    }, () => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'DELETE_ALL_FLAGGED') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      const data = tabCookieMap[tab?.id];
      if (!data) return sendResponse({ success: false });

      for (const cookie of data.flagged) {
        const protocol = cookie.secure ? 'https' : 'http';
        const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        await chrome.cookies.remove({ url: `${protocol}://${cleanDomain}`, name: cookie.name });
      }
      await scanTabCookies(tab.id, tab.url);
      sendResponse({ success: true });
    });
    return true;
  }
});

loadDictionary();
