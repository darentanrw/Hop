/** Discrete party sizes supported by the booking UI and matching. */
export type PartySizeValue = 1 | 2 | 3;

/**
 * Map a horizontal pointer position to a party size using three equal thirds of the track
 * (same rules as `PartySizeSlider`).
 */
export function pointerXToPartySize(
  clientX: number,
  rect: { left: number; width: number },
): PartySizeValue {
  if (rect.width <= 0) {
    return 1;
  }
  const t = (clientX - rect.left) / rect.width;
  if (t <= 1 / 3) return 1;
  if (t <= 2 / 3) return 2;
  return 3;
}
