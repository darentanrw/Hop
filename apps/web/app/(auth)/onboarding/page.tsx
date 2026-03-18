"use client";

import type { SelfDeclaredGender } from "@hop/shared";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";

const genderOptions: { value: SelfDeclaredGender; label: string }[] = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const user = useQuery(api.queries.currentUser);
  const completeOnboarding = useMutation(api.mutations.completeOnboarding);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    selfDeclaredGender: "prefer_not_to_say" as SelfDeclaredGender,
    sameGenderOnly: false,
    minGroupSize: 2,
    maxGroupSize: 4,
  });
  const [acceptedTc, setAcceptedTc] = useState(false);
  const [confirmedTruthful, setConfirmedTruthful] = useState(false);
  const showSameGenderToggle = form.selfDeclaredGender !== "prefer_not_to_say";
  const displayName = user?.name?.trim() ?? "";
  const showName = user !== undefined && displayName.length > 0;

  useEffect(() => {
    const userName = user?.name?.trim();
    if (userName && !form.name) {
      setForm((c) => ({ ...c, name: userName }));
    }
  }, [user?.name, form.name]);
  const canSubmit = acceptedTc && confirmedTruthful && form.name.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    try {
      await completeOnboarding({ ...form, name: form.name.trim() });
      router.replace("/dashboard");
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
    <div className="auth-page">
      <div className="auth-header">
        <h1>
          Welcome to Hop
          <br />
          <span
            style={{
              display: "inline-block",
              minHeight: "1.2em",
              opacity: showName ? 1 : 0,
              transform: showName ? "translateY(0)" : "translateY(4px)",
              transition: "opacity 220ms ease, transform 220ms var(--ease-out-expo)",
            }}
          >
            {showName ? displayName : "\u00A0"}
          </span>
        </h1>
        <p style={{ marginTop: 8 }}>
          Set your gender identity and matching preferences. You can change these anytime from your
          dashboard.
        </p>
      </div>
      <div className="auth-body">
        <form className="stack" onSubmit={handleSubmit}>
          <div className="card stack">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <label htmlFor="onboard-name">Full name</label>
              <input
                id="onboard-name"
                type="text"
                placeholder="e.g. Tan Sheng Jun, Alex"
                value={form.name}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    name: e.target.value,
                  }))
                }
                autoComplete="name"
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <label htmlFor="onboard-gender">Gender identity</label>
              <select
                id="onboard-gender"
                value={form.selfDeclaredGender}
                onChange={(e) => {
                  const val = e.target.value as SelfDeclaredGender;
                  setForm((c) => ({
                    ...c,
                    selfDeclaredGender: val,
                    sameGenderOnly: val === "prefer_not_to_say" ? false : c.sameGenderOnly,
                  }));
                }}
              >
                {genderOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

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
              <label className="toggle-row" htmlFor="onboard-same-gender">
                <input
                  type="checkbox"
                  id="onboard-same-gender"
                  checked={form.sameGenderOnly}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      sameGenderOnly: e.target.checked,
                    }))
                  }
                />
                <span>Only match with same gender</span>
              </label>
            </div>

            <label className="consent-check" htmlFor="onboard-accept-tc">
              <input
                type="checkbox"
                id="onboard-accept-tc"
                checked={acceptedTc}
                onChange={(e) => setAcceptedTc(e.target.checked)}
              />
              <span>
                I agree to the{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer">
                  Terms and Conditions
                </a>
                .
              </span>
            </label>

            <label className="consent-check" htmlFor="onboard-truthful-info">
              <input
                type="checkbox"
                id="onboard-truthful-info"
                checked={confirmedTruthful}
                onChange={(e) => setConfirmedTruthful(e.target.checked)}
              />
              <span>I confirm that the information I have provided is correct and truthful.</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy || !canSubmit}
            >
              {busy ? "Saving..." : "Continue to dashboard"}
            </button>

            {status && (
              <div
                className={`notice ${status.type === "error" ? "notice-error" : "notice-success"}`}
              >
                {status.text}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
