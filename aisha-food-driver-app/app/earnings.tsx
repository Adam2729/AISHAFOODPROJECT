import React from "react";
import { ProtectedDriverRoute } from "../src/components/DriverRouteGuard";
import EarningsScreen from "../src/screens/EarningsScreen";

export default function EarningsRoute() {
  return (
    <ProtectedDriverRoute>
      <EarningsScreen />
    </ProtectedDriverRoute>
  );
}
