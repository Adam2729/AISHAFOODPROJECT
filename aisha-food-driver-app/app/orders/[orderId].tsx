import React from "react";
import { Redirect } from "expo-router";
import { ProtectedDriverRoute } from "../../src/components/DriverRouteGuard";

export default function OrderDetailsRoute() {
  return (
    <ProtectedDriverRoute>
      <Redirect href="/home" />
    </ProtectedDriverRoute>
  );
}
