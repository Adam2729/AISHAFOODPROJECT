import React from "react";
import { Image } from "react-native";

export default function Logo({ width = 72, height = 72, style = undefined }) {
  return (
    <Image
      source={require("../../assets/logo.png")}
      style={[{ width, height }, style]}
      resizeMode="contain"
    />
  );
}
