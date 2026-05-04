import { ThemeProvider, DefaultTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MerchantAppProvider } from "@/src/context/MerchantAppContext";

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F7F7F7",
    card: "#FFFFFF",
    primary: "#FF6B00",
    text: "#111111",
    border: "#E7E5E4",
    notification: "#FF6B00",
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MerchantAppProvider>
          <ThemeProvider value={navigationTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: "#F7F7F7",
                },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="signup" />
              <Stack.Screen name="pending" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="order/[id]"
                options={{
                  animation: "slide_from_right",
                }}
              />
            </Stack>
            <StatusBar style="dark" />
          </ThemeProvider>
        </MerchantAppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
