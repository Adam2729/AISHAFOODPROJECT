import React from "react";
import { ProtectedDriverRoute } from "../src/components/DriverRouteGuard";
import { useDriverNavigation } from "../src/lib/routerNavigation";
import HomeScreen from "../src/screens/HomeScreen";

export default function HomeRoute() {
  const navigation = useDriverNavigation();

  return (
    <ProtectedDriverRoute>
      <HomeScreen navigation={navigation} />
    </ProtectedDriverRoute>
  );
}
