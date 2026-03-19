"use client";

import type { RiderProfile } from "@hop/shared";
import Link from "next/link";
import { LogoutButton } from "./logout-button";

export function TopBarContent({ profile }: { profile: RiderProfile }) {
  return (
    <div className="top-bar">
      <div className="hop-logo">H</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Link
          href="/profile"
          title="Your Profile"
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            background: "var(--surface-hover)",
            border: "1px solid var(--border)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            textDecoration: "none",
          }}
        >
          👤
        </Link>
        <LogoutButton />
      </div>
    </div>
  );
}
