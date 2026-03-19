function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeAdminEmails(value: string | undefined | null) {
  if (!value) return [];

  return [...new Set(value.split(",").map(normalizeEmail).filter(Boolean))];
}

export function isEmailAllowlisted(email: string | undefined | null, allowlist: string[]) {
  if (!email) return false;
  return allowlist.includes(normalizeEmail(email));
}
