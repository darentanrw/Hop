import { formatStoredMeetingTimeWithDate } from "./time-range";

type RideMeeting = {
  meetingTime: string;
};

type MatchPushCopyOptions = RideMeeting & {
  isFullGroup: boolean;
  isLastMinuteGroup: boolean;
  remainingSeats: number;
  meetingLocationLabel: string;
};

export function formatRideMeetingTimeForPush(meetingTime: string) {
  return formatStoredMeetingTimeWithDate(meetingTime);
}

export function buildMatchedPushCopy({
  meetingTime,
  isFullGroup,
  isLastMinuteGroup,
  remainingSeats,
  meetingLocationLabel,
}: MatchPushCopyOptions) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

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

export function buildLockedPushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride locked",
    body: `Confirm your ${rideLabel} ride within 30 minutes to keep your spot.`,
  };
}

export function buildConfirmedPushCopy({
  meetingTime,
  meetingLocationLabel,
}: RideMeeting & { meetingLocationLabel: string }) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride confirmed",
    body: `Your ${rideLabel} ride is confirmed. Get ready to meet at ${meetingLocationLabel}.`,
  };
}

export function buildMovedOnWithoutYouPushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride continued without you",
    body: `Your ${rideLabel} ride continued with the riders who acknowledged in time. You can look for another Hop ride.`,
  };
}

export function buildCouldNotConfirmPushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride could not be confirmed",
    body: `Not enough riders acknowledged in time for your ${rideLabel} ride. You can head back into the queue for another ride.`,
  };
}

export function buildRemovedFromRidePushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Removed from ride",
    body: `You were removed from your ${rideLabel} ride because your attendance was not verified during the meetup grace period.`,
  };
}

export function buildPaymentRequestedPushCopy({
  meetingTime,
  amountLabel,
}: RideMeeting & { amountLabel: string }) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Payment proof due",
    body: `Upload proof of your ${amountLabel} payment for your ${rideLabel} ride within 24 hours.`,
  };
}

export function buildLateJoinPushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride updated",
    body: `Another rider joined your ${rideLabel} ride.`,
  };
}

export function buildBookerChangedPushCopy({ meetingTime }: RideMeeting) {
  const rideLabel = formatRideMeetingTimeForPush(meetingTime);

  return {
    title: "Ride updated",
    body: `The booker for your ${rideLabel} ride has changed.`,
  };
}
