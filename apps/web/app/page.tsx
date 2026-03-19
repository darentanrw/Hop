"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatedCar } from "../components/animated-car";
import { ThemeToggle } from "../components/theme-toggle";
import { TypingTagline } from "../components/typing-tagline";

export default function LandingPage() {
  const [isHopping, setIsHopping] = useState(false);
  const router = useRouter();

  const handleHop = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (isHopping) return;
    setIsHopping(true);

    router.prefetch("/login");

    setTimeout(() => {
      router.push("/login");
    }, 1500);
  };

  return (
    <div className="landing">
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          transition: "opacity 0.5s",
          opacity: isHopping ? 0 : 1,
        }}
      >
        <ThemeToggle />
      </div>

      <div className="landing-content">
        <div style={{ transition: "opacity 0.5s", opacity: isHopping ? 0 : 1, width: "100%" }}>
          <TypingTagline />
        </div>

        <AnimatedCar isHopping={isHopping} />

        <div
          className="landing-cta"
          style={{
            transition: "opacity 0.5s",
            opacity: isHopping ? 0 : 1,
            pointerEvents: isHopping ? "none" : "auto",
            animation: isHopping ? "none" : undefined,
          }}
        >
          <Link href="/login" onClick={handleHop} className="btn btn-primary">
            Let&apos;s Hop
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
        </div>
      </div>
    </div>
  );
}
