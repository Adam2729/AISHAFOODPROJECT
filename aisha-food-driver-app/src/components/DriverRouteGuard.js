import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";

export function RouteLoading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  );
}

export function ProtectedDriverRoute({ children }) {
  const { restoring, isAuthenticated } = useAuth();

  if (restoring) return <RouteLoading />;
  if (!isAuthenticated) return <Redirect href="/login" />;
  return children;
}

export function PublicDriverRoute({ children }) {
  const { restoring, isAuthenticated } = useAuth();

  if (restoring) return <RouteLoading />;
  if (isAuthenticated) return <Redirect href="/home" />;
  return children;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
});
