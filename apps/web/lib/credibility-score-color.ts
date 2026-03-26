/**
 * Colours the displayed credibility number: red for 30–49 (and below 30), green from 50 up.
 */
export function credibilityScoreNumberColor(score: number): string {
  const s = Math.round(score);
  if (s >= 50) return "var(--success)";
  return "var(--danger)";
}
