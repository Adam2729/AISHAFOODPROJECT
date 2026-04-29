import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/lib/auth";
import {
  installOfferNotificationHandler,
  registerOfferNotificationResponseListener,
} from "../src/lib/offerNotifications";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    let unsubscribe = () => {};
    let active = true;

    installOfferNotificationHandler().catch(() => null);

    registerOfferNotificationResponseListener((data) => {
      const type = String(data?.type || "").trim();
      if (type === "driver_offer") {
        router.push("/home");
      }
    })
      .then((cleanup) => {
        if (active) {
          unsubscribe = typeof cleanup === "function" ? cleanup : () => {};
          return;
        }

        if (typeof cleanup === "function") {
          cleanup();
        }
      })
      .catch(() => null);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerTintColor: "#7C2D12",
            headerStyle: {
              backgroundColor: "#FFF7ED",
            },
            headerTitleStyle: {
              fontWeight: "800",
              color: "#7C2D12",
            },
            contentStyle: {
              backgroundColor: "#FFF7ED",
            },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="home" options={{ title: "AishaFood Driver" }} />
          <Stack.Screen name="earnings" options={{ title: "Earnings" }} />
          <Stack.Screen name="profile" options={{ title: "Profile" }} />
        </Stack>
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
