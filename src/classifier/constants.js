// Persistence buckets
export const PERSISTENCE = {
  SESSION:    'session',
  DAY:        '≤1 day',
  WEEK:       '≤7 days',
  MONTH:      '≤30 days',
  YEAR:       '≤1 year',
  LONG:       '>1 year',
};

export const PERSISTENCE_EMOJI = {
  session:    '⚡',
  '≤1 day':  '🕐',
  '≤7 days': '📅',
  '≤30 days':'📆',
  '≤1 year': '🗓',
  '>1 year':  '♾',
};

// Purpose axis values and base risk scores (0-10)
export const PURPOSE_SCORE = {
  auth:           0,
  security:       0,
  consent:        1,
  functional:     1,
  personalization:2,
  analytics:      4,
  advertising:    7,
  tracking:       9,
  unknown:        5,
};

// Scope axis additional score
export const SCOPE_SCORE = {
  'first-party':          0,
  'third-party':          3,
  'third-party-tracker':  7,
};

// Persistence axis additional score
export const PERSISTENCE_SCORE = {
  session:    0,
  '≤1 day':   1,
  '≤7 days':  2,
  '≤30 days': 3,
  '≤1 year':  4,
  '>1 year':  5,
};

// Owner axis additional score
export const OWNER_SCORE = {
  'site-itself':  0,
  'known-vendor': 1,
  'big-platform': 2,
  'data-broker':  4,
  'unknown':      3,
};

// Axis weights
export const WEIGHTS = {
  purpose:     0.40,
  scope:       0.30,
  persistence: 0.20,
  owner:       0.10,
};

// Score thresholds → severity buckets
export const SEVERITY_THRESHOLDS = {
  high:   7.5,
  medium: 4.5,
  low:    2.0,
  // below low = safe/trusted
};
