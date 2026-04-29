import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function OrderDetailsScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <View style={styles.card}>
        <Text style={styles.title}>Order details moved</Text>
        <Text style={styles.body}>
          Drivers should only work from the live order offer and the active delivery screen.
          Manual order opening and accept/reject from details are disabled.
        </Text>
        <Pressable style={styles.button} onPress={() => navigation?.replace?.("Home")}>
          <Text style={styles.buttonText}>Return to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  card: {
    margin: 16,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  title: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900",
  },
  body: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
