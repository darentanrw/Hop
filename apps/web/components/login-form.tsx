"use client";

import { type FormEvent, useState } from "react";
import { exportPublicKeyBase64 } from "../lib/crypto-browser";
import { OtpInput } from "./otp-input";

type Step = "email" | "otp";

export function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState("");
  const [status, setStatus] = useState<{ type: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const response = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not request OTP." });
      return;
    }

    setRequestId(payload.requestId);
    setStep("otp");
    setStatus({ type: "info", text: "Check your inbox for the 6-digit code." });
  }

  async function verifyOtp(code: string) {
    setBusy(true);
    setStatus(null);

    const clientPublicKey = await exportPublicKeyBase64();
    const response = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, code, clientPublicKey }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not verify OTP." });
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="stack stagger">
      {/* Progress indicator */}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: step === "email" ? "50%" : "100%" }} />
      </div>

      {step === "email" ? (
        <form className="stack" onSubmit={requestOtp} key="email-step">
          <div className="card stack">
            <div className="stack-xs" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="email-input">NUS Email</label>
              <small className="text-muted">Only u.nus.edu and nus.edu.sg addresses accepted</small>
            </div>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e1234567@u.nus.edu"
              required
              autoComplete="email"
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending..." : "Send verification code"}
            </button>
          </div>
        </form>
      ) : (
        <div
          className="stack"
          key="otp-step"
          style={{ animation: "fadeUp 0.4s var(--ease-out-expo) both" }}
        >
          <div className="card stack" style={{ textAlign: "center" }}>
            <div
              className="stack-xs"
              style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}
            >
              <h3>Enter verification code</h3>
              <p className="text-sm text-muted">
                Sent to <strong className="text-accent">{email}</strong>
              </p>
            </div>

            <OtpInput onComplete={verifyOtp} disabled={busy} />

            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                setStep("email");
                setStatus(null);
              }}
              style={{ alignSelf: "center" }}
            >
              Use a different email
            </button>
          </div>
        </div>
      )}

      {status && (
        <div className={`notice ${status.type === "error" ? "notice-error" : "notice-info"}`}>
          {status.text}
        </div>
      )}

      <div className="card-privacy" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--privacy)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
          </svg>
        </div>
        <div>
          <strong
            style={{ fontSize: 13, color: "var(--privacy)", fontFamily: "var(--font-display)" }}
          >
            Privacy by design
          </strong>
          <p className="text-sm" style={{ marginTop: 4 }}>
            Your browser generates an encryption keypair during sign-in. Your home address never
            touches our servers.
          </p>
        </div>
      </div>
    </div>
  );
}
