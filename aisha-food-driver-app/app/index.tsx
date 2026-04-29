import React from "react";
import { Redirect } from "expo-router";
import { RouteLoading } from "../src/components/DriverRouteGuard";
import { useAuth } from "../src/lib/auth";

export default function IndexRoute() {
  const { restoring, isAuthenticated } = useAuth();

  if (restoring) return <RouteLoading />;
  return <Redirect href={isAuthenticated ? "/home" : "/login"} />;
}
