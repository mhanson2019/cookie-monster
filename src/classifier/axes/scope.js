/**
 * Determines the scope of a cookie relative to the current tab.
 * @param {string} cookieDomain
 * @param {string} tabRootDomain
 * @param {boolean} isKnownTracker
 * @returns {'first-party'|'third-party'|'third-party-tracker'}
 */
export function getScope(cookieDomain, tabRootDomain, isKnownTracker) {
  const clean = cookieDomain.replace(/^\./, '');
  const cookieRoot = clean.split('.').slice(-2).join('.');
  const isFirstParty = cookieRoot === tabRootDomain || clean.includes(tabRootDomain);
  if (isFirstParty) return 'first-party';
  if (isKnownTracker) return 'third-party-tracker';
  return 'third-party';
}
