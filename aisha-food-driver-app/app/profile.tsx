import React from "react";
import { ProtectedDriverRoute } from "../src/components/DriverRouteGuard";
import ProfileScreen from "../src/screens/ProfileScreen";

export default function ProfileRoute() {
  return (
    <ProtectedDriverRoute>
      <ProfileScreen />
    </ProtectedDriverRoute>
  );
}
