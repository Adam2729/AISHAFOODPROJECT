import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { useMerchantProducts } from "@/src/hooks/useMerchantProducts";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

type ProductFormState = {
  name: string;
  category: string;
  description: string;
  price: string;
  imageUrl: string;
  available: boolean;
};

type MenuProduct = {
  id: string;
  name: string;
  category: string;
  description?: string;
  price: number;
  imageUrl?: string;
  available: boolean;
  currencyCode?: string;
};

const EMPTY_FORM = {
  name: "",
  category: "",
  description: "",
  price: "",
  imageUrl: "",
  available: true,
} satisfies ProductFormState;

function buildFormState(product: MenuProduct | null): ProductFormState {
  if (!product) return EMPTY_FORM;
  return {
    name: String(product.name || ""),
    category: String(product.category || ""),
    description: String(product.description || ""),
    price: String(product.price || ""),
    imageUrl: String(product.imageUrl || ""),
    available: Boolean(product.available),
  };
}

function normalizeFormPayload(formState: ProductFormState) {
  return {
    name: String(formState.name || "").trim(),
    category: String(formState.category || "").trim(),
    description: String(formState.description || "").trim(),
    price: Number(formState.price),
    imageUrl: String(formState.imageUrl || "").trim(),
    available: Boolean(formState.available),
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function MenuScreen() {
  const { authState, merchantProfile } = useMerchantApp();
  const {
    products,
    loading,
    refreshing,
    error,
    usingDemoData,
    refreshProducts,
    createProduct,
    updateProduct,
    toggleAvailability,
    bulkSetAvailability,
  } = useMerchantProducts();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingProductId, setEditingProductId] = useState("");
  const [formState, setFormState] = useState<ProductFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [bulkLoading, setBulkLoading] = useState("");
  const [togglingProductId, setTogglingProductId] = useState("");

  const currencyCode = merchantProfile.currencyCode || "XOF";
  const isEditing = Boolean(editingProductId);
  const menuProducts = products as MenuProduct[];
  const categories = useMemo(() => {
    return Array.from(
      new Set(menuProducts.map((product) => String(product.category || "").trim()).filter(Boolean))
    );
  }, [menuProducts]);

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  function openCreateModal() {
    setEditingProductId("");
    setFormState(EMPTY_FORM);
    setModalVisible(true);
  }

  function openEditModal(product: MenuProduct) {
    setEditingProductId(String(product.id || ""));
    setFormState(buildFormState(product));
    setModalVisible(true);
  }

  function closeModal() {
    if (saving) return;
    setModalVisible(false);
    setEditingProductId("");
    setFormState(EMPTY_FORM);
  }

  function updateField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setFormState((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit() {
    const payload = normalizeFormPayload(formState);
    if (!payload.name) {
      Alert.alert("Missing name", "Enter a product name.");
      return;
    }
    if (!payload.category) {
      Alert.alert("Missing category", "Enter a category.");
      return;
    }
    if (!Number.isFinite(payload.price) || payload.price <= 0) {
      Alert.alert("Invalid price", "Enter a valid product price.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing) {
        await updateProduct(editingProductId, payload);
      } else {
        await createProduct(payload);
      }
      setModalVisible(false);
      setEditingProductId("");
      setFormState(EMPTY_FORM);
    } catch (requestError: unknown) {
      Alert.alert(
        isEditing ? "Could not update item" : "Could not create item",
        getErrorMessage(requestError, "Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAvailability(product: MenuProduct) {
    const nextAvailable = !product.available;
    setTogglingProductId(product.id);
    try {
      await toggleAvailability(product.id, nextAvailable);
    } catch (requestError: unknown) {
      Alert.alert(
        "Availability update failed",
        getErrorMessage(requestError, "Please try again.")
      );
    } finally {
      setTogglingProductId("");
    }
  }

  async function handleBulkAvailability(available: boolean) {
    setBulkLoading(available ? "available" : "unavailable");
    try {
      await bulkSetAvailability(available);
    } catch (requestError: unknown) {
      Alert.alert(
        "Bulk update failed",
        getErrorMessage(requestError, "Please try again.")
      );
    } finally {
      setBulkLoading("");
    }
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshProducts().catch(() => null)}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader
          title="Menu"
          subtitle="Keep items current and control availability."
          rightActionLabel="Add item"
          onRightActionPress={openCreateModal}
        />

        <View style={styles.toolbarCard}>
          <View style={styles.toolbarTextWrap}>
            <Text style={styles.toolbarTitle}>Product controls</Text>
            <Text style={styles.toolbarSubtitle}>
              Manage catalogue visibility without leaving OranjeEats Merchant.
            </Text>
          </View>
          <View style={styles.bulkActions}>
            <OrangeButton
              label="Mark all available"
              variant="secondary"
              loading={bulkLoading === "available"}
              onPress={() => handleBulkAvailability(true)}
              style={styles.bulkButton}
            />
            <OrangeButton
              label="Mark all unavailable"
              variant="outline"
              loading={bulkLoading === "unavailable"}
              onPress={() => handleBulkAvailability(false)}
              style={styles.bulkButton}
            />
          </View>
          {usingDemoData ? (
            <View style={styles.demoBadge}>
              <Ionicons name="flask-outline" size={14} color={colors.primaryDark} />
              <Text style={styles.demoBadgeText}>Demo data</Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View style={styles.messageCard}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.primaryDark} />
            <Text style={styles.messageText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.centerTitle}>Loading menu items</Text>
            <Text style={styles.centerSubtitle}>Pull down to retry if this takes too long.</Text>
          </View>
        ) : null}

        {!loading && !menuProducts.length ? (
          <View style={styles.centerCard}>
            <Ionicons name="restaurant-outline" size={28} color={colors.primaryDark} />
            <Text style={styles.centerTitle}>No products yet</Text>
            <Text style={styles.centerSubtitle}>
              Add your first menu item to start taking orders.
            </Text>
            <OrangeButton label="Add first item" onPress={openCreateModal} style={styles.emptyCta} />
          </View>
        ) : null}

        {!loading &&
          menuProducts.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.imageWrap}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" />
                ) : (
                  <View style={styles.placeholderImage}>
                    <Ionicons name="image-outline" size={24} color={colors.muted} />
                  </View>
                )}
              </View>

              <View style={styles.cardMain}>
                <View style={styles.titleRow}>
                  <Text style={styles.name}>{item.name}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      item.available ? styles.availableBadge : styles.unavailableBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        item.available ? styles.availableBadgeText : styles.unavailableBadgeText,
                      ]}
                    >
                      {item.available ? "Available" : "Unavailable"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>{item.category}</Text>
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <Text style={styles.price}>
                  {formatCurrency(item.price, item.currencyCode || currencyCode)}
                </Text>
              </View>

              <View style={styles.sideWrap}>
                <Switch
                  value={item.available}
                  disabled={togglingProductId === item.id}
                  onValueChange={() => handleToggleAvailability(item)}
                  trackColor={{ false: "#E7E5E4", true: "#FFB47D" }}
                  thumbColor={item.available ? colors.primary : "#FFFFFF"}
                />
                <OrangeButton
                  label="Edit item"
                  variant="outline"
                  onPress={() => openEditModal(item)}
                />
              </View>
            </View>
          ))}

        {categories.length ? (
          <View style={styles.categoryCard}>
            <Text style={styles.categoryTitle}>Live categories</Text>
            <View style={styles.categoryWrap}>
              {categories.map((category) => (
                <View key={category} style={styles.categoryChip}>
                  <Text style={styles.categoryChipText}>{category}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>{isEditing ? "Edit item" : "Add item"}</Text>
                <Text style={styles.modalSubtitle}>
                  {isEditing
                    ? "Update your product details and availability."
                    : "Create a new product for your OranjeEats menu."}
                </Text>
              </View>
              <OrangeButton label="Close" variant="ghost" onPress={closeModal} />
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Product name</Text>
                <TextInput
                  value={formState.name}
                  onChangeText={(value) => updateField("name", value)}
                  placeholder="Poulet braise"
                  placeholderTextColor="#A8A29E"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Category</Text>
                <TextInput
                  value={formState.category}
                  onChangeText={(value) => updateField("category", value)}
                  placeholder="Grillades"
                  placeholderTextColor="#A8A29E"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Short description</Text>
                <TextInput
                  value={formState.description}
                  onChangeText={(value) => updateField("description", value)}
                  placeholder="Describe the item briefly"
                  placeholderTextColor="#A8A29E"
                  style={[styles.input, styles.textarea]}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Price</Text>
                <TextInput
                  value={formState.price}
                  onChangeText={(value) => updateField("price", value)}
                  placeholder="3500"
                  placeholderTextColor="#A8A29E"
                  keyboardType="numeric"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Image URL</Text>
                <TextInput
                  value={formState.imageUrl}
                  onChangeText={(value) => updateField("imageUrl", value)}
                  placeholder="https://..."
                  placeholderTextColor="#A8A29E"
                  autoCapitalize="none"
                  style={styles.input}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchTextWrap}>
                  <Text style={styles.fieldLabel}>Available now</Text>
                  <Text style={styles.switchHint}>Toggle off to hide the product from customers.</Text>
                </View>
                <Switch
                  value={formState.available}
                  onValueChange={(value) => updateField("available", value)}
                  trackColor={{ false: "#E7E5E4", true: "#FFB47D" }}
                  thumbColor={formState.available ? colors.primary : "#FFFFFF"}
                />
              </View>

              <OrangeButton
                label={isEditing ? "Save changes" : "Create product"}
                onPress={() => handleSubmit().catch(() => null)}
                loading={saving}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 14,
  },
  toolbarCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  toolbarTextWrap: {
    gap: 4,
  },
  toolbarTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  toolbarSubtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  bulkActions: {
    gap: 10,
  },
  bulkButton: {
    minHeight: 48,
  },
  demoBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  demoBadgeText: {
    color: colors.primaryDark,
    fontWeight: "800",
    fontSize: 12,
  },
  messageCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F3C77A",
    padding: 14,
  },
  messageText: {
    flex: 1,
    color: colors.text,
    lineHeight: 20,
  },
  centerCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  centerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  centerSubtitle: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyCta: {
    alignSelf: "stretch",
    marginTop: 8,
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
  imageWrap: {
    width: 84,
    height: 84,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMain: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    flexShrink: 1,
  },
  meta: {
    color: colors.muted,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    lineHeight: 19,
  },
  price: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
  },
  sideWrap: {
    width: 110,
    alignItems: "flex-end",
    gap: 10,
    justifyContent: "space-between",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  availableBadge: {
    backgroundColor: colors.successSoft,
  },
  unavailableBadge: {
    backgroundColor: colors.dangerSoft,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  availableBadgeText: {
    color: colors.success,
  },
  unavailableBadgeText: {
    color: colors.danger,
  },
  categoryCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  categoryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  categoryWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  categoryChipText: {
    color: colors.primaryDark,
    fontWeight: "800",
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17,17,17,0.40)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "90%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  modalHeaderText: {
    flex: 1,
    gap: 4,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  modalContent: {
    gap: 14,
    paddingBottom: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  textarea: {
    minHeight: 100,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  switchTextWrap: {
    flex: 1,
    gap: 4,
  },
  switchHint: {
    color: colors.muted,
    lineHeight: 18,
    fontSize: 13,
  },
});
