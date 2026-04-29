import React from "react";
import { PublicDriverRoute } from "../src/components/DriverRouteGuard";
import LoginScreen from "../src/screens/LoginScreen";

export default function LoginRoute() {
  return (
    <PublicDriverRoute>
      <LoginScreen />
    </PublicDriverRoute>
  );
}
