"use client";

import { calculateCredibilityScore, type SelfDeclaredGender } from "@hop/shared";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";

export default function ProfilePage() {
  const riderProfile = useQuery(api.queries.getRiderProfile);
  const savePreferences = useMutation(api.mutations.savePreferences);
  
  const [selectedGender, setSelectedGender] = useState<SelfDeclaredGender>(riderProfile?.selfDeclaredGender ?? "prefer_not_to_say");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  if (!riderProfile) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <p className="text-muted">Loading profile...</p>
      </div>
    );
  }

  const credibilityScore = calculateCredibilityScore({
    successfulTrips: riderProfile.successfulTrips ?? 0,
    cancelledTrips: riderProfile.cancelledTrips ?? 0,
    reportedCount: riderProfile.reportedCount ?? 0,
  });

  const totalTrips = (riderProfile.successfulTrips ?? 0) + (riderProfile.cancelledTrips ?? 0);
  const successRate = totalTrips > 0 ? ((riderProfile.successfulTrips ?? 0) / totalTrips * 100).toFixed(0) : 0;

  async function handleSaveGender() {
    if (!riderProfile) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      await savePreferences({
        selfDeclaredGender: selectedGender,
        sameGenderOnly: riderProfile.sameGenderOnly,
        minGroupSize: riderProfile.minGroupSize,
        maxGroupSize: riderProfile.maxGroupSize,
      });
      setSaveStatus({ type: "success", message: "Gender updated successfully" });
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      setSaveStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save changes",
      });
    } finally {
      setSaving(false);
    }
  }

  const genderChanged = selectedGender !== riderProfile.selfDeclaredGender;

  return (
    <div className="stack-lg stagger" style={{ paddingTop: 4, paddingBottom: 80 }}>
      {/* Back link */}
      <Link href="/dashboard" style={{ textDecoration: "none", color: "var(--text-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
          Back to home
        </div>
      </Link>

      {/* Profile header */}
      <div>
        <h1>{riderProfile.name?.trim() ?? "Your Profile"}</h1>
        <p className="text-muted" style={{ marginTop: 4, fontSize: 14 }}>
          {riderProfile.email}
        </p>
      </div>

      {/* Credibility score card */}
      <div className="card" style={{ background: "var(--surface-hover)" }}>
        <div style={{ marginBottom: 16 }}>
          <p className="text-muted text-sm" style={{ marginBottom: 4 }}>Credibility Score</p>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)" }}>
            {(credibilityScore * 100).toFixed(0)}
          </div>
        </div>

        {/* Score breakdown */}
        <div className="stack-sm" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="row-between">
            <span className="text-muted">Success rate</span>
            <strong>{successRate}%</strong>
          </div>
          <div className="row-between">
            <span className="text-muted">Successful trips</span>
            <strong>{riderProfile.successfulTrips ?? 0}</strong>
          </div>
          <div className="row-between">
            <span className="text-muted">Cancelled trips</span>
            <strong>{riderProfile.cancelledTrips ?? 0}</strong>
          </div>
          <div className="row-between">
            <span className="text-muted">Reports</span>
            <strong>{riderProfile.reportedCount ?? 0}</strong>
          </div>
        </div>

        {/* Score explanation */}
        <p className="text-muted text-xs" style={{ marginTop: 16, lineHeight: 1.5 }}>
          Your credibility score is calculated from your trip history. Completing trips improves your score, while cancellations and reports reduce it. A higher score helps you become a booker.
        </p>
      </div>

      {/* Gender selection */}
      <div className="card">
        <label htmlFor="gender" style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
          Gender Identity
        </label>
        <select
          id="gender"
          value={selectedGender}
          onChange={(e) => {
            setSelectedGender(e.target.value as SelfDeclaredGender);
            setSaveStatus(null);
          }}
          disabled={saving}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: "14px",
            fontFamily: "inherit",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <option value="prefer_not_to_say">Prefer not to say</option>
          <option value="woman">Woman</option>
          <option value="man">Man</option>
          <option value="nonbinary">Non-binary</option>
        </select>

        {genderChanged && (
          <button
            onClick={handleSaveGender}
            disabled={saving}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              fontWeight: 500,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}

        {saveStatus && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: "6px",
              background: saveStatus.type === "success" ? "var(--success-fg)" : "var(--error-fg)",
              color: saveStatus.type === "success" ? "var(--success)" : "var(--error)",
              fontSize: "13px",
              textAlign: "center",
            }}
          >
            {saveStatus.message}
          </div>
        )}
      </div>
    </div>
  );
}
