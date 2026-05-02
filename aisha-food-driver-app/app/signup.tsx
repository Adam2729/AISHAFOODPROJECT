import React from "react";
import { PublicDriverRoute } from "../src/components/DriverRouteGuard";
import DriverSignupScreen from "../src/screens/DriverSignupScreen";

export default function SignupRoute() {
  return (
    <PublicDriverRoute>
      <DriverSignupScreen />
    </PublicDriverRoute>
  );
}
