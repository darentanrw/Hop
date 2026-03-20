import { type DestinationLabelCache, resolveDestinationLabel } from "./destination-storage";

const DEFAULT_GROUP_DESTINATION_LABEL = "Your destination";

export function resolveGroupDestinationLabel(
  member:
    | {
        destinationAddress?: string | null;
        sealedDestinationRef?: string | null;
      }
    | null
    | undefined,
  cachedLabels: DestinationLabelCache = {},
) {
  const explicitAddress = member?.destinationAddress?.trim();
  if (explicitAddress) return explicitAddress;

  const sealedDestinationRef = member?.sealedDestinationRef?.trim();
  if (sealedDestinationRef) {
    return resolveDestinationLabel(sealedDestinationRef, cachedLabels);
  }

  return DEFAULT_GROUP_DESTINATION_LABEL;
}
