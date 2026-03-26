"use client";

import { type SelfDeclaredGender, calculateCredibilityScore } from "@hop/shared";
import type { RiderProfile } from "@hop/shared";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../convex/_generated/api";

interface ProfileSheetProps {
  profile: RiderProfile;
  isOpen: boolean;
  onClose: () => void;
}

const genderOptions = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
];

export function ProfileSheet({ profile, isOpen, onClose }: ProfileSheetProps) {
  const currentUser = useQuery(api.queries.currentUser);
  const savePreferences = useMutation(api.mutations.savePreferences);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState(profile);

  const credibilityScore = currentUser
    ? calculateCredibilityScore({
        successfulTrips: currentUser.successfulTrips ?? 0,
        cancelledTrips: currentUser.cancelledTrips ?? 0,
        confirmedReportCount: currentUser.confirmedReportCount ?? 0,
      })
    : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      await savePreferences({
        selfDeclaredGender: form.selfDeclaredGender,
        sameGenderOnly: form.sameGenderOnly,
      });
      setStatus({ type: "success", text: "Preferences saved." });
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not save preferences.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  const showSameGenderToggle = form.selfDeclaredGender !== "prefer_not_to_say";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        role="button"
        tabIndex={0}
        style={{
          animation: "fadeIn 0.2s ease",
        }}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-black rounded-t-2xl"
        style={{
          maxHeight: "90vh",
          animation: "slideUp 0.3s var(--ease-out-expo) both",
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Your Profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{
              padding: "8px",
              borderRadius: "6px",
              background: "var(--surface-hover)",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            overflow: "auto",
            maxHeight: "calc(90vh - 60px)",
            padding: "20px",
          }}
        >
          {/* Credibility Score Card */}
          {credibilityScore !== undefined && (
            <div
              style={{
                background: "linear-gradient(135deg, var(--accent-gradient))",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "20px",
                color: "#0a0c14",
              }}
            >
              <p style={{ margin: 0, fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                Your Credibility Score
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 32, fontWeight: 800 }}>
                  {Math.round(credibilityScore).toString()}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {credibilityScore < 55
                    ? "⚠️ Low"
                    : credibilityScore < 75
                      ? "📊 Fair"
                      : credibilityScore < 90
                        ? "✓ Good"
                        : "⭐ Excellent"}
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, opacity: 0.8 }}>
                <div>✓ {currentUser?.successfulTrips ?? 0} successful trips</div>
                <div>✗ {currentUser?.cancelledTrips ?? 0} cancelled</div>
                <div>⚠️ {currentUser?.confirmedReportCount ?? 0} confirmed reports</div>
              </div>
            </div>
          )}

          {/* Preferences Form */}
          <form onSubmit={handleSubmit} className="stack" style={{ gap: 16 }}>
            <div>
              <label htmlFor="profile-gender" style={{ display: "block", marginBottom: 8 }}>
                Gender Identity
              </label>
              <select
                id="profile-gender"
                value={form.selfDeclaredGender}
                onChange={(e) => {
                  const val = e.target.value as SelfDeclaredGender;
                  setForm((c) => ({
                    ...c,
                    selfDeclaredGender: val,
                    sameGenderOnly: val === "prefer_not_to_say" ? false : c.sameGenderOnly,
                  }));
                }}
                style={{ width: "100%" }}
              >
                {genderOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {showSameGenderToggle && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  marginTop: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.sameGenderOnly}
                  onChange={(e) => setForm((c) => ({ ...c, sameGenderOnly: e.target.checked }))}
                  style={{ cursor: "pointer" }}
                />
                <span>Only match with same gender</span>
              </label>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy}
              style={{ marginTop: 16 }}
            >
              {busy ? "Saving..." : "Save Changes"}
            </button>

            {status && (
              <div
                className={`notice ${status.type === "error" ? "notice-error" : "notice-success"}`}
              >
                {status.text}
              </div>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
