export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 48;
export const MIN_DURATION_SLOTS = 2;

export const SINGAPORE_TIME_ZONE = "Asia/Singapore";
const SINGAPORE_OFFSET_HOURS = 8;

const timeFormatter = new Intl.DateTimeFormat("en-SG", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SINGAPORE_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: SINGAPORE_TIME_ZONE,
});

const weekdayFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  timeZone: SINGAPORE_TIME_ZONE,
});

const inputDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: SINGAPORE_TIME_ZONE,
});

function singaporeDateFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(Date.UTC(year, month - 1, day, hour - SINGAPORE_OFFSET_HOURS, minute, 0, 0));
}

export function getDefaultDateInput(daysFromToday = 1) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return inputDateFormatter.format(date);
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
  return timeFormatter.format(singaporeDateFromParts(2026, 1, 1, hour, minute));
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
    windowStart: singaporeDateFromParts(
      year,
      month,
      day,
      startParts.hour,
      startParts.minute,
    ).toISOString(),
    windowEnd: singaporeDateFromParts(
      year,
      month,
      day,
      endParts.hour,
      endParts.minute,
    ).toISOString(),
  };
}

export function formatRangeSummary(dateInput: string, startSlot: number, endSlot: number) {
  const { dateLabel, timeLabel } = formatRangeSummaryParts(dateInput, startSlot, endSlot);
  return `${dateLabel}, ${timeLabel}`;
}

export function formatRangeSummaryParts(dateInput: string, startSlot: number, endSlot: number) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const start = slotToClockParts(startSlot);
  const end = slotToClockParts(endSlot);
  const baseDate = singaporeDateFromParts(year, month, day, start.hour, start.minute);
  const endDate = singaporeDateFromParts(year, month, day, end.hour, end.minute);

  const dateLabel = dateFormatter.format(baseDate);
  const startLabel = timeFormatter.format(baseDate);
  const endLabel = timeFormatter.format(endDate);

  return {
    dateLabel,
    timeLabel: `${startLabel} - ${endLabel}`,
  };
}

export function formatStoredWindow(windowStart: string, windowEnd: string) {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const dayLabel = weekdayFormatter.format(start);
  const startLabel = timeFormatter.format(start);
  const endLabel = timeFormatter.format(end);

  return `${dayLabel} ${startLabel} - ${endLabel}`;
}

export function slotFromPointerPosition(clientX: number, trackLeft: number, trackWidth: number) {
  if (trackWidth <= 0) return 0;
  const normalized = Math.max(0, Math.min(1, (clientX - trackLeft) / trackWidth));
  return Math.round(normalized * SLOTS_PER_DAY);
}
