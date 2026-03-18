export function extractEmailFromFromField(from: string): string | null {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return from.trim().toLowerCase() || null;
}

/** Extract display name from From header. */
export function extractNameFromFromField(from: string): string {
  const trimmed = from.trim();
  const quotedMatch = trimmed.match(/^["']([^"']*)["']\s*</);
  if (quotedMatch) return quotedMatch[1].trim();
  const unquotedMatch = trimmed.match(/^([^<]+)</);
  if (unquotedMatch) return unquotedMatch[1].trim();
  return "";
}

export function buildInboundBodyText(email: { text?: null | string; html?: null | string }) {
  return [email.text?.trim(), email.html?.trim()].filter(Boolean).join("\n");
}

export function extractPassphraseFromBody(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b([a-z]{3,}-[a-z]{3,}-[a-z]{3,})\b/i,
    /\*\*([^*]+)\*\*/,
    /passphrase[:\s]+([^\s\n]+)/i,
    /verification[:\s]+([^\s\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}
