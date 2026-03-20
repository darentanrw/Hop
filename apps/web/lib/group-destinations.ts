import { sortOpaqueDestinationEntries } from "@hop/shared";

type AvailabilityDestination = {
  createdAt?: string;
  sealedDestinationRef: string;
};

type GroupDestinationMember = {
  availabilityId: string;
  userId: string;
};

type LockedGroupDestination = {
  availabilityId: string;
  destinationAddress?: string;
  destinationLockedAt: string;
  destinationSubmittedAt: string;
  dropoffOrder: number;
  userId: string;
};

export function buildLockedGroupDestinations(
  members: GroupDestinationMember[],
  availabilityById: Map<string, AvailabilityDestination>,
) {
  const sortable = members.map((member) => {
    const availability = availabilityById.get(member.availabilityId);
    if (!availability) {
      throw new Error(`Availability ${member.availabilityId} is missing its destination details.`);
    }

    const destinationLockedAt = availability.createdAt ?? new Date().toISOString();

    return {
      availabilityId: member.availabilityId,
      destinationAddress: undefined,
      destinationLockedAt,
      destinationSubmittedAt: destinationLockedAt,
      sealedDestinationRef: availability.sealedDestinationRef,
      stableId: member.userId,
      secondaryStableId: member.availabilityId,
      userId: member.userId,
    };
  });

  const ordered = sortOpaqueDestinationEntries(sortable);

  return ordered.map<LockedGroupDestination>(
    (
      {
        sealedDestinationRef: _sealedDestinationRef,
        stableId: _stableId,
        secondaryStableId: _secondaryStableId,
        ...member
      },
      index,
    ) => ({
      ...member,
      dropoffOrder: index + 1,
    }),
  );
}
