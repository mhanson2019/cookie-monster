/**
 * Maps user config slider values to max acceptable risk score per purpose.
 * Score >= threshold means delete/flag. Score < threshold means keep.
 */

// adTolerance (1-5) → max allowed score for advertising/tracking purpose
const AD_TOLERANCE_THRESHOLDS = {
  1: { delete: 0,  flag: 0  }, // Delete all
  2: { delete: 3,  flag: 1  }, // Delete most
  3: { delete: 6,  flag: 3  }, // Neutral
  4: { delete: 8,  flag: 5  }, // Keep most
  5: { delete: 11, flag: 11 }, // Keep all (11 = never)
};

// loginPersistence (1-5) → how strict we are with auth/session cookies
const LOGIN_THRESHOLDS = {
  1: { delete: 4,  flag: 2  }, // Always fresh
  2: { delete: 6,  flag: 3  }, // Lean fresh
  3: { delete: 11, flag: 6  }, // Balanced (default: never auto-delete auth)
  4: { delete: 11, flag: 8  }, // Stay logged in
  5: { delete: 11, flag: 11 }, // Always stay logged in
};

// googleTrust (1-5) → threshold for Google-owned cookies
const GOOGLE_THRESHOLDS = {
  1: { delete: 3,  flag: 1  }, // Flag all Google
  2: { delete: 5,  flag: 3  }, // Flag most
  3: { delete: 8,  flag: 5  }, // Neutral
  4: { delete: 11, flag: 7  }, // Trust most
  5: { delete: 11, flag: 11 }, // Whitelist all
};

// deletionMode → global score modifier
const DELETION_MODE_MODIFIER = {
  flag:   +2,  // harder to auto-delete, easier to flag
  auto:    0,  // default
  strict: -2,  // easier to auto-delete
};

/**
 * Returns delete and flag thresholds for a given cookie context and config.
 */
export function getThresholds(purpose, ownerName, config) {
  const adTolerance    = config.adTolerance    || 2;
  const loginPersist   = config.loginPersistence || 3;
  const googleTrust    = config.googleTrust    || 3;
  const deletionMode   = config.deletionMode   || 'auto';

  const modeOffset = DELETION_MODE_MODIFIER[deletionMode] || 0;

  const isGoogleOwned = ownerName && (
    ownerName.includes('Google') || ownerName.includes('Alphabet')
  );

  let base;
  if (isGoogleOwned) {
    base = GOOGLE_THRESHOLDS[googleTrust] || GOOGLE_THRESHOLDS[3];
  } else if (purpose === 'advertising' || purpose === 'tracking') {
    base = AD_TOLERANCE_THRESHOLDS[adTolerance] || AD_TOLERANCE_THRESHOLDS[2];
  } else if (purpose === 'auth' || purpose === 'security') {
    base = LOGIN_THRESHOLDS[loginPersist] || LOGIN_THRESHOLDS[3];
  } else if (purpose === 'analytics') {
    // analytics: slightly more lenient than ads
    const adBase = AD_TOLERANCE_THRESHOLDS[adTolerance] || AD_TOLERANCE_THRESHOLDS[2];
    base = { delete: adBase.delete + 1, flag: adBase.flag + 1 };
  } else {
    // functional, consent, personalization, unknown: relatively lenient
    base = { delete: 8, flag: 5 };
  }

  return {
    deleteThreshold: Math.min(11, base.delete + modeOffset),
    flagThreshold:   Math.min(11, base.flag   + modeOffset),
  };
}
