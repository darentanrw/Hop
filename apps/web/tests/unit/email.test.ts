import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("resend", () => {
  const sendMock = vi.fn().mockResolvedValue({ data: { id: "msg_123" }, error: null });
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: sendMock },
    })),
    __sendMock: sendMock,
  };
});

let sendOtpEmail: typeof import("../../lib/email").sendOtpEmail;
let sendMock: ReturnType<typeof vi.fn>;
let consoleSpy: MockInstance;

beforeEach(async () => {
  vi.resetModules();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  consoleSpy.mockRestore();
});

async function loadModule(envOverrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries(envOverrides)) {
    vi.stubEnv(key, value as string);
  }
  const emailMod = await import("../../lib/email");
  const resendMod = await import("resend");
  sendOtpEmail = emailMod.sendOtpEmail;
  sendMock = (resendMod as unknown as { __sendMock: ReturnType<typeof vi.fn> }).__sendMock;
  sendMock.mockClear();
}

describe("sendOtpEmail", () => {
  test("sends via Resend when API key is configured", async () => {
    await loadModule({ AUTH_RESEND_KEY: "re_test_123", RESEND_FROM_EMAIL: "Test <test@hop.sg>" });

    await sendOtpEmail("student@u.nus.edu", "123456");

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe("student@u.nus.edu");
    expect(call.from).toBe("Test <test@hop.sg>");
    expect(call.subject).toBe("Your Hop verification code");
    expect(call.html).toContain("123456");
  });

  test("uses default from address when RESEND_FROM_EMAIL is not set", async () => {
    await loadModule({ AUTH_RESEND_KEY: "re_test_123", RESEND_FROM_EMAIL: undefined });

    await sendOtpEmail("student@u.nus.edu", "654321");

    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe("Hop <login@hophome.app>");
  });

  test("logs to console in dev when no API key is set", async () => {
    await loadModule({ AUTH_RESEND_KEY: "", NODE_ENV: "development" });

    await sendOtpEmail("student@u.nus.edu", "999111");

    expect(sendMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("[dev] OTP for student@u.nus.edu: 999111");
  });

  test("throws in production when no API key is set", async () => {
    await loadModule({ AUTH_RESEND_KEY: "", NODE_ENV: "production" });

    await expect(sendOtpEmail("student@u.nus.edu", "123456")).rejects.toThrow(
      "Email service is not configured.",
    );
  });

  test("throws when Resend returns an error", async () => {
    await loadModule({ AUTH_RESEND_KEY: "re_test_123" });
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "Rate limit exceeded" } });

    await expect(sendOtpEmail("student@u.nus.edu", "123456")).rejects.toThrow(
      "Failed to send OTP email: Rate limit exceeded",
    );
  });
});
