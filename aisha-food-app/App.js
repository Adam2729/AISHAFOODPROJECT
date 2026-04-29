import "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import HomeScreen from "./src/screens/HomeScreen";
import SearchScreen from "./src/screens/SearchScreen";
import ItemDetailsScreen from "./src/screens/ItemDetailsScreen";
import CartScreen from "./src/screens/CartScreen";
import CheckoutScreen from "./src/screens/CheckoutScreen";
import TrackScreen from "./src/screens/TrackScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import AccountHubScreen from "./src/screens/AccountHubScreen";
import AddressSettingsScreen from "./src/screens/AddressSettingsScreen";
import AppDrawer from "./src/components/AppDrawer";
import BusinessScreen from "./src/screens/BusinessScreen";
import ConfirmationScreen from "./src/screens/ConfirmationScreen";
import MyOrdersScreen from "./src/screens/MyOrdersScreen";
import CitySelectScreen from "./src/screens/CitySelectScreen";
import { AppShellProvider, useAppShell } from "./src/context/AppShellContext";
import { CUSTOMER_THEME } from "./src/lib/customerTheme";
import { navigationRef } from "./src/lib/navigation";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { market } = useAppShell();
  const isSpanish = market.defaultLanguage === "es";

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: CUSTOMER_THEME.ORANGE,
        tabBarInactiveTintColor: CUSTOMER_THEME.MUTED,
        tabBarStyle: {
          height: 66,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: CUSTOMER_THEME.SURFACE,
          borderTopColor: CUSTOMER_THEME.ORANGE_BORDER,
        },
        tabBarLabelStyle: {
          fontWeight: "700",
          fontSize: 12,
        },
        tabBarIcon: ({ color, size }) => {
          const iconMap = {
            Home: "home-outline",
            Search: "search-outline",
            Cart: "cart-outline",
            Orders: "receipt-outline",
            Profile: "person-outline",
          };
          const name = iconMap[route.name] || "ellipse-outline";
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: isSpanish ? "Inicio" : "Accueil" }} />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: isSpanish ? "Buscar" : "Recherche" }}
      />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: isSpanish ? "Carrito" : "Panier" }} />
      <Tab.Screen
        name="Orders"
        component={MyOrdersScreen}
        options={{ title: isSpanish ? "Pedidos" : "Commandes" }}
      />
      <Tab.Screen
        name="Profile"
        component={AccountHubScreen}
        options={{ title: isSpanish ? "Cuenta" : "Compte" }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShellProvider>
        <AppRoot />
      </AppShellProvider>
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const { bootReady, selectedCity, market } = useAppShell();

  if (!bootReady) return null;

  const isSpanish = market.defaultLanguage === "es";

  return (
    <>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName={selectedCity?._id ? "MainTabs" : "CitySelect"}
          screenOptions={{
            headerTintColor: CUSTOMER_THEME.INK,
            headerStyle: {
              backgroundColor: CUSTOMER_THEME.SURFACE_ALT,
            },
            headerShadowVisible: false,
            headerTitleStyle: {
              fontWeight: "800",
            },
          }}
        >
          <Stack.Screen
            name="CitySelect"
            component={CitySelectScreen}
            options={{ title: isSpanish ? "Ciudad" : "Ville" }}
          />
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen
            name="ItemDetails"
            component={ItemDetailsScreen}
            options={{ title: isSpanish ? "Articulo" : "Article" }}
          />
          <Stack.Screen
            name="Checkout"
            component={CheckoutScreen}
            options={{ title: isSpanish ? "Pago" : "Paiement" }}
          />
          <Stack.Screen
            name="Track"
            component={TrackScreen}
            options={{ title: isSpanish ? "Seguimiento" : "Suivi" }}
          />
          <Stack.Screen
            name="ProfileSettings"
            component={ProfileScreen}
            options={{ title: isSpanish ? "Ajustes" : "Parametres" }}
          />
          <Stack.Screen
            name="AddressSettings"
            component={AddressSettingsScreen}
            options={{ title: isSpanish ? "Direccion" : "Adresse" }}
          />
          <Stack.Screen
            name="Business"
            component={BusinessScreen}
            options={{ title: isSpanish ? "Restaurante" : "Restaurant" }}
          />
          <Stack.Screen
            name="Confirmation"
            component={ConfirmationScreen}
            options={{ title: isSpanish ? "Pedido confirmado" : "Commande confirmee" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <AppDrawer />
    </>
  );
}
