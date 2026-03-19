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
