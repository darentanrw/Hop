/** Red below 50, green at 50 and above. */
export function credibilityScoreNumberColor(score: number): string {
  const s = Math.round(score);
  if (s >= 50) return "var(--success)";
  return "var(--danger)";
}
