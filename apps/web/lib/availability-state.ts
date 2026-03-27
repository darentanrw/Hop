type AvailabilityLike = {
  status: string;
  windowEnd: string;
};

export function isAvailabilityVisibleInWindows(
  availability: AvailabilityLike,
  now: number = Date.now(),
) {
  return availability.status !== "cancelled" && new Date(availability.windowEnd).getTime() > now;
}

export function isCurrentOpenAvailability(
  availability: AvailabilityLike,
  now: number = Date.now(),
) {
  return availability.status === "open" && isAvailabilityVisibleInWindows(availability, now);
}
