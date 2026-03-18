import Link from "next/link";
import { ThemeToggle } from "../components/theme-toggle";
import { TypingTagline } from "../components/typing-tagline";

export default function LandingPage() {
  return (
    <div className="landing">
      <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div className="landing-content">
        <div className="landing-logo" aria-label="Hop">
          H
        </div>

        <TypingTagline />

        <div className="landing-features">
          <div className="landing-feature">
            <div className="landing-feature-icon icon-privacy">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
              </svg>
            </div>
            <span className="landing-feature-label">Encrypted</span>
          </div>

          <div className="landing-feature">
            <div className="landing-feature-icon icon-anon">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M5.5 21a8.38 8.38 0 0113 0" />
              </svg>
            </div>
            <span className="landing-feature-label">Anonymous</span>
          </div>

          <div className="landing-feature">
            <div className="landing-feature-icon icon-campus">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 20h20M5 20V8l7-5 7 5v12" />
                <rect x="9" y="12" width="6" height="8" rx="1" />
              </svg>
            </div>
            <span className="landing-feature-label">NUS only</span>
          </div>
        </div>

        <div className="landing-cta">
          <Link href="/login" className="btn btn-primary">
            Get started
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <p className="landing-signin">
            Already in? <Link href="/dashboard">Go to dashboard</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
