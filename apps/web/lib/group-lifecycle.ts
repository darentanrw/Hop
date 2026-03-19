export const MEETING_LOCATION_LABEL = "NUS University Town Plaza";

const groupThemes = [
  { name: "Amber Orbit", color: "#f0a030" },
  { name: "Teal Drift", color: "#44d4c8" },
  { name: "Coral Glide", color: "#ef6b6b" },
  { name: "Sky Loop", color: "#60a5fa" },
  { name: "Moss Lane", color: "#34d399" },
  { name: "Sunset Tide", color: "#fb923c" },
];

const riderEmojiPool = ["🦊", "🐼", "🦁", "🐯", "🦉", "🐢", "🐳", "🦄", "🐻", "🐝", "🦋", "🐙"];

function hashString(input: string) {
  let hash = 0;
  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getGroupTheme(seed: string) {
  return groupThemes[hashString(seed) % groupThemes.length];
}

export function getEmojiForMember(seed: string, index: number) {
  return riderEmojiPool[(hashString(seed) + index * 7) % riderEmojiPool.length];
}

export function selectBookerUserId(memberUserIds: string[]) {
  return [...memberUserIds].sort()[0] ?? null;
}

export function deriveMeetingTime(windowStart: string) {
  return new Date(windowStart).toISOString();
}

export function computeSplitAmounts(
  totalCostCents: number,
  memberUserIds: string[],
  payerUserId: string,
) {
  const shareCount = memberUserIds.length;
  if (shareCount === 0) return new Map<string, number>();

  const baseShare = Math.floor(totalCostCents / shareCount);
  let remainder = totalCostCents % shareCount;
  const amounts = new Map<string, number>();

  for (const userId of memberUserIds) {
    const amount = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    amounts.set(userId, userId === payerUserId ? 0 : amount);
  }

  return amounts;
}
