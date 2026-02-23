export type LatLng = {
  lat: number;
  lng: number;
};

export type DistanceMatrixResult = {
  distanceKm: number;
  etaMin: number;
};

const DEFAULT_RESTAURANT_LOCATION: LatLng = { lat: 18.5204, lng: -69.9590 };

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

export async function geocodeAddress(address: string, city = "Santo Domingo"): Promise<LatLng | null> {
  const key = getGoogleKey();
  if (!key) return null;

  const normalizedAddress = address.trim();
  if (normalizedAddress.length < 6) return null;

  const query = `${normalizedAddress}, ${city}, Republica Dominicana`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
  };

  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) return null;

  const loc = data.results[0]?.geometry?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!isValidLatLng(lat, lng)) return null;

  return { lat, lng };
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
