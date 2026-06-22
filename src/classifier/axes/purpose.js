// Auth cookie name patterns
const AUTH_PATTERNS = [
  'session', 'sess', 'auth', 'token', 'login', 'logged', 'user_id',
  'csrf', 'xsrf', 'jwt', 'access_token', 'refresh_token', 'oauth',
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
];

// Security patterns
const SECURITY_PATTERNS = [
  '__cf_bm', '__cflb', 'cf_clearance', '__utmz', 'AEC', 'CONSENT',
];

// Consent patterns
const CONSENT_PATTERNS = [
  'consent', 'gdpr', 'cookie_consent', 'cookieconsent', 'euconsent',
  'tcf', 'CookieConsent', 'notice_', 'cmapi_', 'OptanonConsent',
  'cookieyes', 'moove_gdpr',
];

// Analytics patterns
const ANALYTICS_PATTERNS = [
  '_ga', '_gid', '_gat', '_gcl', '__utm', 'amplitude', 'mixpanel',
  '_hjid', '_hjSession', 'heap_', 'hotjar', '_ym_', 'matomo',
  'ajs_', 'dd_s', '_sp_', 'ki_', '_clck', '_clsk', 'CLID',
];

// Advertising patterns
const AD_PATTERNS = [
  '_fbp', '_fbc', 'IDE', 'DSID', 'NID', '_gcl_au', '_gcl_aw',
  '_ttp', '__ttp', 'ttcsid', '_pin_', '_scid', '_sctr',
  'MUID', '_uetsid', '_uetvid', 'li_at', 'UserMatch',
];

// Functional / preference patterns
const FUNCTIONAL_PATTERNS = [
  'lang', 'locale', 'currency', 'timezone', 'theme', 'darkmode',
  'cart', 'basket', 'checkout', 'wishlist', 'pref', 'settings',
  'intercom', 'drift', 'crisp', 'tawk', 'zendesk',
];

function matchesAny(name, patterns) {
  const lower = name.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Infers the purpose of a cookie from its name alone.
 * @param {string} cookieName
 * @returns {{ purpose: string, confidence: 'high'|'medium'|'low' }}
 */
function purposeFromName(cookieName) {
  if (matchesAny(cookieName, SECURITY_PATTERNS))   return { purpose: 'security',       confidence: 'high' };
  if (matchesAny(cookieName, CONSENT_PATTERNS))    return { purpose: 'consent',        confidence: 'high' };
  if (matchesAny(cookieName, AD_PATTERNS))         return { purpose: 'advertising',    confidence: 'high' };
  if (matchesAny(cookieName, ANALYTICS_PATTERNS)) return { purpose: 'analytics',      confidence: 'high' };
  if (matchesAny(cookieName, AUTH_PATTERNS))       return { purpose: 'auth',           confidence: 'medium' };
  if (matchesAny(cookieName, FUNCTIONAL_PATTERNS)) return { purpose: 'functional',     confidence: 'medium' };
  return { purpose: 'unknown', confidence: 'low' };
}

/**
 * Infers the purpose of a cookie.
 *
 * A high-confidence name match (e.g. `_fbp` → advertising) wins over the broad
 * domain category, because the cookie name is a more precise signal than the
 * domain-wide classification. We fall back to the tracker DB category when the
 * name is ambiguous, then to the medium/low-confidence name match.
 *
 * @param {string} cookieName
 * @param {string|null} trackerCategory - from tracker DB, if known
 * @returns {{ purpose: string, confidence: 'high'|'medium'|'low' }}
 */
export function getPurpose(cookieName, trackerCategory) {
  const nameResult = purposeFromName(cookieName);
  if (nameResult.confidence === 'high') return nameResult;

  if (trackerCategory) {
    const catMap = {
      'a': 'advertising', 'n': 'analytics',
      't': 'tracking', 'f': 'functional', 'u': 'unknown'
    };
    return { purpose: catMap[trackerCategory] || 'unknown', confidence: 'high' };
  }

  return nameResult;
}
