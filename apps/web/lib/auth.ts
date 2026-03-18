import { getEmailDomain, isAllowedUniversityEmail } from "@hop/shared";
import {
  consumeOtpRequest,
  createOtpRequest,
  createSession,
  ensureRiderForUser,
  getOtpRequest,
  registerClientKey,
  sha256,
  upsertUser,
} from "./store";

export function requestOtp(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isAllowedUniversityEmail(normalizedEmail)) {
    throw new Error("Please use a valid NUS email address.");
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const otpRequest = createOtpRequest(normalizedEmail, getEmailDomain(normalizedEmail), code);

  return {
    requestId: otpRequest.id,
    expiresAt: otpRequest.expiresAt,
    debugCode: process.env.NODE_ENV === "production" ? undefined : code,
  };
}

export function verifyOtp(requestId: string, code: string, clientPublicKey: string) {
  const otpRequest = getOtpRequest(requestId);
  if (!otpRequest) {
    throw new Error("OTP request not found.");
  }

  if (otpRequest.consumedAt) {
    throw new Error("OTP request has already been used.");
  }

  if (new Date(otpRequest.expiresAt).getTime() < Date.now()) {
    throw new Error("OTP has expired.");
  }

  if (sha256(code.trim()) !== otpRequest.codeHash) {
    throw new Error("OTP is invalid.");
  }

  const user = upsertUser(otpRequest.email, otpRequest.emailDomain);
  ensureRiderForUser(user.id);
  registerClientKey(user.id, clientPublicKey);
  consumeOtpRequest(otpRequest.id);

  return {
    session: createSession(user.id),
    user,
  };
}
