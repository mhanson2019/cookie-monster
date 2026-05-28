import { PERSISTENCE } from '../constants.js';

const SEC = 1;
const DAY = 86400;
const WEEK = DAY * 7;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

/**
 * Returns a persistence bucket for a cookie.
 * @param {chrome.cookies.Cookie} cookie
 * @returns {string} one of PERSISTENCE values
 */
export function getPersistenceBucket(cookie) {
  if (cookie.session || !cookie.expirationDate) return PERSISTENCE.SESSION;
  const now = Date.now() / 1000;
  const ttl = cookie.expirationDate - now;
  if (ttl <= 0)           return PERSISTENCE.SESSION;
  if (ttl <= DAY)         return PERSISTENCE.DAY;
  if (ttl <= WEEK)        return PERSISTENCE.WEEK;
  if (ttl <= MONTH)       return PERSISTENCE.MONTH;
  if (ttl <= YEAR)        return PERSISTENCE.YEAR;
  return PERSISTENCE.LONG;
}
