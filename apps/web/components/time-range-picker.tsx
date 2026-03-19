"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MIN_DURATION_SLOTS,
  SLOTS_PER_DAY,
  clampRange,
  formatRangeSummary,
  getMinDateInput,
  slotFromPointerPosition,
  slotOptions,
  updateRangeForHandle,
} from "../lib/time-range";

type TimeRangePickerProps = {
  dateInput: string;
  startSlot: number;
  endSlot: number;
  minSlot?: number;
  onDateInputChange: (value: string) => void;
  onRangeChange: (next: { startSlot: number; endSlot: number }) => void;
};

type ActiveHandle = "start" | "end" | null;

const tickSlots = [0, 8, 16, 24, 32, 40, 48];

export function TimeRangePicker({
  dateInput,
  startSlot,
  endSlot,
  minSlot = 0,
  onDateInputChange,
  onRangeChange,
}: TimeRangePickerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeHandle, setActiveHandle] = useState<ActiveHandle>(null);
  const options = useMemo(() => slotOptions(), []);

  useEffect(() => {
    if (!activeHandle) return;
    const handle = activeHandle;

    function handlePointerMove(event: PointerEvent) {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const slot = slotFromPointerPosition(event.clientX, rect.left, rect.width);
      onRangeChange(updateRangeForHandle(handle, slot, { startSlot, endSlot }, minSlot));
    }

    function handlePointerUp() {
      setActiveHandle(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeHandle, endSlot, minSlot, onRangeChange, startSlot]);

  const startPercent = (startSlot / SLOTS_PER_DAY) * 100;
  const endPercent = (endSlot / SLOTS_PER_DAY) * 100;
  const rangeSummary = formatRangeSummary(dateInput, startSlot, endSlot);

  function moveHandle(handle: "start" | "end", nextSlot: number) {
    onRangeChange(updateRangeForHandle(handle, nextSlot, { startSlot, endSlot }, minSlot));
  }

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const slot = slotFromPointerPosition(event.clientX, rect.left, rect.width);
    const nearestHandle = Math.abs(slot - startSlot) <= Math.abs(slot - endSlot) ? "start" : "end";
    onRangeChange(updateRangeForHandle(nearestHandle, slot, { startSlot, endSlot }, minSlot));
    setActiveHandle(nearestHandle);
  }

  function handleKeyDown(handle: "start" | "end", event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 2 : 1;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    moveHandle(
      handle,
      (handle === "start" ? startSlot : endSlot) + (event.key === "ArrowLeft" ? -step : step),
    );
  }

  const normalized = clampRange(startSlot, endSlot, minSlot);
  const minDateStr = getMinDateInput();

  return (
    <div className="time-range-picker stack-sm">
      <div className="stack-xs">
        <label htmlFor="avail-date">Ride date</label>
        <input
          id="avail-date"
          type="date"
          value={dateInput}
          min={minDateStr}
          onChange={(event) => onDateInputChange(event.target.value)}
          required
        />
      </div>

      <div className="time-range-summary">
        <span className="pill pill-accent pill-sm">Window</span>
        <strong>{rangeSummary}</strong>
      </div>

      <div className="time-range-track-shell">
        <div ref={trackRef} className="time-range-track" onPointerDown={handleTrackPointerDown}>
          <div
            className="time-range-fill"
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
          />
          {tickSlots.map((slot) => (
            <div
              key={slot}
              className="time-range-tick"
              style={{ left: `${(slot / SLOTS_PER_DAY) * 100}%` }}
            />
          ))}
          <button
            type="button"
            className={`time-range-handle ${activeHandle === "start" ? "active" : ""}`}
            style={{ left: `${startPercent}%` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              setActiveHandle("start");
            }}
            onKeyDown={(event) => handleKeyDown("start", event)}
            aria-label="Adjust start time"
            aria-valuemin={minSlot}
            aria-valuemax={normalized.endSlot - MIN_DURATION_SLOTS}
            aria-valuenow={normalized.startSlot}
          />
          <button
            type="button"
            className={`time-range-handle ${activeHandle === "end" ? "active" : ""}`}
            style={{ left: `${endPercent}%` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              setActiveHandle("end");
            }}
            onKeyDown={(event) => handleKeyDown("end", event)}
            aria-label="Adjust end time"
            aria-valuemin={Math.max(
              minSlot + MIN_DURATION_SLOTS,
              normalized.startSlot + MIN_DURATION_SLOTS,
            )}
            aria-valuemax={SLOTS_PER_DAY}
            aria-valuenow={normalized.endSlot}
          />
        </div>
      </div>

      <div className="time-range-ticks">
        {tickSlots.map((slot) => (
          <span key={`label-${slot}`}>
            {options.find((option) => option.value === slot)?.label}
          </span>
        ))}
      </div>

      <div className="grid-2">
        <div className="stack-xs">
          <label htmlFor="avail-start-slot">Start time</label>
          <select
            id="avail-start-slot"
            value={startSlot}
            onChange={(event) => moveHandle("start", Number(event.target.value))}
          >
            {options
              .filter(
                (option) => option.value >= minSlot && option.value <= endSlot - MIN_DURATION_SLOTS,
              )
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
        </div>
        <div className="stack-xs">
          <label htmlFor="avail-end-slot">End time</label>
          <select
            id="avail-end-slot"
            value={endSlot}
            onChange={(event) => moveHandle("end", Number(event.target.value))}
          >
            {options
              .filter(
                (option) =>
                  option.value >=
                  Math.max(minSlot + MIN_DURATION_SLOTS, startSlot + MIN_DURATION_SLOTS),
              )
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
        </div>
      </div>
    </div>
  );
}
