import { useMemo } from "react";
import { useRouter } from "expo-router";

function routeForName(name, params = {}) {
  switch (String(name || "")) {
    case "Login":
      return "/login";
    case "Signup":
      return "/signup";
    case "Home":
      return "/home";
    case "Orders":
      return "/home";
    case "Earnings":
      return "/earnings";
    case "Profile":
      return "/profile";
    case "OrderDetails":
      return "/home";
    default:
      return "/home";
  }
}

export function useDriverNavigation() {
  const router = useRouter();

  return useMemo(
    () => ({
      navigate: (name, params) => router.push(routeForName(name, params)),
      replace: (name, params) => router.replace(routeForName(name, params)),
      goBack: () => router.back(),
    }),
    [router]
  );
}
