import * as Location from "expo-location";

function normalizeCoords(coords) {
  if (!coords || typeof coords !== "object") return null;

  const latitude = Number(coords.latitude ?? coords.lat);
  const longitude = Number(coords.longitude ?? coords.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
    heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
    speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null,
    timestamp: coords.timestamp || new Date().toISOString(),
  };
}

export async function requestForegroundLocationAccess() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    return {
      granted: permission.status === "granted",
      status: permission.status,
      canAskAgain: permission.canAskAgain !== false,
    };
  } catch (error) {
    return {
      granted: false,
      status: "undetermined",
      canAskAgain: false,
      error: error instanceof Error ? error.message : "Location permission request failed.",
    };
  }
}

export async function getCurrentCoords() {
  const permission = await requestForegroundLocationAccess();
  if (!permission.granted) {
    return {
      ok: false,
      permissionDenied: true,
      message: "Location permission denied.",
      status: permission.status,
    };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      ok: true,
      coords: normalizeCoords({
        ...position.coords,
        timestamp: new Date(position.timestamp || Date.now()).toISOString(),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      permissionDenied: false,
      message: error instanceof Error ? error.message : "Could not read current location.",
    };
  }
}

export async function startDriverLocationTracking({
  onUpdate,
  timeInterval = 15000,
  distanceInterval = 60,
} = {}) {
  const permission = await requestForegroundLocationAccess();
  if (!permission.granted) {
    return {
      ok: false,
      permissionDenied: true,
      status: permission.status,
      subscription: null,
    };
  }

  const current = await getCurrentCoords();
  if (current.ok && typeof onUpdate === "function" && current.coords) {
    onUpdate(current.coords);
  }

  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval,
        distanceInterval,
        mayShowUserSettingsDialog: true,
      },
      (position) => {
        if (typeof onUpdate !== "function") return;
        const nextCoords = normalizeCoords({
          ...position.coords,
          timestamp: new Date(position.timestamp || Date.now()).toISOString(),
        });
        if (nextCoords) {
          onUpdate(nextCoords);
        }
      }
    );

    return {
      ok: true,
      permissionDenied: false,
      status: permission.status,
      subscription,
    };
  } catch (error) {
    return {
      ok: false,
      permissionDenied: false,
      message: error instanceof Error ? error.message : "Could not start location tracking.",
      subscription: null,
    };
  }
}

export function stopDriverLocationTracking(subscription) {
  subscription?.remove?.();
}
