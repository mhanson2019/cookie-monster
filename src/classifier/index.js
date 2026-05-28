import { getPersistenceBucket } from './axes/persistence.js';
import { getScope } from './axes/scope.js';
import { getPurpose } from './axes/purpose.js';
import { getOwnerType } from './axes/owner.js';
import { computeScore, makeDecision } from './score.js';
import { PERSISTENCE_EMOJI } from './constants.js';

let trackerDB = null;

/**
 * Loads the tracker database once.
 */
export async function loadTrackerDB() {
  if (trackerDB) return trackerDB;
  const url = chrome.runtime.getURL('data/tracker_db.json');
  const res = await fetch(url);
  trackerDB = await res.json();
  // Build fast Set for domain lookups
  trackerDB._domainSet = new Set(Object.keys(trackerDB.domains || {}));
  return trackerDB;
}

function extractRootDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.replace(/^\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/**
 * Main classify function.
 * 
 * @param {chrome.cookies.Cookie} cookie
 * @param {string} tabRootDomain - e.g. "cnn.com"
 * @param {object} config - userConfig from storage
 * @param {object} db - tracker DB (pass result of loadTrackerDB())
 * @returns {object} classification result
 */
export function classifyCookie(cookie, tabRootDomain, config, db) {
  const cookieDomain = cookie.domain.replace(/^\./, '');
  const cookieRoot   = extractRootDomain(cookieDomain);

  // ── Scope axis ──────────────────────────────────────────────────────────────
  const isKnownTracker = db?._domainSet?.has(cookieRoot) ?? false;
  const scope = getScope(cookie.domain, tabRootDomain, isKnownTracker);

  // First-party: always safe, skip full scoring
  if (scope === 'first-party') {
    return {
      flag: false,
      autoDelete: false,
      reason: 'First-party cookie',
      purpose: 'functional',
      scope,
      persistence: getPersistenceBucket(cookie),
      ownerType: 'site-itself',
      ownerName: tabRootDomain,
      score: 0,
      severity: 'safe',
      known: null,
    };
  }

  // ── Config-based whitelist ──────────────────────────────────────────────────
  const whitelist = checkConfigWhitelist(cookie, cookieRoot, config);
  if (whitelist) {
    return {
      flag: false,
      autoDelete: false,
      reason: whitelist,
      purpose: 'functional',
      scope,
      persistence: getPersistenceBucket(cookie),
      ownerType: 'known-vendor',
      ownerName: null,
      score: 0,
      severity: 'safe',
      known: null,
    };
  }

  // ── Tracker DB lookup ───────────────────────────────────────────────────────
  const dbEntry = db?.domains?.[cookieRoot] || null;
  const ownerName = dbEntry?.o || null;
  const ownerTypeCode = dbEntry?.t || null;
  const trackerCategory = dbEntry?.c || null;

  // ── Four axes ───────────────────────────────────────────────────────────────
  const persistence  = getPersistenceBucket(cookie);
  const { purpose, confidence } = getPurpose(cookie.name, trackerCategory);
  const ownerType = getOwnerType(ownerName, ownerTypeCode);

  // ── Score ───────────────────────────────────────────────────────────────────
  const score = computeScore(purpose, scope, persistence, ownerType);
  const { flag, autoDelete, severity } = makeDecision(score, purpose, ownerName, config || {});

  // ── Reason string ───────────────────────────────────────────────────────────
  let reason;
  if (scope === 'third-party-tracker') {
    reason = ownerName
      ? `${ownerName} tracker (${purpose})`
      : `Known tracker domain (${purpose})`;
  } else if (purpose === 'unknown') {
    reason = 'Unknown third-party cookie';
  } else {
    reason = `Third-party ${purpose} cookie`;
  }

  return {
    flag,
    autoDelete,
    reason,
    purpose,
    scope,
    persistence,
    persistenceEmoji: PERSISTENCE_EMOJI[persistence] || '',
    ownerType,
    ownerName,
    score,
    severity,
    known: dbEntry ? { owner: ownerName, category: purpose } : null,
  };
}

// ── Config whitelist ──────────────────────────────────────────────────────────

const SOCIAL_LOGIN_DOMAINS = new Set([
  'accounts.google.com', 'google.com', 'facebook.com', 'instagram.com',
  'appleid.apple.com', 'login.microsoftonline.com', 'github.com',
  'twitter.com', 'x.com', 'linkedin.com'
]);

const LIVE_CHAT_DOMAINS = new Set([
  'intercom.io', 'intercomassets.com', 'widget.intercom.io',
  'zendesk.com', 'zdassets.com', 'zopim.com', 'drift.com', 'driftt.com',
  'crisp.chat', 'crisp.website', 'tawk.to', 'freshchat.com',
  'livechatinc.com', 'olark.com', 'tidio.com'
]);

const SUBSCRIPTION_DOMAINS = new Set([
  'piano.io', 'tinypass.com', 'laterpay.net', 'leaky.news'
]);

const SHOPPING_DOMAINS = new Set([
  'shopify.com', 'shopifycdn.com', 'woocommerce.com', 'squarespace.com'
]);

const LIVE_CHAT_PATTERNS    = ['intercom', 'drift', 'crisp', 'tawk', 'zopim', 'livechat', 'tidio'];
const SUBSCRIPTION_PATTERNS = ['piano', 'tinypass', 'laterpay', 'subscriber', 'paywall', 'member'];
const SHOPPING_PATTERNS     = ['cart', 'basket', 'checkout', 'shopify', 'woocommerce'];
const DISPLAY_PATTERNS      = ['theme', 'darkmode', 'dark_mode', 'fontsize', 'accessibility', 'contrast'];
const LOCALIZATION_PATTERNS = ['locale', 'lang', 'language', 'currency', 'region', 'country', 'timezone', 'tz'];
const SOCIAL_NAMES          = new Set(['SID','HSID','SSID','APISID','SAPISID','NID','c_user','xs','fr','datr','sb']);

function checkConfigWhitelist(cookie, cookieRoot, config) {
  if (!config) return null;
  const name = cookie.name.toLowerCase();

  if (config.keepSocialLogins) {
    if (SOCIAL_LOGIN_DOMAINS.has(cookieRoot)) return 'Social login domain';
    if (SOCIAL_NAMES.has(cookie.name))        return 'Social login cookie';
  }
  if (config.keepLiveChat) {
    if (LIVE_CHAT_DOMAINS.has(cookieRoot))                          return 'Live chat service';
    if (LIVE_CHAT_PATTERNS.some(p => name.includes(p)))             return 'Live chat cookie';
  }
  if (config.keepSubscriptions) {
    if (SUBSCRIPTION_DOMAINS.has(cookieRoot))                       return 'Subscription service';
    if (SUBSCRIPTION_PATTERNS.some(p => name.includes(p)))          return 'Subscription cookie';
  }
  if (config.keepShoppingCarts) {
    if (SHOPPING_DOMAINS.has(cookieRoot))                           return 'Shopping cart service';
    if (SHOPPING_PATTERNS.some(p => name.includes(p)))              return 'Shopping cart cookie';
  }
  if (config.keepDisplayPrefs) {
    if (DISPLAY_PATTERNS.some(p => name.includes(p)))               return 'Display preference';
  }
  if (config.keepLocalization) {
    if (LOCALIZATION_PATTERNS.some(p => name.includes(p)))          return 'Localization preference';
  }
  return null;
}
