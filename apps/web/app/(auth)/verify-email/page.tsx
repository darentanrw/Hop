"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";

const RESEND_COOLDOWN_SEC = 60;
const localQaRequested = process.env.NEXT_PUBLIC_ENABLE_LOCAL_QA === "true";

export default function VerifyEmailPage() {
  const router = useRouter();
  const status = useQuery(api.queries.getVerificationStatus);
  const localQaConfig = useQuery(api.admin.localQaConfig);
  const sendVerificationEmail = useAction(api.verification.sendVerificationEmail);
  const confirmAlias = useMutation(api.mutations.confirmAliasAndVerify);
  const rejectAlias = useMutation(api.mutations.rejectAlias);
  const bootstrapLocalQaUser = useMutation(api.admin.bootstrapLocalQaUser);
  const sentRef = useRef(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [aliasBusy, setAliasBusy] = useState(false);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaStatus, setQaStatus] = useState<string | null>(null);
  const localQaEnabled = localQaRequested && localQaConfig?.enabled === true;

  useEffect(() => {
    if (status === undefined) return;
    if (status === null) {
      router.replace("/login");
      return;
    }
    if (status.emailVerified && status.onboardingComplete) {
      router.replace("/dashboard");
      return;
    }
    if (status.emailVerified && !status.onboardingComplete) {
      router.replace("/onboarding");
      return;
    }
  }, [status, router]);

  useEffect(() => {
    if (status && !status.emailVerified && !sentRef.current) {
      sentRef.current = true;
      sendVerificationEmail({})
        .then(() => setResendCooldown(RESEND_COOLDOWN_SEC))
        .catch(() => {
          sentRef.current = false;
        });
    }
  }, [status, sendVerificationEmail]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => {
      setResendCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  async function handleResend() {
    if (resendCooldown > 0) return;
    try {
      await sendVerificationEmail({});
      setResendCooldown(RESEND_COOLDOWN_SEC);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleConfirmAlias() {
    if (aliasBusy) return;
    setAliasBusy(true);
    try {
      await confirmAlias({});
      // Status will update, useEffect will redirect to onboarding or dashboard
    } catch (err) {
      console.error(err);
    } finally {
      setAliasBusy(false);
    }
  }

  async function handleRejectAlias() {
    if (aliasBusy) return;
    setAliasBusy(true);
    try {
      await rejectAlias({});
      await sendVerificationEmail({});
      setResendCooldown(RESEND_COOLDOWN_SEC);
    } catch (err) {
      console.error(err);
    } finally {
      setAliasBusy(false);
    }
  }

  async function handleSkipForLocalQa() {
    if (qaBusy) return;
    setQaBusy(true);
    setQaStatus(null);

    try {
      await bootstrapLocalQaUser({});
      router.replace("/dashboard");
    } catch (err) {
      setQaStatus(err instanceof Error ? err.message : "Could not prepare the local QA account.");
    } finally {
      setQaBusy(false);
    }
  }

  if (status === undefined) {
    return (
      <div className="auth-page">
        <div className="auth-body">
          <div className="card" style={{ textAlign: "center", padding: 32 }}>
            <p className="text-muted">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (status?.pendingAlias) {
    return (
      <div className="auth-page">
        <div className="auth-header">
          <h1>Confirm your email</h1>
          <p style={{ marginTop: 8 }}>
            We received a reply from <strong>{status.pendingAlias.from}</strong>. Is this also your
            email address?
          </p>
        </div>
        <div className="auth-body">
          <div className="card stack">
            <p className="text-muted text-sm">
              We are double checking as the email you signed up with was{" "}
              <strong>{status.pendingAlias.signupEmail}</strong>.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConfirmAlias}
                disabled={aliasBusy}
              >
                Yes, that&apos;s me
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleRejectAlias}
                disabled={aliasBusy}
              >
                No, resend verification
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-header">
        <h1>First time with Hop?</h1>
        <p style={{ marginTop: 8 }}>
          We sent a verification email to your NUS inbox. Reply to that email with the passphrase to
          confirm your identity.
        </p>
      </div>
      <div className="auth-body">
        <div className="card stack">
          <p className="text-muted text-sm">
            Check your inbox and reply with <strong>only</strong> the passphrase — nothing else. No
            other text, signature, or attachments. This page will update automatically when we
            receive your reply.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleResend}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend verification email"}
          </button>
        </div>

        {localQaEnabled ? (
          <div className="card stack" style={{ borderStyle: "dashed" }}>
            <div className="stack-xs">
              <div className="row" style={{ gap: 8 }}>
                <span className="pill pill-accent">Local QA</span>
                <span className="pill pill-muted">Dev only</span>
              </div>
              <p className="text-sm text-muted">
                Skip email verification and mark this account ready for local manual QA.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSkipForLocalQa}
              disabled={qaBusy}
            >
              {qaBusy ? "Preparing QA account..." : "Prepare QA account and continue"}
            </button>
            {qaStatus ? (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {qaStatus}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
