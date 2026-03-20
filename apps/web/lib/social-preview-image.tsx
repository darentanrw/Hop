import type React from "react";

export function SocialPreviewImage() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top left, rgba(68, 212, 200, 0.26), transparent 34%), linear-gradient(135deg, #050816 0%, #0a1228 56%, #111b36 100%)",
        color: "#f8fafc",
        fontFamily: "Plus Jakarta Sans, Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(120deg, rgba(255, 255, 255, 0.04), transparent 30%, transparent 70%, rgba(68, 212, 200, 0.08))",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: -120,
          right: -80,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(68, 212, 200, 0.28), rgba(68, 212, 200, 0))",
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: -180,
          left: -140,
          width: 460,
          height: 460,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255, 184, 107, 0.18), rgba(255, 184, 107, 0))",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          padding: "72px 78px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            maxWidth: 760,
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#8cebe1",
              textTransform: "uppercase",
              letterSpacing: "0.22em",
            }}
          >
            Hop
          </span>
          <span
            style={{
              fontSize: 92,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: "-0.07em",
            }}
          >
            Ride-Sharing Home for NUS Students
          </span>
          <span
            style={{
              fontSize: 34,
              lineHeight: 1.3,
              color: "#d6deef",
              letterSpacing: "-0.03em",
              maxWidth: 700,
            }}
          >
            Addresses and identities remain private.
          </span>
        </div>
      </div>
    </div>
  );
}
