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
};

let cachedToken: { token: string; expiresAt: number } | null = null;

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
  const url = `${ONEMAP_SEARCH_URL}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OneMap search failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    found: number;
    results: Array<{
      LATITUDE: string;
      LONGITUDE: string;
      POSTAL: string;
      BUILDING: string;
    }>;
  };

  if (data.found === 0 || data.results.length === 0) {
    return null;
  }

  const result = data.results[0];
  return {
    lat: Number.parseFloat(result.LATITUDE),
    lng: Number.parseFloat(result.LONGITUDE),
    postalCode: result.POSTAL,
    buildingName: result.BUILDING,
  };
}

export async function getDrivingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<DrivingRoute> {
  const token = await getAuthToken();
  const url = `${ONEMAP_ROUTE_URL}?start=${startLat},${startLng}&end=${endLat},${endLng}&routeType=drive`;
  const response = await fetch(url, {
    headers: { Authorization: token },
  });

  if (!response.ok) {
    throw new Error(`OneMap route failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    route_summary: {
      total_distance: number;
      total_time: number;
    };
  };

  return {
    distanceMeters: data.route_summary.total_distance,
    timeSeconds: data.route_summary.total_time,
  };
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
