const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
const ONEMAP_ROUTE_URL = "https://www.onemap.gov.sg/api/public/routingsvc/route";
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export type GeocodedAddress = {
  lat: number;
  lng: number;
  postalCode: string;
  buildingName: string;
};

export type DrivingRoute = {
  distanceMeters: number;
  timeSeconds: number;
  polyline: Array<[number, number]>;
};

type OneMapSearchResponse = {
  found: number;
  results: Array<{
    LATITUDE: string;
    LONGITUDE: string;
    POSTAL: string;
    BUILDING: string;
  }>;
};

function hasValidPostalCode(postalCode: string | null | undefined) {
  return /^\d{6}$/.test(postalCode ?? "");
}

function normalizeCoordinatePair(pair: unknown): [number, number] | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const first = Number(pair[0]);
  const second = Number(pair[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  // Most geo APIs encode as [lng, lat].
  if (Math.abs(first) > 90 || Math.abs(second) <= 90) {
    return [second, first];
  }

  return [first, second];
}

function decodePolyline(encoded: string) {
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

function parseRouteGeometry(raw: unknown): Array<[number, number]> {
  if (Array.isArray(raw)) {
    return raw
      .map(normalizeCoordinatePair)
      .filter((point): point is [number, number] => point !== null);
  }

  if (raw && typeof raw === "object" && "coordinates" in raw) {
    return parseRouteGeometry((raw as { coordinates?: unknown }).coordinates);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseRouteGeometry(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return decodePolyline(trimmed);
  }

  return [];
}

let cachedToken: { token: string; expiresAt: number } | null = null;

const ROUTE_CACHE_TTL_MS = 30 * 60_000;
const ROUTE_CACHE_MAX = 2048;
const GEOCODE_CACHE_MAX = 512;

type RouteCacheEntry = { route: DrivingRoute; expiresAt: number };
const routeCache = new Map<string, RouteCacheEntry>();
const geocodeCache = new Map<string, GeocodedAddress | null>();
const inflightRoutes = new Map<string, Promise<DrivingRoute>>();

function routeCacheKey(startLat: number, startLng: number, endLat: number, endLng: number) {
  return `${startLat.toFixed(6)},${startLng.toFixed(6)}->${endLat.toFixed(6)},${endLng.toFixed(6)}`;
}

function geocodeCacheKey(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function evictOldest<V>(map: Map<string, V>, max: number) {
  while (map.size > max) {
    const first = map.keys().next();
    if (first.done) break;
    map.delete(first.value);
  }
}

function normalizeSearchTerm(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function buildSearchCandidates(query: string) {
  const normalized = normalizeSearchTerm(query);
  const candidates = [normalized];
  const dePunctuated = normalized
    .replace(/[.,;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (dePunctuated && dePunctuated !== normalized) {
    candidates.push(dePunctuated);
  }

  const postalMatch = normalized.match(/\b\d{6}\b/);
  if (postalMatch) {
    candidates.push(`Singapore ${postalMatch[0]}`);
    candidates.push(postalMatch[0]);
  }

  return [...new Set(candidates)];
}

async function searchAddress(query: string): Promise<OneMapSearchResponse> {
  const url = `${ONEMAP_SEARCH_URL}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
    }

    const response = await fetch(url);

    if (response.status === 429) {
      lastError = new Error("OneMap search failed: 429");
      continue;
    }

    if (!response.ok) {
      throw new Error(`OneMap search failed: ${response.status}`);
    }

    return (await response.json()) as OneMapSearchResponse;
  }

  throw lastError ?? new Error("OneMap search failed after retries");
}

export async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.token;
  }

  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) {
    throw new Error("ONEMAP_EMAIL and ONEMAP_PASSWORD must be set in environment");
  }

  const response = await fetch(ONEMAP_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`OneMap auth failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expiry_timestamp: string };
  cachedToken = {
    token: data.access_token,
    expiresAt: new Date(data.expiry_timestamp).getTime(),
  };

  return cachedToken.token;
}

export async function geocodeAddress(query: string): Promise<GeocodedAddress | null> {
  const cacheKey = geocodeCacheKey(query);
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null;
  }

  for (const candidate of buildSearchCandidates(query)) {
    const data = await searchAddress(candidate);
    if (data.found === 0 || data.results.length === 0) {
      continue;
    }

    const result = data.results.find((candidateResult) =>
      hasValidPostalCode(candidateResult.POSTAL),
    );
    if (!result) {
      continue;
    }
    const lat = Number.parseFloat(result.LATITUDE);
    const lng = Number.parseFloat(result.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }

    const geocoded: GeocodedAddress = {
      lat,
      lng,
      postalCode: result.POSTAL ?? "",
      buildingName: result.BUILDING ?? "",
    };
    evictOldest(geocodeCache, GEOCODE_CACHE_MAX);
    geocodeCache.set(cacheKey, geocoded);
    return geocoded;
  }

  evictOldest(geocodeCache, GEOCODE_CACHE_MAX);
  geocodeCache.set(cacheKey, null);
  return null;
}

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 500;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchDrivingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<DrivingRoute> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
    }

    const token = await getAuthToken();
    const url = `${ONEMAP_ROUTE_URL}?start=${startLat},${startLng}&end=${endLat},${endLng}&routeType=drive`;
    const response = await fetch(url, {
      headers: { Authorization: token },
    });

    if (response.status === 429) {
      lastError = new Error("OneMap route failed: 429");
      continue;
    }

    if (!response.ok) {
      throw new Error(`OneMap route failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      route_summary: {
        total_distance: number;
        total_time: number;
      };
      route_geometry?: unknown;
    };

    return {
      distanceMeters: data.route_summary.total_distance,
      timeSeconds: data.route_summary.total_time,
      polyline: parseRouteGeometry(data.route_geometry),
    };
  }

  throw lastError ?? new Error("OneMap route failed after retries");
}

export async function getDrivingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<DrivingRoute> {
  const key = routeCacheKey(startLat, startLng, endLat, endLng);

  const cached = routeCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.route;
  }

  const inflight = inflightRoutes.get(key);
  if (inflight) return inflight;

  const promise = fetchDrivingRoute(startLat, startLng, endLat, endLng)
    .then((route) => {
      inflightRoutes.delete(key);
      evictOldest(routeCache, ROUTE_CACHE_MAX);
      routeCache.set(key, { route, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
      return route;
    })
    .catch((error) => {
      inflightRoutes.delete(key);
      throw error;
    });

  inflightRoutes.set(key, promise);
  return promise;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function clearCachedToken() {
  cachedToken = null;
}

export function clearRouteCaches() {
  routeCache.clear();
  geocodeCache.clear();
  inflightRoutes.clear();
}

export function getRouteCacheStats() {
  return {
    routeCacheSize: routeCache.size,
    geocodeCacheSize: geocodeCache.size,
    inflightCount: inflightRoutes.size,
  };
}
