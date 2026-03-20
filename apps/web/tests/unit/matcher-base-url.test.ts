import { afterEach, describe, expect, test, vi } from "vitest";
import { getMatcherBaseUrl } from "../../lib/matcher-base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMatcherBaseUrl", () => {
  test("prefers MATCHER_BASE_URL when both env vars are set", () => {
    vi.stubEnv("MATCHER_BASE_URL", "https://server.matcher.internal/");
    vi.stubEnv("NEXT_PUBLIC_MATCHER_BASE_URL", "https://public.matcher.example/");

    expect(getMatcherBaseUrl()).toBe("https://server.matcher.internal");
  });

  test("falls back to NEXT_PUBLIC_MATCHER_BASE_URL for Next.js server routes", () => {
    vi.stubEnv("NEXT_PUBLIC_MATCHER_BASE_URL", "https://public.matcher.example/");

    expect(getMatcherBaseUrl()).toBe("https://public.matcher.example");
  });

  test("throws a clear error on Vercel when the matcher URL is missing", () => {
    vi.stubEnv("VERCEL", "1");

    expect(() => getMatcherBaseUrl()).toThrow(
      "Matcher base URL is not configured. Set MATCHER_BASE_URL or NEXT_PUBLIC_MATCHER_BASE_URL.",
    );
  });

  test("keeps the localhost fallback for local development", () => {
    expect(getMatcherBaseUrl()).toBe("http://localhost:4001");
  });
});
