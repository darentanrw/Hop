import React from "react";
import { siteMetadata } from "./site-metadata";

const featurePillStyle: React.CSSProperties = {
  borderRadius: 999,
  border: "1px solid rgba(181, 247, 241, 0.22)",
  background: "rgba(7, 15, 35, 0.5)",
  padding: "14px 22px",
  color: "#dffdf9",
  fontSize: 26,
  fontWeight: 600,
  letterSpacing: "-0.02em",
};

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
          justifyContent: "space-between",
          width: "100%",
          padding: "64px 68px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 84,
                height: 84,
                borderRadius: 28,
                background: "linear-gradient(135deg, #44d4c8 0%, #9af1e8 100%)",
                color: "#08111f",
                fontSize: 40,
                fontWeight: 800,
                letterSpacing: "-0.06em",
                boxShadow: "0 22px 60px rgba(68, 212, 200, 0.22)",
              }}
            >
              H
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 46,
                  fontWeight: 800,
                  letterSpacing: "-0.05em",
                }}
              >
                Hop
              </span>
              <span
                style={{
                  fontSize: 22,
                  color: "#98a8c8",
                  textTransform: "uppercase",
                  letterSpacing: "0.22em",
                }}
              >
                NUS Campus Rideshare
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 999,
              border: "1px solid rgba(68, 212, 200, 0.24)",
              background: "rgba(10, 18, 40, 0.55)",
              padding: "14px 22px",
              color: "#b5f7f1",
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            Privacy First
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 940,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 78,
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: "-0.06em",
              }}
            >
              Get home with Hop
            </span>
            <span
              style={{
                fontSize: 32,
                lineHeight: 1.35,
                color: "#d6deef",
                letterSpacing: "-0.03em",
              }}
            >
              {siteMetadata.description}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div style={featurePillStyle}>Private matching</div>
            <div style={featurePillStyle}>Verified NUS sign-in</div>
            <div style={featurePillStyle}>Ride-day updates</div>
          </div>
        </div>
      </div>
    </div>
  );
}
