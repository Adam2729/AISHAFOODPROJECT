import "react-native-gesture-handler";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import EarningsScreen from "./src/screens/EarningsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import { AuthProvider, useAuth } from "./src/lib/auth";

const Stack = createNativeStackNavigator();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F8FAFC",
    card: "#FFFFFF",
    primary: "#F97316",
    text: "#0F172A",
    border: "#E2E8F0",
  },
};

function BootScreen() {
  return (
    <View style={styles.bootScreen}>
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  );
}

function AppNavigator() {
  const { isAuthenticated, restoring } = useAuth();

  if (restoring) {
    return <BootScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="dark" />
      <Stack.Navigator
        key={isAuthenticated ? "driver-app" : "driver-auth"}
        initialRouteName={isAuthenticated ? "Home" : "Login"}
        screenOptions={{
          headerShadowVisible: false,
          headerBackTitleVisible: false,
          headerTintColor: "#0F172A",
          headerTitleStyle: {
            fontWeight: "800",
          },
          contentStyle: {
            backgroundColor: "#F8FAFC",
          },
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: "Driver Home" }}
            />
            <Stack.Screen
              name="Earnings"
              component={EarningsScreen}
              options={{ title: "Earnings" }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ title: "Profile" }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
});
