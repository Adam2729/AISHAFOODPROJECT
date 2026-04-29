import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { updateDriverStatus } from "../lib/api";
import { useAuth } from "../lib/auth";
import { API_BASE_URL } from "../lib/config";
import { useFocusedPolling } from "../lib/polling";

function readText(value, fallback = "Not provided") {
  const safeValue = String(value || "").trim();
  return safeValue || fallback;
}

export default function ProfileScreen() {
  const { driver, refreshProfile, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingStatus, setSavingStatus] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadProfile = useCallback(
    async (nextRefreshing = false, options = {}) => {
      const silent = Boolean(options.silent);
      if (nextRefreshing) {
        setRefreshing(true);
      } else if (!silent) {
        setLoading(true);
      }

      if (!silent) setError("");

      try {
        await refreshProfile();
      } catch (requestError) {
        if (!silent) {
          setError(requestError?.message || "Unable to load profile.");
        }
      } finally {
        if (nextRefreshing) {
          setRefreshing(false);
        } else if (!silent) {
          setLoading(false);
        }
      }
    },
    [refreshProfile]
  );

  const handleStatusChange = useCallback(
    async (nextStatus, options = {}) => {
      if (savingStatus) return;

      setSavingStatus(nextStatus);
      setError("");
      setMessage("");

      try {
        const updated = await updateDriverStatus(nextStatus, options);
        await refreshProfile();
        setMessage(
          `Driver is ${String(updated?.status || nextStatus).replace("_", " ")}.`
        );
      } catch (requestError) {
        setError(requestError?.message || "Unable to update driver status.");
      } finally {
        setSavingStatus("");
      }
    },
    [refreshProfile, savingStatus]
  );

  useFocusEffect(
    useCallback(() => {
      loadProfile().catch(() => null);
      return undefined;
    }, [loadProfile])
  );

  useFocusedPolling(
    () => loadProfile(false, { silent: true }),
    { intervalMs: 45000, enabled: true }
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadProfile(true)} tintColor="#F97316" />
        }
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{readText(driver?.name || driver?.fullName, "Driver profile")}</Text>
          <Text style={styles.subtitle}>
            Manage your account and confirm the app is pointed at the correct backend.
          </Text>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#F97316" />
            <Text style={styles.stateText}>Refreshing profile...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {message ? (
          <View style={styles.stateCard}>
            <Text style={styles.successText}>{message}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.rowText}>Phone: {readText(driver?.phone)}</Text>
          <Text style={styles.rowText}>Email: {readText(driver?.email)}</Text>
          <Text style={styles.rowText}>
            Vehicle: {readText(driver?.vehicleType || driver?.vehicle?.type)}
          </Text>
          <Text style={styles.rowText}>
            Status: {readText(driver?.status)} / {readText(driver?.availability, "availability unknown")}
          </Text>
          <Text style={styles.rowText}>Zone: {readText(driver?.zoneLabel)}</Text>
          <Text style={styles.rowText}>
            City: {readText(driver?.city?.name || driver?.city || driver?.market?.name)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Availability</Text>
          <Text style={styles.rowText}>
            Current: {readText(driver?.availability, "offline")}
          </Text>
          <Text style={styles.rowText}>
            Accepting available orders: {driver?.eligibleForAvailableOrders ? "Yes" : "No"}
          </Text>
          {driver?.breakReason ? (
            <Text style={styles.rowText}>
              Break reason: {readText(String(driver.breakReason).replace("_", " "))}
            </Text>
          ) : null}
          <View style={styles.statusActions}>
            <Pressable
              style={[
                styles.statusButton,
                driver?.availability === "available" && styles.statusButtonSelected,
                savingStatus === "online" && styles.buttonDisabled,
              ]}
              disabled={Boolean(savingStatus)}
              onPress={() => handleStatusChange("online")}
            >
              <Text style={styles.statusButtonText}>
                {savingStatus === "online" ? "Saving..." : "Go online"}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.statusButton,
                driver?.availability === "offline" && styles.statusButtonSelected,
                savingStatus === "offline" && styles.buttonDisabled,
              ]}
              disabled={Boolean(savingStatus)}
              onPress={() => handleStatusChange("offline")}
            >
              <Text style={styles.statusButtonText}>
                {savingStatus === "offline" ? "Saving..." : "Go offline"}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.statusButton,
                driver?.availability === "paused" && styles.statusButtonSelected,
                savingStatus === "paused" && styles.buttonDisabled,
              ]}
              disabled={Boolean(savingStatus)}
              onPress={() => handleStatusChange("paused", { reason: "break" })}
            >
              <Text style={styles.statusButtonText}>
                {savingStatus === "paused" ? "Saving..." : "Pause"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Configuration</Text>
          <Text style={styles.rowText}>API base URL: {readText(API_BASE_URL, "Not configured")}</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => loadProfile(true)}>
          <Text style={styles.primaryButtonText}>Refresh profile</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={signOut}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  hero: {
    gap: 6,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: "#64748B",
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  rowText: {
    color: "#334155",
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#334155",
    fontWeight: "800",
  },
  statusActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  statusButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  statusButtonSelected: {
    backgroundColor: "#15803D",
  },
  statusButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 18,
    padding: 20,
    gap: 10,
    alignItems: "center",
  },
  stateText: {
    color: "#64748B",
  },
  errorText: {
    color: "#B91C1C",
    textAlign: "center",
  },
  successText: {
    color: "#15803D",
    textAlign: "center",
  },
});
