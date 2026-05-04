import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Redirect } from "expo-router";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

export default function MenuScreen() {
  const { authState, menuItems, toggleMenuAvailability } = useMerchantApp();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader
        title="Menu"
        subtitle="Keep items current and control availability."
        rightActionLabel="Add item"
        onRightActionPress={() => Alert.alert("Mock action", "Add item is UI-only for now.")}
      />

      {menuItems.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.cardMain}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.category}</Text>
            <Text style={styles.price}>{formatCurrency(item.price)}</Text>
          </View>

          <View style={styles.sideWrap}>
            <Switch
              value={item.available}
              onValueChange={() => toggleMenuAvailability(item.id)}
              trackColor={{ false: "#E7E5E4", true: "#FFB47D" }}
              thumbColor={item.available ? colors.primary : "#FFFFFF"}
            />
            <OrangeButton
              label="Edit item"
              variant="outline"
              onPress={() => Alert.alert("Mock action", `Edit ${item.name}`)}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 14,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  cardMain: {
    flex: 1,
    gap: 4,
  },
  sideWrap: {
    width: 110,
    alignItems: "flex-end",
    gap: 10,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  meta: {
    color: colors.muted,
    fontWeight: "700",
  },
  price: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
  },
});
