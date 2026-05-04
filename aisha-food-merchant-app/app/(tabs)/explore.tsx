import { Redirect } from "expo-router";

export default function HiddenExploreRoute() {
  return <Redirect href="/(tabs)/orders" />;
}
