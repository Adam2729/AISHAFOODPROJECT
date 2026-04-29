import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getSelectedCity,
  setSelectedCity as persistSelectedCity,
  setPreferredAppLanguage as persistPreferredAppLanguage,
} from "../lib/citySelection";
import { getMarketConfig } from "../lib/marketConfig";

const AppShellContext = createContext(null);

export function AppShellProvider({ children }) {
  const [bootReady, setBootReady] = useState(false);
  const [selectedCity, setSelectedCityState] = useState(null);
  const [market, setMarket] = useState(getMarketConfig());
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refreshPreferences = useCallback(async () => {
    const city = await getSelectedCity();
    setSelectedCityState(city || null);
    setMarket(getMarketConfig(city));
    setBootReady(true);
    return city || null;
  }, []);

  useEffect(() => {
    refreshPreferences().catch(() => setBootReady(true));
  }, [refreshPreferences]);

  const selectCity = useCallback(
    async (city) => {
      await persistSelectedCity(city);
      return refreshPreferences();
    },
    [refreshPreferences]
  );

  const setPreferredLanguage = useCallback(
    async (language) => {
      await persistPreferredAppLanguage(language, selectedCity || market);
      return refreshPreferences();
    },
    [market, refreshPreferences, selectedCity]
  );

  const value = useMemo(
    () => ({
      bootReady,
      selectedCity,
      market,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      toggleDrawer: () => setDrawerOpen((current) => !current),
      refreshPreferences,
      selectCity,
      setPreferredLanguage,
    }),
    [bootReady, drawerOpen, market, refreshPreferences, selectCity, selectedCity, setPreferredLanguage]
  );

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell() {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error("useAppShell must be used inside AppShellProvider.");
  }
  return value;
}
