export type DestinationLabelCache = Record<string, string>;

const DESTINATION_LABEL_STORAGE_KEY = "hop-destination-labels";
const DEFAULT_DESTINATION_LABEL = "Your destination";

function parseDestinationLabelCache(raw: string | null): DestinationLabelCache {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          typeof entry[1] === "string" &&
          entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function loadDestinationLabelCache(): DestinationLabelCache {
  if (typeof window === "undefined") return {};

  try {
    return parseDestinationLabelCache(window.localStorage.getItem(DESTINATION_LABEL_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function persistDestinationLabel(sealedDestinationRef: string, address: string) {
  const trimmedAddress = address.trim();
  if (typeof window === "undefined" || !sealedDestinationRef || !trimmedAddress) return;

  try {
    const current = loadDestinationLabelCache();
    window.localStorage.setItem(
      DESTINATION_LABEL_STORAGE_KEY,
      JSON.stringify({
        ...current,
        [sealedDestinationRef]: trimmedAddress,
      }),
    );
  } catch {}
}

export function resolveDestinationLabel(
  sealedDestinationRef: string,
  cachedLabels: DestinationLabelCache = {},
) {
  return cachedLabels[sealedDestinationRef]?.trim() || DEFAULT_DESTINATION_LABEL;
}
