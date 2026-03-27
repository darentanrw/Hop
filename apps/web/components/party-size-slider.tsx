"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type PartySizeValue, pointerXToPartySize } from "../lib/party-size-pointer";

export type { PartySizeValue } from "../lib/party-size-pointer";

type PartySizeSliderProps = {
  value: PartySizeValue;
  onChange: (value: PartySizeValue) => void;
};

export function PartySizeSlider({ value, onChange }: PartySizeSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const index = value - 1;
  const handlePercent = (index / 2) * 100;
  const fillWidthPercent = (index / 2) * 100;

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const r = track.getBoundingClientRect();
      const next = pointerXToPartySize(clientX, {
        left: r.left,
        width: r.width,
      });
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      setFromClientX(e.clientX);
    }
    function onUp() {
      setDragging(false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, setFromClientX]);

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setFromClientX(e.clientX);
    setDragging(true);
  }

  function onHandleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      if (value > 1) onChange((value - 1) as PartySizeValue);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      if (value < 3) onChange((value + 1) as PartySizeValue);
    }
  }

  const tickPercents = [0, 50, 100];

  return (
    <div className="time-range-picker stack-sm" style={{ marginTop: 8 }}>
      <div className="time-range-summary">
        <span className="pill pill-accent pill-sm">Party</span>
        <div className="time-range-summary-copy">
          <strong>{value === 1 ? "Just me" : value === 2 ? "2 people" : "3 people"}</strong>
          <span>Travelling on this booking</span>
        </div>
      </div>

      <div className="time-range-track-shell">
        <div
          ref={trackRef}
          className="time-range-track"
          onPointerDown={onTrackPointerDown}
          role="presentation"
        >
          <div
            className="time-range-fill"
            style={{
              left: 0,
              width: `${fillWidthPercent}%`,
            }}
          />
          {tickPercents.map((pct) => (
            <div key={pct} className="time-range-tick" style={{ left: `${pct}%` }} />
          ))}
          <button
            type="button"
            className={`time-range-handle ${dragging ? "active" : ""}`}
            style={{ left: `${handlePercent}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragging(true);
            }}
            onKeyDown={onHandleKeyDown}
            aria-label="Party size"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={value}
            role="slider"
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          color: "var(--text-muted)",
          fontSize: 11,
        }}
      >
        <span style={{ textAlign: "left" }}>Just me</span>
        <span style={{ textAlign: "center" }}>2 people</span>
        <span style={{ textAlign: "right" }}>3 people</span>
      </div>
    </div>
  );
}
