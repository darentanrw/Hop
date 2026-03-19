import { isNusAliasFormat } from "@hop/shared";

const MAX_INBOUND_BODY_CHARS = 100_000;
const DASH_VARIANT_REGEX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const ZERO_WIDTH_REGEX = /\u200B|\u200C|\u200D|\uFEFF/g;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const HTML_SCRIPT_REGEX = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const HTML_STYLE_REGEX = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const HTML_BREAK_REGEX = /<br\s*\/?>/gi;
const HTML_BLOCK_END_REGEX =
  /<\/(?:p|div|li|tr|table|blockquote|section|article|header|footer|h[1-6])>/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_ENTITY_REGEX = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi;

type DirectVerification<TId extends string> = {
  id: TId;
  passphrase: string;
};

type VerificationByBody<TId extends string> = {
  id: TId;
  email: string;
};

type ResolveInboundVerificationArgs<TId extends string> = {
  senderEmail: string;
  bodyText: string;
  verificationByEmail: DirectVerification<TId> | null;
  verificationByBody: VerificationByBody<TId> | null;
};

export type InboundVerificationDecision<TId extends string = string> =
  | {
      kind: "none";
      reason: "no_matching_passphrase" | "passphrase_mismatch" | "exact_match_required";
    }
  | { kind: "verify"; verificationId: TId }
  | { kind: "pending_alias"; verificationId: TId; signupEmail: string };

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
  const text = email.text?.trim();
  if (text) return limitInboundText(text);

  const html = email.html?.trim();
  if (!html) return "";

  return htmlToPlainText(html).trim();
}

export function bodyContainsPassphrase(text: string, passphrase: string): boolean {
  const normalizedBody = normalizeInboundText(text);
  const normalizedPassphrase = normalizePassphrase(passphrase);

  if (!normalizedBody || !normalizedPassphrase) return false;

  const escapedPassphrase = escapeForRegex(normalizedPassphrase);
  const pattern = new RegExp(`(^|[^a-z0-9])${escapedPassphrase}($|[^a-z0-9])`, "i");
  return pattern.test(normalizedBody);
}

export function findNewestVerificationMatchByBody<
  T extends { passphrase: string; _creationTime: number },
>(records: readonly T[], bodyText: string): T | null {
  return (
    [...records]
      .filter((record) => bodyContainsPassphrase(bodyText, record.passphrase))
      .sort((left, right) => right._creationTime - left._creationTime)[0] ?? null
  );
}

export function resolveInboundVerificationDecision<TId extends string>({
  senderEmail,
  bodyText,
  verificationByEmail,
  verificationByBody,
}: ResolveInboundVerificationArgs<TId>): InboundVerificationDecision<TId> {
  const normalizedSenderEmail = senderEmail.trim().toLowerCase();

  if (verificationByEmail) {
    if (!bodyContainsPassphrase(bodyText, verificationByEmail.passphrase)) {
      return { kind: "none", reason: "passphrase_mismatch" };
    }

    return { kind: "verify", verificationId: verificationByEmail.id };
  }

  if (!verificationByBody) {
    return { kind: "none", reason: "no_matching_passphrase" };
  }

  if (verificationByBody.email.trim().toLowerCase() === normalizedSenderEmail) {
    return { kind: "verify", verificationId: verificationByBody.id };
  }

  if (isNusAliasFormat(verificationByBody.email)) {
    return {
      kind: "pending_alias",
      verificationId: verificationByBody.id,
      signupEmail: verificationByBody.email,
    };
  }

  return { kind: "none", reason: "exact_match_required" };
}

function htmlToPlainText(html: string) {
  const sanitized = limitInboundText(html)
    .replace(HTML_COMMENT_REGEX, " ")
    .replace(HTML_SCRIPT_REGEX, " ")
    .replace(HTML_STYLE_REGEX, " ")
    .replace(HTML_BREAK_REGEX, "\n")
    .replace(HTML_BLOCK_END_REGEX, "\n");

  const decoded = decodeHtmlEntities(sanitized);
  return decoded.replace(HTML_TAG_REGEX, " ").trim();
}

function decodeHtmlEntities(text: string) {
  return text.replace(HTML_ENTITY_REGEX, (match, entity: string) => {
    const normalizedEntity = entity.toLowerCase();

    if (normalizedEntity.startsWith("#x")) {
      return codePointToString(Number.parseInt(normalizedEntity.slice(2), 16));
    }

    if (normalizedEntity.startsWith("#")) {
      return codePointToString(Number.parseInt(normalizedEntity.slice(1), 10));
    }

    switch (normalizedEntity) {
      case "nbsp":
        return " ";
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

function codePointToString(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    return "";
  }

  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

function normalizeInboundText(text: string) {
  return normalizeComparableText(text).replace(/\s+/g, " ").trim();
}

function normalizePassphrase(passphrase: string) {
  return normalizeComparableText(passphrase).trim();
}

function normalizeComparableText(text: string) {
  return limitInboundText(text)
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(DASH_VARIANT_REGEX, "-")
    .replace(/\s*-\s*/g, "-")
    .toLowerCase();
}

function limitInboundText(text: string) {
  return text.slice(0, MAX_INBOUND_BODY_CHARS);
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
