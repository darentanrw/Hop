"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

export function SuspendedSignOut() {
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-block"
      onClick={handleSignOut}
      disabled={busy}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
