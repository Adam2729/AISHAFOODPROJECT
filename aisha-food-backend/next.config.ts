import type { NextConfig } from "next";

const launchCityCode =
  String(process.env.NEXT_PUBLIC_LAUNCH_CITY_CODE || process.env.LAUNCH_CITY_CODE || "")
    .trim()
    .toUpperCase() || "BKO";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_LAUNCH_CITY_CODE: launchCityCode,
  },
};

export default nextConfig;
