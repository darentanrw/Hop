"use client";

import React, { useEffect, useState } from "react";
import "./animated-car.css";

export function AnimatedCar({ isHopping = false }: { isHopping?: boolean }) {
  const [introStage, setIntroStage] = useState(0);
  const [outroStage, setOutroStage] = useState(0);

  useEffect(() => {
    if (isHopping) {
      setOutroStage(1);
      const t1 = setTimeout(() => setOutroStage(2), 300);
      const t2 = setTimeout(() => setOutroStage(3), 600);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    const t1 = setTimeout(() => setIntroStage(1), 2200);
    const t2 = setTimeout(() => setIntroStage(2), 3200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isHopping]);

  const doorsOpen = introStage >= 1 && outroStage < 2;
  const userVisible = introStage >= 2 || outroStage >= 1;
  const userSolid = outroStage >= 1;
  const speedOff = outroStage >= 3;

  return (
    <div className="car-scene" aria-hidden="true">
      <div className={`car-mover ${speedOff ? "speed-off" : ""}`}>
        <div
          className={`car-wrapper ${doorsOpen ? "doors-open" : ""} ${userVisible ? "user-visible" : ""} ${userSolid ? "user-solid" : ""}`}
        >
          <svg viewBox="0 0 300 120" className="car-svg" aria-label="Animated car arriving">
            <title>Animated car graphic</title>
            <defs>
              <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#cbd5e1" />
              </linearGradient>
              <linearGradient id="bumperGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <linearGradient id="headlampGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(255, 235, 150, 0.6)" />
                <stop offset="100%" stopColor="rgba(255, 235, 150, 0)" />
              </linearGradient>
              <linearGradient id="glassGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(8, 12, 24, 0.9)" />
                <stop offset="100%" stopColor="rgba(8, 12, 24, 0.7)" />
              </linearGradient>
              <linearGradient id="glassGradLight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.6)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0.3)" />
              </linearGradient>
              <clipPath id="wheel-clip">
                <rect x="0" y="88" width="300" height="50" />
              </clipPath>
              <clipPath id="wheel-clip-rear">
                <rect x="0" y="84" width="300" height="50" />
              </clipPath>
            </defs>

            {/* Shadow */}
            <ellipse
              cx="140"
              cy="110"
              rx="110"
              ry="12"
              fill="rgba(0, 0, 0, 0.3)"
              filter="blur(4px)"
              className="car-shadow-svg"
            />

            {/* CAR CHASSIS (Background / Right Side / Wheels) */}
            <g className="car-chassis">
              {/* Right side background (visible through windows) */}
              <path
                d="M 105 35 L 175 35 L 205 60 L 220 60 L 220 85 L 60 85 L 60 55 Z"
                fill="#94a3b8"
                opacity="0.3"
              />
              {/* Wheels (Back/Right) */}
              <g clipPath="url(#wheel-clip-rear)">
                <ellipse cx="85" cy="85" rx="16" ry="18" fill="#080c18" />
                <ellipse cx="185" cy="85" rx="16" ry="18" fill="#080c18" />
              </g>
              {/* Wheels (Front/Left) */}
              <g clipPath="url(#wheel-clip)">
                <ellipse
                  cx="75"
                  cy="92"
                  rx="18"
                  ry="20"
                  fill="#151a2e"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <ellipse cx="75" cy="92" rx="8" ry="10" fill="var(--accent)" />

                <ellipse
                  cx="195"
                  cy="92"
                  rx="18"
                  ry="20"
                  fill="#151a2e"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <ellipse cx="195" cy="92" rx="8" ry="10" fill="var(--accent)" />
              </g>
              {/* Lower Body Panel (Skirts & Bumpers) */}
              {/* Main undercarriage shadow/skirt */}
              <path
                d="M 45 86 L 220 92 L 230 85 L 235 60 L 215 55 L 55 55 L 35 60 Z"
                fill="var(--surface-active)"
              />
              {/* Front Bumper & Grille (Right-facing) */}
              <path d="M 225 60 L 240 57 L 235 85 L 220 92 Z" fill="url(#bumperGrad)" />
              <path d="M 228 65 L 238 63 L 236 78 L 226 80 Z" fill="#080c18" /> {/* Grille */}
              {/* Headlamp Beam */}
              <path d="M 230 66 L 300 49 L 300 89 L 228 74 Z" fill="url(#headlampGrad)" />
              <ellipse cx="229" cy="70" rx="2.5" ry="4" fill="#ffeb96" filter="blur(1px)" />{" "}
              {/* Headlight glow */}
              <path d="M 227 67 L 232 66 L 231 74 L 226 75 Z" fill="#ffeb96" /> {/* Headlight */}
              {/* Rear Bumper (Left-facing) */}
              <path d="M 35 60 L 50 56 L 50 82 L 40 88 Z" fill="url(#bumperGrad)" />
              <path d="M 38 65 L 43 64 L 43 72 L 38 74 Z" fill="var(--danger)" /> {/* Taillight */}
              <ellipse
                cx="40"
                cy="68"
                rx="4"
                ry="8"
                fill="var(--danger)"
                filter="blur(2px)"
                opacity="0.6"
              />{" "}
              {/* Tail glow */}
            </g>

            {/* WINDSHIELDS */}
            <g className="car-glass">
              {/* Front Windshield */}
              <path
                d="M 160 30 L 200 58 L 165 58 L 145 30 Z"
                fill="url(#glassGrad)"
                className="glass-dark"
              />
              <path
                d="M 160 30 L 200 58 L 165 58 L 145 30 Z"
                fill="url(#glassGradLight)"
                className="glass-light"
              />

              {/* Rear Windshield */}
              <path
                d="M 95 30 L 105 30 L 80 58 L 55 58 Z"
                fill="url(#glassGrad)"
                className="glass-dark"
              />
              <path
                d="M 95 30 L 105 30 L 80 58 L 55 58 Z"
                fill="url(#glassGradLight)"
                className="glass-light"
              />
            </g>

            {/* BACKGROUND / INTERIOR (Revealed when doors open) */}
            {/* Moved AFTER car-chassis and car-glass so passengers are drawn on top of the windshields */}
            <g className="car-interior">
              {/* Back wall of interior */}
              <path d="M 100 45 L 180 45 L 185 85 L 90 85 Z" fill="var(--bg)" />

              {/* Steering wheel & Dash */}
              <path d="M 185 55 L 195 55 L 195 70 L 185 70 Z" fill="var(--surface-active)" />
              <ellipse
                cx="185"
                cy="60"
                rx="4"
                ry="12"
                fill="var(--text-muted)"
                transform="rotate(15 185 60)"
              />

              {/* FAR SIDE (Right side of car) */}
              {/* Far Rear Seat */}
              <path
                d="M 105 40 L 108 65 L 122 65 L 122 60 L 110 60 L 107 40 Z"
                fill="var(--surface-active)"
              />
              {/* Far Rear Passenger */}
              <g className="passenger far-rear">
                <circle cx="112" cy="42" r="4.5" fill="#64748b" />
                <path
                  d="M 107 48 C 107 55, 109 65, 109 65 L 119 65 L 119 56 C 113 56, 114 50, 116 48 Z"
                  fill="#64748b"
                />
              </g>

              {/* Far Front Seat (Driver) */}
              <path
                d="M 158 40 L 161 65 L 175 65 L 175 60 L 163 60 L 160 40 Z"
                fill="var(--surface-active)"
              />
              {/* Far Front Passenger */}
              <g className="passenger far-front">
                <circle cx="165" cy="42" r="4.5" fill="#64748b" />
                <path
                  d="M 160 48 C 160 55, 162 65, 162 65 L 172 65 L 172 56 C 166 56, 167 50, 169 48 Z"
                  fill="#64748b"
                />
              </g>

              {/* NEAR SIDE (Left side of car, facing viewer) */}
              {/* Near Front Seat */}
              <path
                d="M 144 47 L 147 75 L 164 75 L 164 68 L 150 68 L 147 47 Z"
                fill="var(--surface-hover)"
              />
              {/* Near Front Passenger */}
              <g className="passenger near-front">
                <circle cx="153" cy="50" r="5" fill="#94a3b8" />
                <path
                  d="M 147 57 C 147 65, 149 75, 149 75 L 161 75 L 161 65 C 154 65, 155 59, 158 57 Z"
                  fill="#94a3b8"
                />
              </g>

              {/* Near Rear Seat (User's Seat) */}
              <path
                d="M 90 47 L 93 75 L 110 75 L 110 68 L 96 68 L 93 47 Z"
                fill="var(--surface-hover)"
              />
              {/* Missing User Outline */}
              <g className="passenger near-rear-missing">
                <circle
                  cx="99"
                  cy="50"
                  r="5"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                />
                <path
                  d="M 93 57 C 93 65, 95 75, 95 75 L 107 75 L 107 65 C 100 65, 101 59, 104 57 Z"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                />
              </g>
            </g>

            {/* MAIN BODY (Fixed panels) */}
            <g className="car-body" stroke="#cbd5e1" strokeWidth="0.5" strokeLinejoin="round">
              {/* Roof & Pillars */}
              <path
                d="M 95 30 L 165 30 L 205 60 L 215 60 L 160 25 L 90 25 L 45 55 L 55 60 Z"
                fill="url(#bodyGrad)"
              />
              <path d="M 130 30 L 130 60 L 140 60 L 140 30 Z" fill="url(#bodyGrad)" />{" "}
              {/* B-Pillar */}
              {/* Hood */}
              <path d="M 165 55 L 215 55 L 240 57 L 225 60 L 180 60 Z" fill="url(#bodyGrad)" />
              {/* Trunk */}
              <path d="M 45 55 L 95 55 L 85 60 L 35 60 Z" fill="url(#bodyGrad)" />
              {/* Left Quarter Panel (Rear) */}
              <path d="M 35 60 L 85 60 L 85 85 L 40 88 Z" fill="url(#bodyGrad)" />
              {/* Left Fender (Front) */}
              <path d="M 180 60 L 225 60 L 220 92 L 180 89 Z" fill="url(#bodyGrad)" />
              {/* Lower Skirt (Under Doors) */}
              <path d="M 85 85 L 180 89 L 180 94 L 85 90 Z" fill="url(#bodyGrad)" />
            </g>

            {/* OPENING DOORS */}

            {/* Rear Left Door */}
            <g className="car-door rear-door">
              {/* Door Panel */}
              <path
                d="M 85 60 L 132 60 L 132 88 L 85 85 Z"
                fill="url(#bodyGrad)"
                stroke="#cbd5e1"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
              {/* Door Window */}
              <path
                d="M 97 30 L 130 30 L 130 58 L 82 58 Z"
                fill="url(#glassGrad)"
                className="glass-dark"
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M 97 30 L 130 30 L 130 58 L 82 58 Z"
                fill="url(#glassGradLight)"
                className="glass-light"
                stroke="#cbd5e1"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {/* Handle */}
              <line
                x1="120"
                y1="65"
                x2="128"
                y2="65"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>

            {/* Front Left Door */}
            <g className="car-door front-door">
              {/* Door Panel */}
              <path
                d="M 132 60 L 180 60 L 180 90 L 132 88 Z"
                fill="url(#bodyGrad)"
                stroke="#cbd5e1"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
              {/* Door Window */}
              <path
                d="M 132 30 L 160 30 L 178 58 L 132 58 Z"
                fill="url(#glassGrad)"
                className="glass-dark"
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M 132 30 L 160 30 L 178 58 L 132 58 Z"
                fill="url(#glassGradLight)"
                className="glass-light"
                stroke="#cbd5e1"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {/* Handle */}
              <line
                x1="170"
                y1="65"
                x2="178"
                y2="65"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
