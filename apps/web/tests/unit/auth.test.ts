import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/email", () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
}));

let requestOtp: typeof import("../../lib/auth").requestOtp;
let verifyOtp: typeof import("../../lib/auth").verifyOtp;
let sendOtpEmail: ReturnType<typeof vi.fn>;
let getStore: typeof import("../../lib/store").getStore;

beforeEach(async () => {
  vi.resetModules();
  const authMod = await import("../../lib/auth");
  const emailMod = await import("../../lib/email");
  const storeMod = await import("../../lib/store");
  requestOtp = authMod.requestOtp;
  verifyOtp = authMod.verifyOtp;
  sendOtpEmail = emailMod.sendOtpEmail as ReturnType<typeof vi.fn>;
  getStore = storeMod.getStore;
  sendOtpEmail.mockClear();
});

afterEach(() => {
  const g = globalThis as typeof globalThis & { __hopMemoryStore?: unknown };
  g.__hopMemoryStore = undefined;
});

describe("requestOtp", () => {
  test("rejects non-NUS email addresses", async () => {
    await expect(requestOtp("user@gmail.com")).rejects.toThrow("valid NUS email");
  });

  test("rejects empty email", async () => {
    await expect(requestOtp("")).rejects.toThrow("valid NUS email");
  });

  test("creates OTP request and sends email for valid NUS email", async () => {
    const result = await requestOtp("student@u.nus.edu");

    expect(result.requestId).toBeDefined();
    expect(result.expiresAt).toBeDefined();
    expect(result).not.toHaveProperty("debugCode");
    expect(sendOtpEmail).toHaveBeenCalledOnce();
    expect(sendOtpEmail.mock.calls[0][0]).toBe("student@u.nus.edu");
    expect(sendOtpEmail.mock.calls[0][1]).toMatch(/^\d{6}$/);
  });

  test("normalizes email to lowercase", async () => {
    await requestOtp("Student@U.NUS.EDU");

    expect(sendOtpEmail.mock.calls[0][0]).toBe("student@u.nus.edu");
  });

  test("accepts nus.edu.sg domain", async () => {
    const result = await requestOtp("prof@nus.edu.sg");

    expect(result.requestId).toBeDefined();
    expect(sendOtpEmail).toHaveBeenCalledOnce();
  });

  test("propagates email sending failures", async () => {
    sendOtpEmail.mockRejectedValueOnce(new Error("Resend API down"));

    await expect(requestOtp("student@u.nus.edu")).rejects.toThrow("Resend API down");
  });
});

describe("verifyOtp", () => {
  test("verifies correct OTP and creates session", async () => {
    const { requestId } = await requestOtp("student@u.nus.edu");
    const code = sendOtpEmail.mock.calls[0][1];

    const result = verifyOtp(requestId, code, "dummyPublicKey==");

    expect(result.session).toBeDefined();
    expect(result.session.id).toBeDefined();
    expect(result.user.email).toBe("student@u.nus.edu");
  });

  test("rejects incorrect OTP code", async () => {
    const { requestId } = await requestOtp("student@u.nus.edu");

    expect(() => verifyOtp(requestId, "000000", "dummyPublicKey==")).toThrow("OTP is invalid");
  });

  test("rejects already-consumed OTP", async () => {
    const { requestId } = await requestOtp("student@u.nus.edu");
    const code = sendOtpEmail.mock.calls[0][1];

    verifyOtp(requestId, code, "dummyPublicKey==");
    expect(() => verifyOtp(requestId, code, "dummyPublicKey==")).toThrow("already been used");
  });

  test("rejects non-existent request ID", () => {
    expect(() => verifyOtp("bogus-id", "123456", "dummyPublicKey==")).toThrow("not found");
  });

  test("rejects expired OTP", async () => {
    const { requestId } = await requestOtp("student@u.nus.edu");
    const code = sendOtpEmail.mock.calls[0][1];

    const store = getStore();
    const record = store.otpRequests.get(requestId);
    if (!record) throw new Error("OTP record missing");
    record.expiresAt = new Date(Date.now() - 60_000).toISOString();

    expect(() => verifyOtp(requestId, code, "dummyPublicKey==")).toThrow("expired");
  });
});
