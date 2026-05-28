import { PURPOSE_SCORE, SCOPE_SCORE, PERSISTENCE_SCORE, OWNER_SCORE, WEIGHTS, SEVERITY_THRESHOLDS } from './constants.js';
import { getThresholds } from './threshold_matrix.js';

/**
 * Computes a risk score [0-10] from the four axis values.
 */
export function computeScore(purpose, scope, persistenceBucket, ownerType) {
  const purposeRaw  = PURPOSE_SCORE[purpose]    ?? PURPOSE_SCORE.unknown;
  const scopeRaw    = SCOPE_SCORE[scope]         ?? SCOPE_SCORE['third-party'];
  const persistRaw  = PERSISTENCE_SCORE[persistenceBucket] ?? 2;
  const ownerRaw    = OWNER_SCORE[ownerType]     ?? OWNER_SCORE.unknown;

  // Normalise each axis to [0,10]
  const purposeNorm  = (purposeRaw  / 9)  * 10;
  const scopeNorm    = (scopeRaw    / 7)  * 10;
  const persistNorm  = (persistRaw  / 5)  * 10;
  const ownerNorm    = (ownerRaw    / 4)  * 10;

  const score =
    purposeNorm  * WEIGHTS.purpose     +
    scopeNorm    * WEIGHTS.scope       +
    persistNorm  * WEIGHTS.persistence +
    ownerNorm    * WEIGHTS.owner;

  return Math.min(10, Math.max(0, score));
}

/**
 * Converts a score to a severity label.
 */
export function scoreToSeverity(score) {
  if (score >= SEVERITY_THRESHOLDS.high)   return 'high';
  if (score >= SEVERITY_THRESHOLDS.medium) return 'medium';
  if (score >= SEVERITY_THRESHOLDS.low)    return 'low';
  return 'safe';
}

/**
 * Makes the final flag/delete decision based on score and config thresholds.
 * Returns { flag, autoDelete, severity, score }
 */
export function makeDecision(score, purpose, ownerName, config) {
  const { deleteThreshold, flagThreshold } = getThresholds(purpose, ownerName, config);
  const severity = scoreToSeverity(score);
  const deletionMode = config.deletionMode || 'auto';

  if (deletionMode === 'flag') {
    // Flag mode: never auto-delete anything
    return {
      flag: score >= flagThreshold,
      autoDelete: false,
      severity,
      score: +score.toFixed(2),
    };
  }

  const autoDelete = score >= deleteThreshold;
  const flag = !autoDelete && score >= flagThreshold;

  return {
    flag: flag || autoDelete,
    autoDelete,
    severity,
    score: +score.toFixed(2),
  };
}
