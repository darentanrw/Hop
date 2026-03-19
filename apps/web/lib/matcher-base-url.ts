const DEFAULT_LOCAL_MATCHER_BASE_URL = "http://localhost:4001";

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export function getMatcherBaseUrl() {
  const configuredBaseUrl =
    normalizeBaseUrl(process.env.MATCHER_BASE_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_MATCHER_BASE_URL);

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "Matcher base URL is not configured. Set MATCHER_BASE_URL or NEXT_PUBLIC_MATCHER_BASE_URL.",
    );
  }

  return DEFAULT_LOCAL_MATCHER_BASE_URL;
}
