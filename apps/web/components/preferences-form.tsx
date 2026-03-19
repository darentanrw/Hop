"use client";

import type { RiderProfile, SelfDeclaredGender } from "@hop/shared";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../convex/_generated/api";

const genderOptions: { value: SelfDeclaredGender; label: string }[] = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
];

export function PreferencesForm({ profile }: { profile: RiderProfile }) {
  const savePreferences = useMutation(api.mutations.savePreferences);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(profile);
  const [expanded, setExpanded] = useState(false);
  const showSameGenderToggle = form.selfDeclaredGender !== "prefer_not_to_say";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      await savePreferences({
        selfDeclaredGender: form.selfDeclaredGender,
        sameGenderOnly: form.sameGenderOnly,
        minGroupSize: form.minGroupSize,
        maxGroupSize: form.maxGroupSize,
      });
      setForm(form);
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
          <div
            aria-hidden={!showSameGenderToggle}
            style={{
              maxHeight: showSameGenderToggle ? 48 : 0,
              opacity: showSameGenderToggle ? 1 : 0,
              overflow: "hidden",
              pointerEvents: showSameGenderToggle ? "auto" : "none",
              transform: showSameGenderToggle ? "translateY(0)" : "translateY(-4px)",
              transition:
                "max-height 220ms var(--ease-out-expo), opacity 180ms ease, transform 220ms var(--ease-out-expo)",
            }}
          >
            <label className="toggle-row" htmlFor="pref-same-gender">
              <input
                type="checkbox"
                id="pref-same-gender"
                checked={form.sameGenderOnly}
                onChange={(e) => setForm((c) => ({ ...c, sameGenderOnly: e.target.checked }))}
              />
              <span>Only match with same gender</span>
            </label>
          </div>

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
