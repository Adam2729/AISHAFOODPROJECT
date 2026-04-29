import {
  ENV_BAMAKO_BASE_LOCATION,
  ENV_BASE_LOCATION,
  ENV_LAUNCH_CITY_CODE,
} from "@/lib/env";

export type LatLng = {
  lat: number;
  lng: number;
};

export type DistanceMatrixResult = {
  distanceKm: number;
  etaMin: number;
};

const DEFAULT_SANTO_DOMINGO_LOCATION: LatLng = {
  lat: Number(ENV_BASE_LOCATION.lat || 18.5204),
  lng: Number(ENV_BASE_LOCATION.lng || -69.959),
};
const DEFAULT_BAMAKO_LOCATION: LatLng = {
  lat:
    Number.isFinite(Number(ENV_BAMAKO_BASE_LOCATION.lat)) && ENV_BAMAKO_BASE_LOCATION.lat != null
      ? Number(ENV_BAMAKO_BASE_LOCATION.lat)
      : 12.6392,
  lng:
    Number.isFinite(Number(ENV_BAMAKO_BASE_LOCATION.lng)) && ENV_BAMAKO_BASE_LOCATION.lng != null
      ? Number(ENV_BAMAKO_BASE_LOCATION.lng)
      : -8.0029,
};
const DEFAULT_RESTAURANT_LOCATION: LatLng =
  String(ENV_LAUNCH_CITY_CODE || "").trim().toUpperCase() === "SDQ"
    ? DEFAULT_SANTO_DOMINGO_LOCATION
    : DEFAULT_BAMAKO_LOCATION;

export function isValidLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function getRestaurantLocation(): LatLng {
  const lat = Number(process.env.RESTAURANT_LAT || DEFAULT_RESTAURANT_LOCATION.lat);
  const lng = Number(process.env.RESTAURANT_LNG || DEFAULT_RESTAURANT_LOCATION.lng);
  if (!isValidLatLng(lat, lng)) {
    return DEFAULT_RESTAURANT_LOCATION;
  }
  return { lat, lng };
}

function getGoogleKey() {
  const key = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  return key || null;
}

async function geocodeQuery(query: string, key: string): Promise<LatLng | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    query
  )}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
  };
  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
    return null;
  }

  const loc = data.results[0]?.geometry?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}

function normalizeCity(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function getLaunchAddressHint() {
  return String(ENV_LAUNCH_CITY_CODE || "").trim().toUpperCase() === "SDQ"
    ? {
        city: "Santo Domingo",
        country: "Dominican Republic",
      }
    : {
        city: "Bamako",
        country: "Mali",
      };
}

function inferAddressHint(city: string) {
  const normalizedCity = normalizeCity(city).toLowerCase();
  const launchHint = getLaunchAddressHint();

  if (
    normalizedCity.includes("santo domingo") ||
    normalizedCity.includes("dominican") ||
    normalizedCity.includes("republica dominicana") ||
    normalizedCity.includes("republica dominicana")
  ) {
    return {
      city: normalizeCity(city) || "Santo Domingo",
      country: "Dominican Republic",
    };
  }

  if (
    normalizedCity.includes("bamako") ||
    normalizedCity.includes("mali") ||
    (!normalizedCity && launchHint.country === "Mali")
  ) {
    return { city: normalizeCity(city) || "Bamako", country: "Mali" };
  }

  return {
    city: normalizeCity(city) || launchHint.city,
    country: launchHint.country,
  };
}

export async function geocodeAddress(address: string, city = ""): Promise<LatLng | null> {
  const key = getGoogleKey();
  if (!key) return null;

  const normalizedAddress = address.trim().replace(/\s+/g, " ");
  if (normalizedAddress.length < 3) return null;
  const hint = inferAddressHint(city);

  const queries = [
    `${normalizedAddress}, ${hint.city}, ${hint.country}`,
    `${normalizedAddress}, ${hint.country}`,
  ];

  for (const query of queries) {
    const result = await geocodeQuery(query, key);
    if (result) return result;
  }
  return null;
}

export async function getDistanceMatrix(origin: LatLng, destination: LatLng): Promise<DistanceMatrixResult | null> {
  const key = getGoogleKey();
  if (!key) return null;

  const params = new URLSearchParams();
  params.set("origins", `${origin.lat},${origin.lng}`);
  params.set("destinations", `${destination.lat},${destination.lng}`);
  params.set("mode", "driving");
  params.set("units", "metric");
  params.set("departure_time", "now");
  params.set("key", key);

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    status?: string;
    rows?: {
      elements?: {
        status?: string;
        distance?: { value?: number };
        duration?: { value?: number };
        duration_in_traffic?: { value?: number };
      }[];
    }[];
  };

  if (data.status !== "OK") return null;
  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") return null;

  const meters = Number(element.distance?.value || 0);
  const seconds = Number(element.duration_in_traffic?.value || element.duration?.value || 0);
  if (!Number.isFinite(meters) || meters <= 0) return null;

  const distanceKm = Number((meters / 1000).toFixed(2));
  const etaMin = Math.max(1, Math.round(seconds / 60));
  return { distanceKm, etaMin };
}
