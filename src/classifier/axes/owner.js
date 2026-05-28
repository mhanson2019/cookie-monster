const BIG_PLATFORM_OWNERS = new Set([
  'Google', 'Meta', 'Facebook', 'Microsoft', 'Amazon', 'Twitter',
  'LinkedIn', 'Adobe', 'Oracle', 'Salesforce', 'Apple', 'TikTok',
  'ByteDance', 'Snapchat', 'Pinterest', 'Yahoo', 'Verizon Media',
  'Oath', 'AT&T'
]);

const DATA_BROKER_KEYWORDS = [
  'acxiom', 'experian', 'equifax', 'transunion', 'oracle data',
  'liveramp', 'neustar', 'epsilon', 'datalogix', 'bluekai',
  'lotame', 'krux', 'eyeota', 'exelator', 'adform',
];

/**
 * Determines owner type for scoring.
 * @param {string|null} ownerName - from tracker DB
 * @param {string|null} ownerType - 'b'=big-platform, 'v'=vendor from DB
 * @returns {'site-itself'|'known-vendor'|'big-platform'|'data-broker'|'unknown'}
 */
export function getOwnerType(ownerName, ownerType) {
  if (!ownerName) return 'unknown';
  if (ownerType === 'b') return 'big-platform';

  const lower = ownerName.toLowerCase();
  if (DATA_BROKER_KEYWORDS.some(k => lower.includes(k))) return 'data-broker';
  if (BIG_PLATFORM_OWNERS.has(ownerName)) return 'big-platform';
  if (ownerType === 'v') return 'known-vendor';

  return 'unknown';
}
