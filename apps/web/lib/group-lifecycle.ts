export const MEETING_LOCATION_LABEL = "NUS University Town Plaza";

export const EMOJI_NAMES: Record<string, string> = {
  "🦊": "Fox",
  "🐼": "Panda",
  "🦁": "Lion",
  "🐯": "Tiger",
  "🦉": "Owl",
  "🐢": "Turtle",
  "🐳": "Whale",
  "🦄": "Unicorn",
  "🐻": "Bear",
  "🐝": "Bee",
  "🦋": "Butterfly",
  "🐙": "Octopus",
};

export function emojiName(emoji: string): string {
  return EMOJI_NAMES[emoji] ?? emoji;
}

const passphraseWords1 = [
  "amber",
  "azure",
  "bold",
  "calm",
  "crisp",
  "dawn",
  "fair",
  "gold",
  "jade",
  "lime",
  "mist",
  "pine",
  "rose",
  "sage",
  "sky",
  "snow",
  "teal",
  "warm",
  "wild",
  "zest",
];
const passphraseWords2 = [
  "cove",
  "crest",
  "dale",
  "dune",
  "fern",
  "ford",
  "glen",
  "grove",
  "hill",
  "isle",
  "lake",
  "peak",
  "reef",
  "tide",
  "vale",
  "wave",
  "wood",
  "yard",
  "arch",
  "bay",
];
const passphraseWords3 = [
  "drift",
  "glow",
  "leap",
  "rest",
  "rise",
  "roam",
  "sail",
  "soar",
  "step",
  "sway",
  "turn",
  "wade",
  "walk",
  "wind",
  "hum",
  "flow",
  "beam",
  "glide",
  "rush",
  "spin",
];

export function generateQrPassphrase(seed: string): string {
  const h = hashString(seed);
  const w1 = passphraseWords1[h % passphraseWords1.length];
  const w2 = passphraseWords2[(h >>> 5) % passphraseWords2.length];
  const w3 = passphraseWords3[(h >>> 10) % passphraseWords3.length];
  return `${w1}-${w2}-${w3}`;
}

const groupThemes = [
  { name: "Sky Loop", color: "#3b82f6" }, // blue
  { name: "Sunset Blaze", color: "#f97316" }, // orange
  { name: "Forest Grove", color: "#22c55e" }, // green
  { name: "Crimson Rush", color: "#ef4444" }, // red
  { name: "Cobalt Glide", color: "#2563eb" }, // deep blue
  { name: "Amber Orbit", color: "#ea870a" }, // amber
  { name: "Turquoise Bay", color: "#14b8a6" }, // teal
  { name: "Tangerine Arc", color: "#e57a1a" }, // tangerine
  { name: "Slate Path", color: "#64748b" }, // slate
  { name: "Lime Twist", color: "#a3e635" }, // lime
  { name: "Magenta Pop", color: "#db2777" }, // magenta
  { name: "Charcoal Edge", color: "#111827" }, // charcoal/dark
];

const riderEmojiPool = ["🦊", "🐼", "🦁", "🐯", "🦉", "🐢", "🐳", "🦄", "🐻", "🐝", "🦋", "🐙"];

function hashString(input: string) {
  let hash = 0;
  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getGroupTheme(seed: string, usedIndices?: Set<number>) {
  let index = hashString(seed) % groupThemes.length;

  if (usedIndices) {
    let attempts = 0;
    while (usedIndices.has(index) && attempts < groupThemes.length) {
      index = (index + 1) % groupThemes.length;
      attempts++;
    }
    usedIndices.add(index);
  }

  return groupThemes[index];
}

export function getEmojiForMember(seed: string, index: number) {
  return riderEmojiPool[(hashString(seed) + index * 7) % riderEmojiPool.length];
}

export function selectBookerUserId(
  memberUserIds: string[],
  credibilityScores: Map<string, number> = new Map(),
): string | null {
  if (memberUserIds.length === 0) return null;

  // If no credibility data, fall back to alphabetical
  if (credibilityScores.size === 0) {
    return [...memberUserIds].sort()[0];
  }

  // Select highest credibility score; tie-break by alphabetical order
  return memberUserIds.reduce((best, current) => {
    const bestScore = credibilityScores.get(best) ?? 0.5;
    const currentScore = credibilityScores.get(current) ?? 0.5;
    if (currentScore > bestScore || (currentScore === bestScore && current < best)) {
      return current;
    }
    return best;
  });
}

export function deriveMeetingTime(windowStart: string) {
  return new Date(windowStart).toISOString();
}

export function computeSplitAmounts(
  totalCostCents: number,
  members: { userId: string; partySize: number }[],
  payerUserId: string,
) {
  const amounts = new Map<string, number>();
  for (const m of members) {
    amounts.set(m.userId, 0);
  }

  const totalSeatsAll = members.reduce((sum, m) => sum + m.partySize, 0);
  if (totalSeatsAll === 0) {
    return amounts;
  }

  const debtors = members.filter((m) => m.userId !== payerUserId);
  if (debtors.length === 0) {
    return amounts;
  }

  const booker = members.find((m) => m.userId === payerUserId);
  const bookerSeats = booker?.partySize ?? 0;
  const reimbursementPool =
    totalCostCents - Math.floor((totalCostCents * bookerSeats) / totalSeatsAll);

  const debtorSeats = debtors.reduce((sum, m) => sum + m.partySize, 0);
  if (debtorSeats === 0) {
    return amounts;
  }

  let allocated = 0;
  const owed = new Map<string, number>();
  for (const m of debtors) {
    const floor = Math.floor((reimbursementPool * m.partySize) / debtorSeats);
    owed.set(m.userId, floor);
    allocated += floor;
  }

  const remainder = reimbursementPool - allocated;
  const seatOrder = debtors.flatMap((m) => Array.from({ length: m.partySize }, () => m.userId));
  const cycle = Math.max(seatOrder.length, 1);
  for (let i = 0; i < remainder; i++) {
    const uid = seatOrder[i % cycle];
    owed.set(uid, (owed.get(uid) ?? 0) + 1);
  }

  for (const m of debtors) {
    amounts.set(m.userId, owed.get(m.userId) ?? 0);
  }

  return amounts;
}
