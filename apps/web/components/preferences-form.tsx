"use client";

import type { RiderProfile, SelfDeclaredGender } from "@hop/shared";
import { type FormEvent, useState } from "react";

const genderOptions: { value: SelfDeclaredGender; label: string }[] = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
];

export function PreferencesForm({ profile }: { profile: RiderProfile }) {
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(profile);
  const [expanded, setExpanded] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const response = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not save preferences." });
      return;
    }

    setForm(payload.riderProfile);
    setStatus({ type: "success", text: "Preferences saved." });
  }

  return (
    <div className="card">
      <button
        type="button"
        className="row-between w-full"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          padding: 0,
          borderRadius: 0,
          textAlign: "left",
        }}
      >
        <h2 style={{ fontSize: 17 }}>Matching preferences</h2>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transition: "transform 0.25s var(--ease-out-expo)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <form
          className="stack"
          onSubmit={handleSubmit}
          style={{ marginTop: 16, animation: "fadeUp 0.3s var(--ease-out-expo) both" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="pref-gender">Gender identity</label>
            <select
              id="pref-gender"
              value={form.selfDeclaredGender}
              onChange={(e) =>
                setForm((c) => ({ ...c, selfDeclaredGender: e.target.value as SelfDeclaredGender }))
              }
            >
              {genderOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <label className="toggle-row" htmlFor="pref-same-gender">
            <input
              type="checkbox"
              id="pref-same-gender"
              checked={form.sameGenderOnly}
              onChange={(e) => setForm((c) => ({ ...c, sameGenderOnly: e.target.checked }))}
            />
            <span>Only match with same gender</span>
          </label>

          <div className="grid-2">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="pref-min">Min group</label>
              <input
                id="pref-min"
                type="number"
                min={2}
                max={4}
                value={form.minGroupSize}
                onChange={(e) => setForm((c) => ({ ...c, minGroupSize: Number(e.target.value) }))}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="pref-max">Max group</label>
              <input
                id="pref-max"
                type="number"
                min={2}
                max={4}
                value={form.maxGroupSize}
                onChange={(e) => setForm((c) => ({ ...c, maxGroupSize: Number(e.target.value) }))}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Saving..." : "Save preferences"}
          </button>

          {status && (
            <div
              className={`notice ${status.type === "error" ? "notice-error" : "notice-success"}`}
            >
              {status.text}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
