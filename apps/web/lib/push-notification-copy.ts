import { formatStoredWindowWithDate } from "./time-range";

type RideWindow = {
  windowStart: string;
  windowEnd: string;
};

type MatchPushCopyOptions = RideWindow & {
  isFullGroup: boolean;
  isLastMinuteGroup: boolean;
  remainingSeats: number;
  meetingLocationLabel: string;
};

export function formatRideWindowForPush(windowStart: string, windowEnd: string) {
  return formatStoredWindowWithDate(windowStart, windowEnd);
}

export function buildMatchedPushCopy({
  windowStart,
  windowEnd,
  isFullGroup,
  isLastMinuteGroup,
  remainingSeats,
  meetingLocationLabel,
}: MatchPushCopyOptions) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  if (isFullGroup) {
    return {
      title: "Ride matched",
      body: `Your ${rideLabel} ride is full. Confirm within 30 minutes so Hop can lock in the meetup at ${meetingLocationLabel}.`,
    };
  }

  if (isLastMinuteGroup) {
    return {
      title: "Ride matched",
      body: `Your ${rideLabel} ride starts within 3 hours. Confirm within 30 minutes so Hop can lock in the meetup at ${meetingLocationLabel}.`,
    };
  }

  return {
    title: "Ride matched",
    body: `Your ${rideLabel} ride has room for ${remainingSeats} more passenger${remainingSeats === 1 ? "" : "s"} until 3 hours before departure or until the car is full.`,
  };
}

export function buildLockedPushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride locked",
    body: `Confirm your ${rideLabel} ride within 30 minutes to keep your spot.`,
  };
}

export function buildConfirmedPushCopy({
  windowStart,
  windowEnd,
  meetingLocationLabel,
}: RideWindow & { meetingLocationLabel: string }) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride confirmed",
    body: `Your ${rideLabel} ride is confirmed. Get ready to meet at ${meetingLocationLabel}.`,
  };
}

export function buildMovedOnWithoutYouPushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride continued without you",
    body: `Your ${rideLabel} ride continued with the riders who acknowledged in time. You can look for another Hop ride.`,
  };
}

export function buildCouldNotConfirmPushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride could not be confirmed",
    body: `Not enough riders acknowledged in time for your ${rideLabel} ride. You can head back into the queue for another ride.`,
  };
}

export function buildRemovedFromRidePushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Removed from ride",
    body: `You were removed from your ${rideLabel} ride because your attendance was not verified during the meetup grace period.`,
  };
}

export function buildPaymentRequestedPushCopy({
  windowStart,
  windowEnd,
  amountLabel,
}: RideWindow & { amountLabel: string }) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Payment proof due",
    body: `Upload proof of your ${amountLabel} payment for your ${rideLabel} ride within 24 hours.`,
  };
}

export function buildLateJoinPushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride updated",
    body: `Another rider joined your ${rideLabel} ride.`,
  };
}

export function buildBookerChangedPushCopy({ windowStart, windowEnd }: RideWindow) {
  const rideLabel = formatRideWindowForPush(windowStart, windowEnd);

  return {
    title: "Ride updated",
    body: `The booker for your ${rideLabel} ride has changed.`,
  };
}
