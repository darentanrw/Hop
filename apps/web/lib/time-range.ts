export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 48;
export const MIN_DURATION_SLOTS = 2;

function localDateFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function getDefaultDateInput(daysFromToday = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDefaultRange() {
  return {
    startSlot: 36,
    endSlot: 40,
  };
}

export function clampSlot(slot: number) {
  return Math.max(0, Math.min(SLOTS_PER_DAY - 1, Math.round(slot)));
}

export function clampRange(startSlot: number, endSlot: number) {
  const nextStart = clampSlot(startSlot);
  const nextEnd = Math.max(
    nextStart + MIN_DURATION_SLOTS,
    Math.min(SLOTS_PER_DAY, Math.round(endSlot)),
  );

  if (nextEnd > SLOTS_PER_DAY) {
    return {
      startSlot: Math.max(0, SLOTS_PER_DAY - MIN_DURATION_SLOTS),
      endSlot: SLOTS_PER_DAY,
    };
  }

  return {
    startSlot: nextStart,
    endSlot: nextEnd,
  };
}

export function updateRangeForHandle(
  handle: "start" | "end",
  nextSlot: number,
  current: { startSlot: number; endSlot: number },
) {
  if (handle === "start") {
    return clampRange(nextSlot, current.endSlot);
  }

  return clampRange(current.startSlot, nextSlot);
}

export function slotToClockParts(slot: number) {
  const clamped = Math.max(0, Math.min(SLOTS_PER_DAY, slot));
  const totalMinutes = clamped * SLOT_MINUTES;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return { hour, minute };
}

export function slotToLabel(slot: number) {
  const { hour, minute } = slotToClockParts(slot);
  return localDateFromParts(2026, 1, 1, hour, minute).toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function slotOptions() {
  return Array.from({ length: SLOTS_PER_DAY + 1 }, (_, slot) => ({
    value: slot,
    label: slotToLabel(slot),
  }));
}

export function slotsToIsoRange(dateInput: string, startSlot: number, endSlot: number) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const startParts = slotToClockParts(startSlot);
  const endParts = slotToClockParts(endSlot);

  return {
    windowStart: localDateFromParts(
      year,
      month,
      day,
      startParts.hour,
      startParts.minute,
    ).toISOString(),
    windowEnd: localDateFromParts(year, month, day, endParts.hour, endParts.minute).toISOString(),
  };
}

export function formatRangeSummary(dateInput: string, startSlot: number, endSlot: number) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const start = slotToClockParts(startSlot);
  const end = slotToClockParts(endSlot);
  const baseDate = localDateFromParts(year, month, day, start.hour, start.minute);
  const endDate = localDateFromParts(year, month, day, end.hour, end.minute);

  const dateLabel = baseDate.toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startLabel = baseDate.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
  const endLabel = endDate.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });

  return `${dateLabel}, ${startLabel} - ${endLabel}`;
}

export function slotFromPointerPosition(clientX: number, trackLeft: number, trackWidth: number) {
  if (trackWidth <= 0) return 0;
  const normalized = Math.max(0, Math.min(1, (clientX - trackLeft) / trackWidth));
  return Math.round(normalized * SLOTS_PER_DAY);
}
