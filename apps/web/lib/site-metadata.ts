const DEFAULT_PRODUCTION_SITE_URL = "https://hophome.app";
const DEFAULT_DEVELOPMENT_SITE_URL = "http://localhost:3000";

export const socialImageSize = {
  width: 1200,
  height: 630,
} as const;

export const siteMetadata = {
  applicationName: "Hop",
  title: "Get Home with Hop | Privacy-First NUS Campus Rideshare",
  description:
    "Privacy-first campus rideshare for NUS students. Match with riders heading your way, stay updated, and keep exact addresses protected.",
  ogImageAlt: "Hop social preview card highlighting private NUS campus ridesharing.",
} as const;

export function getSiteUrl() {
  const rawSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    (process.env.NODE_ENV === "production"
      ? DEFAULT_PRODUCTION_SITE_URL
      : DEFAULT_DEVELOPMENT_SITE_URL);

  const normalizedSiteUrl = rawSiteUrl.startsWith("http") ? rawSiteUrl : `https://${rawSiteUrl}`;

  return new URL(normalizedSiteUrl);
}
