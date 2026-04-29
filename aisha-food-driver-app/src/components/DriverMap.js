import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import {
  DRIVER_RADIUS,
  DRIVER_SHADOW,
  DRIVER_SPACING,
  DRIVER_THEME,
  DRIVER_TYPOGRAPHY,
} from "../lib/driverTheme";

function normalizePoint(point) {
  if (!point || typeof point !== "object") return null;

  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function buildRegion(points) {
  const validPoints = points.filter(Boolean);
  if (!validPoints.length) return null;

  if (validPoints.length === 1) {
    return {
      latitude: validPoints[0].latitude,
      longitude: validPoints[0].longitude,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    };
  }

  const latitudes = validPoints.map((point) => point.latitude);
  const longitudes = validPoints.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.8),
  };
}

function FallbackCard({ permissionDenied, onOpenExternalNavigation, hasNavigationTarget }) {
  return (
    <View style={styles.fallbackCard}>
      <Ionicons name="map-outline" size={24} color={DRIVER_THEME.ORANGE_DARK} />
      <Text style={styles.fallbackTitle}>Map unavailable</Text>
      <Text style={styles.fallbackText}>
        {permissionDenied
          ? "Location permission denied. Use address and phone contact."
          : "Map unavailable. Use address and phone contact."}
      </Text>
      {hasNavigationTarget && onOpenExternalNavigation ? (
        <Pressable style={styles.openMapsButton} onPress={onOpenExternalNavigation}>
          <Ionicons name="navigate-outline" size={18} color="#FFFFFF" />
          <Text style={styles.openMapsButtonText}>Open in Google Maps</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function DriverMap({
  driverLocation,
  pickupLocation,
  dropoffLocation,
  permissionDenied = false,
  onOpenExternalNavigation,
}) {
  const mapRef = useRef(null);
  const normalizedDriverLocation = useMemo(
    () => normalizePoint(driverLocation),
    [driverLocation]
  );
  const normalizedPickupLocation = useMemo(
    () => normalizePoint(pickupLocation),
    [pickupLocation]
  );
  const normalizedDropoffLocation = useMemo(
    () => normalizePoint(dropoffLocation),
    [dropoffLocation]
  );

  const points = useMemo(
    () =>
      [
        normalizedDriverLocation,
        normalizedPickupLocation,
        normalizedDropoffLocation,
      ].filter(Boolean),
    [normalizedDriverLocation, normalizedPickupLocation, normalizedDropoffLocation]
  );

  const initialRegion = useMemo(() => buildRegion(points), [points]);

  useEffect(() => {
    if (!mapRef.current || points.length < 2 || permissionDenied) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates?.(points, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [permissionDenied, points]);

  if (permissionDenied || !initialRegion) {
    return (
      <FallbackCard
        permissionDenied={permissionDenied}
        hasNavigationTarget={Boolean(normalizedPickupLocation || normalizedDropoffLocation)}
        onOpenExternalNavigation={onOpenExternalNavigation}
      />
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Live delivery map</Text>
          <Text style={styles.subtitle}>Written address remains the primary source.</Text>
        </View>
        {onOpenExternalNavigation ? (
          <Pressable style={styles.iconButton} onPress={onOpenExternalNavigation}>
            <Ionicons name="navigate-outline" size={18} color={DRIVER_THEME.ORANGE_DARK} />
          </Pressable>
        ) : null}
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsCompass
        showsTraffic={false}
        toolbarEnabled={false}
      >
        {normalizedDriverLocation ? (
          <Marker
            coordinate={normalizedDriverLocation}
            title="You"
            description="Current driver location"
            pinColor={DRIVER_THEME.ORANGE}
          />
        ) : null}
        {normalizedPickupLocation ? (
          <Marker
            coordinate={normalizedPickupLocation}
            title="Restaurant"
            description="Pickup"
            pinColor={DRIVER_THEME.GREEN}
          />
        ) : null}
        {normalizedDropoffLocation ? (
          <Marker
            coordinate={normalizedDropoffLocation}
            title="Customer"
            description="Drop-off"
            pinColor={DRIVER_THEME.DARK}
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: DRIVER_THEME.CARD,
    borderRadius: DRIVER_RADIUS.cardLarge,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    padding: DRIVER_SPACING.card,
    gap: 14,
    ...DRIVER_SHADOW,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.section,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 4,
    color: DRIVER_THEME.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: DRIVER_THEME.ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  map: {
    height: 230,
    borderRadius: DRIVER_RADIUS.card,
  },
  fallbackCard: {
    backgroundColor: DRIVER_THEME.SURFACE_ALT,
    borderRadius: DRIVER_RADIUS.cardLarge,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
    padding: DRIVER_SPACING.card,
    gap: 10,
    alignItems: "flex-start",
  },
  fallbackTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.section,
    fontWeight: "900",
  },
  fallbackText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 14,
    lineHeight: 20,
  },
  openMapsButton: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.ORANGE,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  openMapsButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
