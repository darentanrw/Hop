import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildAppUrl,
  buildLoginUrl,
  buildNotificationEmail,
  buildOtpEmail,
  buildReplyVerificationEmail,
} from "../../lib/notification-email";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("notification email", () => {
  test("builds the app URL from SITE_URL", () => {
    vi.stubEnv("SITE_URL", "https://hop.example");

    expect(buildAppUrl()).toBe("https://hop.example/");
  });

  test("builds the login URL from SITE_URL", () => {
    vi.stubEnv("SITE_URL", "https://hop.example");

    expect(buildLoginUrl()).toBe("https://hop.example/login");
  });

  test("falls back to localhost when SITE_URL is invalid", () => {
    vi.stubEnv("SITE_URL", "not a url");

    expect(buildLoginUrl()).toBe("http://localhost:3000/login");
  });

  test("renders an optional CTA button", () => {
    const html = buildNotificationEmail(
      "Your group is locked",
      "Your group is locked. Confirm your ride within 30 minutes to keep your spot.",
      {
        href: "https://hop.example/login",
        label: "Log in to confirm ride",
      },
    );

    expect(html).toContain("Your group is locked");
    expect(html).toContain("Confirm your ride within 30 minutes");
    expect(html).toContain('href="https://hop.example/login"');
    expect(html).toContain("Log in to confirm ride");
  });

  test("adds the default Open Hop button to notification emails", () => {
    vi.stubEnv("SITE_URL", "https://hop.example");

    const html = buildNotificationEmail("Matched", "Your group is ready.");

    expect(html).toContain('href="https://hop.example/"');
    expect(html).toContain("Open Hop");
  });

  test("renders OTP emails with the default Open Hop button", () => {
    vi.stubEnv("SITE_URL", "https://hop.example");

    const html = buildOtpEmail("123456");

    expect(html).toContain("123456");
    expect(html).toContain("Enter this code in Hop");
    expect(html).toContain('href="https://hop.example/"');
    expect(html).toContain("Open Hop");
  });

  test("renders reply verification emails with the default Open Hop button", () => {
    vi.stubEnv("SITE_URL", "https://hop.example");

    const html = buildReplyVerificationEmail("oak-yew-zen");

    expect(html).toContain("oak-yew-zen");
    expect(html).toContain("Reply with the exact passphrase above.");
    expect(html).toContain('href="https://hop.example/"');
    expect(html).toContain("Open Hop");
  });
});
