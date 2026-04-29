export type DeviceCoords = {
  lat: number;
  lng: number;
};

type LocationSuccess = {
  ok: true;
  coords: DeviceCoords;
};

type LocationFailure = {
  ok: false;
  code: string;
  message: string;
};

export type DeviceLocationResult = LocationSuccess | LocationFailure;

function isFiniteCoord(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

async function loadExpoLocationModule(): Promise<any | null> {
  try {
    // Keep this dynamic so app still works if expo-location is not installed yet.
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;
    return await dynamicImport("expo-location");
  } catch {
    return null;
  }
}

async function getByExpoLocation(): Promise<DeviceLocationResult | null> {
  const Location = await loadExpoLocationModule();
  if (!Location) return null;

  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission?.status !== "granted") {
      return {
        ok: false,
        code: "LOCATION_PERMISSION_DENIED",
        message: "No pudimos usar tu GPS. Puedes escribir tu direccion manualmente.",
      };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy?.Balanced,
    });

    const lat = position?.coords?.latitude;
    const lng = position?.coords?.longitude;
    if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) {
      return {
        ok: false,
        code: "LOCATION_UNAVAILABLE",
        message: "No pudimos leer tu ubicacion GPS. Intenta de nuevo.",
      };
    }

    return { ok: true, coords: { lat, lng } };
  } catch {
    return {
      ok: false,
      code: "LOCATION_UNAVAILABLE",
      message: "No pudimos leer tu ubicacion GPS. Intenta de nuevo.",
    };
  }
}

async function getByBrowserGeolocation(): Promise<DeviceLocationResult> {
  try {
    if (!globalThis.navigator?.geolocation) {
      return {
        ok: false,
        code: "LOCATION_UNAVAILABLE",
        message: "No pudimos usar tu GPS. Puedes escribir tu direccion manualmente.",
      };
    }

    const position = await new Promise<{ coords?: { latitude?: number; longitude?: number } }>((resolve, reject) => {
      globalThis.navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    });

    const lat = position?.coords?.latitude;
    const lng = position?.coords?.longitude;
    if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) {
      return {
        ok: false,
        code: "LOCATION_UNAVAILABLE",
        message: "No pudimos leer tu ubicacion GPS. Intenta de nuevo.",
      };
    }

    return { ok: true, coords: { lat, lng } };
  } catch {
    return {
      ok: false,
      code: "LOCATION_PERMISSION_DENIED",
      message: "No pudimos usar tu GPS. Puedes escribir tu direccion manualmente.",
    };
  }
}

export async function getCurrentCoords(): Promise<DeviceLocationResult> {
  const expoResult = await getByExpoLocation();
  if (expoResult) return expoResult;
  return getByBrowserGeolocation();
}
