import { Redirect } from "expo-router";

import SplashScreen from "@/src/screens/SplashScreen";
import { useMerchantApp } from "@/src/context/MerchantAppContext";

export default function EntryScreen() {
  const { booting, authState } = useMerchantApp();

  if (booting) {
    return <SplashScreen />;
  }

  if (authState === "approved") {
    return <Redirect href="/(tabs)" />;
  }

  if (authState === "pending") {
    return <Redirect href="/pending" />;
  }

  return <Redirect href="/login" />;
}
