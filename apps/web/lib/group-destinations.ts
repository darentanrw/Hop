import { decodeStubDestinationRef } from "./matcher-stub";

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

function decodeLockedAddress(sealedDestinationRef: string) {
  if (!sealedDestinationRef.startsWith("stub:destination:")) {
    return undefined;
  }

  return decodeStubDestinationRef(sealedDestinationRef);
}

export function buildLockedGroupDestinations(
  members: GroupDestinationMember[],
  availabilityById: Map<string, AvailabilityDestination>,
) {
  const sortable = members.map((member) => {
    const availability = availabilityById.get(member.availabilityId);
    if (!availability) {
      throw new Error(`Availability ${member.availabilityId} is missing its destination details.`);
    }

    const destinationAddress = decodeLockedAddress(availability.sealedDestinationRef);
    const destinationLockedAt = availability.createdAt ?? new Date().toISOString();

    return {
      availabilityId: member.availabilityId,
      destinationAddress,
      destinationLockedAt,
      destinationSubmittedAt: destinationLockedAt,
      sortKey: (destinationAddress ?? availability.sealedDestinationRef).toLowerCase(),
      userId: member.userId,
    };
  });

  const ordered = [...sortable].sort(
    (left, right) =>
      left.sortKey.localeCompare(right.sortKey) ||
      left.userId.localeCompare(right.userId) ||
      left.availabilityId.localeCompare(right.availabilityId),
  );

  return ordered.map<LockedGroupDestination>(({ sortKey: _sortKey, ...member }, index) => ({
    ...member,
    dropoffOrder: index + 1,
  }));
}
