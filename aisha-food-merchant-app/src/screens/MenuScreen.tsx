import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect } from "expo-router";
import React, { memo, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { useMerchantProducts } from "@/src/hooks/useMerchantProducts";
import { formatCurrency } from "@/src/lib/formatters";
import { compressImage, pickImage, uploadImage } from "@/src/lib/imageUpload";
import { colors } from "@/src/theme/colors";

type ProductFormState = {
  name: string;
  category: string;
  description: string;
  price: string;
  imageUrl: string;
  available: boolean;
};

type LocalImageAsset = {
  uri: string;
  mimeType?: string;
  fileName?: string;
  width?: number | null;
  height?: number | null;
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

type CategorySummary = {
  id: string;
  name: string;
  count: number;
  imageUrl: string;
};

const EMPTY_FORM: ProductFormState = {
  name: "",
  category: "",
  description: "",
  price: "",
  imageUrl: "",
  available: true,
};

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

function normalizeFormPayload(formState: ProductFormState, imageUrl: string) {
  return {
    name: String(formState.name || "").trim(),
    category: String(formState.category || "").trim(),
    description: String(formState.description || "").trim(),
    price: Number(formState.price),
    imageUrl: String(imageUrl || "").trim(),
    available: Boolean(formState.available),
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getPreviewImageUri(formState: ProductFormState, localImage: LocalImageAsset | null) {
  return String(localImage?.uri || formState.imageUrl || "").trim();
}

function buildCategorySummaries(products: MenuProduct[], categories: string[]) {
  const summaries: CategorySummary[] = [];
  const source = categories.length
    ? categories
    : Array.from(new Set(products.map((product) => String(product.category || "").trim()).filter(Boolean)));

  source.forEach((category) => {
    const categoryProducts = products.filter(
      (product) => String(product.category || "").trim().toLowerCase() === category.toLowerCase()
    );
    summaries.push({
      id: category,
      name: category,
      count: categoryProducts.length,
      imageUrl: String(categoryProducts[0]?.imageUrl || "").trim(),
    });
  });
  return summaries;
}

const ProductCard = memo(function ProductCard({
  item,
  currencyCode,
  onEdit,
  onDelete,
  onToggleAvailability,
  toggling,
}: {
  item: MenuProduct;
  currencyCode: string;
  onEdit: (item: MenuProduct) => void;
  onDelete: (item: MenuProduct) => void;
  onToggleAvailability: (item: MenuProduct) => void;
  toggling: boolean;
}) {
  return (
    <View style={styles.productCard}>
      <View style={styles.productImageWrap}>
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.productImage}
            contentFit="cover"
            transition={180}
            cachePolicy="disk"
          />
        ) : (
          <View style={styles.placeholderImage}>
            <Ionicons name="image-outline" size={24} color={colors.muted} />
          </View>
        )}
      </View>

      <View style={styles.productMain}>
        <View style={styles.productTitleRow}>
          <Text style={styles.productName} numberOfLines={1}>
            {item.name}
          </Text>
          <View
            style={[
              styles.availabilityBadge,
              item.available ? styles.availabilityBadgeOn : styles.availabilityBadgeOff,
            ]}
          >
            <Text
              style={[
                styles.availabilityBadgeText,
                item.available ? styles.availabilityBadgeTextOn : styles.availabilityBadgeTextOff,
              ]}
            >
              {item.available ? "Disponible" : "Indisponible"}
            </Text>
          </View>
        </View>

        <Text style={styles.productMeta}>{item.category}</Text>
        {item.description ? (
          <Text style={styles.productDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.productFooter}>
          <Text style={styles.productPrice}>
            {formatCurrency(item.price, item.currencyCode || currencyCode)}
          </Text>
          <View style={styles.productQuickActions}>
            <Switch
              value={item.available}
              disabled={toggling}
              onValueChange={() => onToggleAvailability(item)}
              trackColor={{ false: "#D6D3D1", true: "#FFB47D" }}
              thumbColor={item.available ? colors.success : "#FFFFFF"}
            />
            <Pressable onPress={() => onEdit(item)} style={styles.iconAction}>
              <Ionicons name="create-outline" size={18} color={colors.primaryDark} />
            </Pressable>
            <Pressable onPress={() => onDelete(item)} style={styles.iconActionDanger}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});

function ProductSkeletonCard() {
  return (
    <View style={styles.productCard}>
      <View style={[styles.productImageWrap, styles.skeletonBlock]} />
      <View style={styles.productMain}>
        <View style={[styles.skeletonLine, { width: "68%", height: 18 }]} />
        <View style={[styles.skeletonLine, { width: "34%" }]} />
        <View style={[styles.skeletonLine, { width: "92%" }]} />
        <View style={[styles.skeletonLine, { width: "78%" }]} />
      </View>
    </View>
  );
}

export default function MenuScreen() {
  const { authState, merchantProfile } = useMerchantApp();
  const {
    products,
    categories,
    business,
    loading,
    refreshing,
    error,
    usingDemoData,
    refreshProducts,
    createProduct,
    updateProduct,
    toggleAvailability,
    bulkSetAvailability,
    deleteProduct,
  } = useMerchantProducts();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Tous");
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProductId, setEditingProductId] = useState("");
  const [formState, setFormState] = useState<ProductFormState>(EMPTY_FORM);
  const [localImage, setLocalImage] = useState<LocalImageAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [bulkLoading, setBulkLoading] = useState("");
  const [togglingProductId, setTogglingProductId] = useState("");
  const [imageError, setImageError] = useState("");
  const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("Product Added Successfully");

  const currencyCode = merchantProfile.currencyCode || "XOF";
  const isEditing = Boolean(editingProductId);
  const menuProducts = products as MenuProduct[];
  const menuBusiness = (business || null) as { productImageUploadsEnabled?: boolean } | null;
  const previewImageUri = getPreviewImageUri(formState, localImage);
  const categorySummaries = useMemo(
    () => buildCategorySummaries(menuProducts, categories || []),
    [categories, menuProducts]
  );
  const categoryTabs = useMemo(
    () => ["Tous", ...categorySummaries.map((category) => category.name)],
    [categorySummaries]
  );
  const filteredProducts = useMemo(() => {
    const needle = String(searchQuery || "").trim().toLowerCase();
    return menuProducts.filter((product) => {
      const matchesCategory =
        selectedCategory === "Tous" ||
        String(product.category || "").trim().toLowerCase() === selectedCategory.toLowerCase();
      if (!matchesCategory) return false;
      if (!needle) return true;
      return [product.name, product.category, product.description]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle));
    });
  }, [menuProducts, searchQuery, selectedCategory]);

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  function openCreateModal() {
    setEditingProductId("");
    setFormState(EMPTY_FORM);
    setLocalImage(null);
    setImageError("");
    setModalVisible(true);
  }

  function openEditModal(product: MenuProduct) {
    setEditingProductId(String(product.id || ""));
    setFormState(buildFormState(product));
    setLocalImage(null);
    setImageError("");
    setModalVisible(true);
  }

  function closeModal() {
    if (saving || uploadingImage) return;
    setModalVisible(false);
    setEditingProductId("");
    setFormState(EMPTY_FORM);
    setLocalImage(null);
    setImageError("");
  }

  function updateField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setFormState((current) => ({ ...current, [field]: value }));
  }

  async function chooseImage(source: "camera" | "library") {
    try {
      setImageError("");
      const picked = await pickImage({
        source,
        aspect: [4, 3],
      });
      if (!picked) return;
      const compressed = await compressImage(picked.uri);
      setLocalImage({
        ...picked,
        uri: compressed.uri,
        fileName: compressed.fileName,
        mimeType: compressed.mimeType,
        width: compressed.width,
        height: compressed.height,
      });
    } catch (error) {
      Alert.alert("Image upload", getErrorMessage(error, "Could not prepare the image."));
    }
  }

  async function uploadSelectedImage() {
    if (!localImage?.uri) {
      return String(formState.imageUrl || "").trim();
    }
    setUploadingImage(true);
    setImageError("");
    try {
      const imageUrl = await uploadImage(localImage, "product_image");
      setFormState((current) => ({ ...current, imageUrl }));
      setLocalImage(null);
      return imageUrl;
    } catch (error) {
      setImageError(getErrorMessage(error, "Upload failed. Try again."));
      throw error;
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit() {
    const normalizedPrice = Number(formState.price);
    if (!String(formState.name || "").trim()) {
      Alert.alert("Produit", "Ajoute le nom du produit.");
      return;
    }
    if (!String(formState.category || "").trim()) {
      Alert.alert("Produit", "Ajoute une categorie.");
      return;
    }
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      Alert.alert("Produit", "Entre un prix valide en FCFA.");
      return;
    }

    setSaving(true);
    try {
      const uploadedImageUrl = await uploadSelectedImage();
      const payload = normalizeFormPayload(formState, uploadedImageUrl || formState.imageUrl);

      if (isEditing) {
        await updateProduct(editingProductId, payload);
        setSaveSuccessMessage("Product Updated Successfully");
      } else {
        await createProduct(payload);
        setSaveSuccessMessage("Product Added Successfully");
      }

      closeModal();
      setSaveSuccessVisible(true);
    } catch (error) {
      Alert.alert(
        isEditing ? "Mise a jour impossible" : "Creation impossible",
        getErrorMessage(error, "Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAvailability(product: MenuProduct) {
    setTogglingProductId(product.id);
    try {
      await toggleAvailability(product.id, !product.available);
    } catch (requestError) {
      Alert.alert(
        "Disponibilite",
        getErrorMessage(requestError, "Could not update availability.")
      );
    } finally {
      setTogglingProductId("");
    }
  }

  async function handleBulkAvailability(available: boolean) {
    setBulkLoading(available ? "available" : "unavailable");
    try {
      await bulkSetAvailability(available);
    } catch (requestError) {
      Alert.alert("Catalogue", getErrorMessage(requestError, "Could not update all products."));
    } finally {
      setBulkLoading("");
    }
  }

  function confirmDelete(product: MenuProduct) {
    Alert.alert(
      "Supprimer le produit",
      `Archive "${product.name}" from the live menu?`,
      [
        { text: "Back", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteProduct(product.id);
            } catch (requestError) {
              Alert.alert("Produit", getErrorMessage(requestError, "Could not archive the product."));
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={loading ? Array.from({ length: 4 }, (_, index) => ({ id: `skeleton-${index}` })) : filteredProducts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) =>
          loading ? (
            <ProductSkeletonCard />
          ) : (
            <ProductCard
              item={item as MenuProduct}
              currencyCode={currencyCode}
              onEdit={openEditModal}
              onDelete={confirmDelete}
              onToggleAvailability={handleToggleAvailability}
              toggling={togglingProductId === String(item.id)}
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshProducts().catch(() => null)}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <ScreenHeader
              title="Menu"
              subtitle="Pilote ton catalogue OranjeEats avec des visuels legers et rapides."
            />

            <View style={styles.searchCard}>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={18} color={colors.muted} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Rechercher un produit, une categorie..."
                  placeholderTextColor="#A8A29E"
                  style={styles.searchInput}
                />
              </View>
              <Text style={styles.connectionText}>
                {usingDemoData
                  ? "Mode demo actif. Reessaie quand la connexion revient."
                  : menuBusiness?.productImageUploadsEnabled
                    ? "Upload images actif"
                    : "Upload images indisponible"}
              </Text>
              {error ? (
                <View style={styles.errorChip}>
                  <Ionicons name="warning-outline" size={14} color={colors.primaryDark} />
                  <Text style={styles.errorChipText}>{error}</Text>
                </View>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
              {categoryTabs.map((category) => {
                const active = selectedCategory === category;
                return (
                  <Pressable
                    key={category}
                    onPress={() => setSelectedCategory(category)}
                    style={[styles.tabChip, active && styles.tabChipActive]}
                  >
                    <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{category}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryCardRow}>
              <Pressable
                style={[styles.categoryCard, selectedCategory === "Tous" && styles.categoryCardActive]}
                onPress={() => setSelectedCategory("Tous")}
              >
                <View style={styles.categoryCardIcon}>
                  <Ionicons name="apps-outline" size={22} color={colors.primaryDark} />
                </View>
                <Text style={styles.categoryCardTitle}>Tous les produits</Text>
                <Text style={styles.categoryCardMeta}>{menuProducts.length} articles</Text>
              </Pressable>

              {categorySummaries.map((category) => (
                <Pressable
                  key={category.id}
                  style={[styles.categoryCard, selectedCategory === category.name && styles.categoryCardActive]}
                  onPress={() => setSelectedCategory(category.name)}
                >
                  <View style={styles.categoryPreview}>
                    {category.imageUrl ? (
                      <Image
                        source={{ uri: category.imageUrl }}
                        style={styles.categoryPreviewImage}
                        contentFit="cover"
                        transition={150}
                        cachePolicy="disk"
                      />
                    ) : (
                      <View style={styles.categoryCardIcon}>
                        <Ionicons name="restaurant-outline" size={22} color={colors.primaryDark} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.categoryCardTitle}>{category.name}</Text>
                  <Text style={styles.categoryCardMeta}>{category.count} articles</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.controlsCard}>
              <Text style={styles.controlsTitle}>Actions rapides</Text>
              <View style={styles.controlsRow}>
                <OrangeButton
                  label="Tout rendre disponible"
                  variant="secondary"
                  loading={bulkLoading === "available"}
                  onPress={() => handleBulkAvailability(true)}
                  style={styles.controlButton}
                />
                <OrangeButton
                  label="Tout masquer"
                  variant="outline"
                  loading={bulkLoading === "unavailable"}
                  onPress={() => handleBulkAvailability(false)}
                  style={styles.controlButton}
                />
              </View>
            </View>

            {!loading && !filteredProducts.length ? (
              <View style={styles.emptyCard}>
                <Ionicons name="image-outline" size={28} color={colors.primaryDark} />
                <Text style={styles.emptyTitle}>Aucun produit visible</Text>
                <Text style={styles.emptyBody}>
                  Ajoute un produit ou change le filtre pour voir le catalogue complet.
                </Text>
              </View>
            ) : null}
          </>
        }
        ListFooterComponent={<View style={{ height: 120 }} />}
      />

      <Pressable style={styles.floatingButton} onPress={openCreateModal}>
        <Ionicons name="add" size={22} color="#FFFFFF" />
        <Text style={styles.floatingButtonText}>Add Product</Text>
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>{isEditing ? "Modifier le produit" : "Ajouter un produit"}</Text>
                <Text style={styles.modalSubtitle}>
                  Upload a light image, set the FCFA price, then publish to the menu.
                </Text>
              </View>
              <Pressable onPress={closeModal} style={styles.modalCloseButton}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.previewCard}>
                <View style={styles.previewImageFrame}>
                  {previewImageUri ? (
                    <Image
                      source={{ uri: previewImageUri }}
                      style={styles.previewImage}
                      contentFit="cover"
                      transition={150}
                      cachePolicy="disk"
                    />
                  ) : (
                    <View style={styles.previewPlaceholder}>
                      <Ionicons name="camera-outline" size={28} color={colors.muted} />
                      <Text style={styles.previewPlaceholderText}>No image yet</Text>
                    </View>
                  )}
                  {uploadingImage ? (
                    <View style={styles.previewOverlay}>
                      <ActivityIndicator color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>

                <View style={styles.imageActionRow}>
                  <OrangeButton
                    label="Camera"
                    variant="secondary"
                    onPress={() => chooseImage("camera").catch(() => null)}
                    style={styles.imageActionButton}
                  />
                  <OrangeButton
                    label="Gallery"
                    variant="outline"
                    onPress={() => chooseImage("library").catch(() => null)}
                    style={styles.imageActionButton}
                  />
                  <OrangeButton
                    label="Remove"
                    variant="ghost"
                    onPress={() => {
                      setLocalImage(null);
                      setFormState((current) => ({ ...current, imageUrl: "" }));
                      setImageError("");
                    }}
                    style={styles.imageActionButton}
                  />
                </View>

                {imageError ? (
                  <View style={styles.uploadErrorCard}>
                    <Text style={styles.uploadErrorText}>{imageError}</Text>
                    {localImage?.uri ? (
                      <OrangeButton
                        label="Retry upload"
                        variant="outline"
                        onPress={() => uploadSelectedImage().catch(() => null)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Product Name</Text>
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
                  placeholder="Meals"
                  placeholderTextColor="#A8A29E"
                  style={styles.input}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalCategoryRow}>
                  {categorySummaries.map((category) => {
                    const active = formState.category === category.name;
                    return (
                      <Pressable
                        key={category.id}
                        onPress={() => updateField("category", category.name)}
                        style={[styles.modalCategoryChip, active && styles.modalCategoryChipActive]}
                      >
                        <Text style={[styles.modalCategoryChipText, active && styles.modalCategoryChipTextActive]}>
                          {category.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Price (FCFA)</Text>
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
                <Text style={styles.fieldLabel}>Description</Text>
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

              <View style={styles.switchCard}>
                <View style={styles.switchTextWrap}>
                  <Text style={styles.fieldLabel}>Available now</Text>
                  <Text style={styles.switchHint}>Visible to customers as soon as you save.</Text>
                </View>
                <Switch
                  value={formState.available}
                  onValueChange={(value) => updateField("available", value)}
                  trackColor={{ false: "#D6D3D1", true: "#FFB47D" }}
                  thumbColor={formState.available ? colors.success : "#FFFFFF"}
                />
              </View>

              <View style={styles.modalFooterRow}>
                <OrangeButton label="Cancel" variant="outline" onPress={closeModal} style={styles.footerButton} />
                <OrangeButton
                  label="Save Product"
                  onPress={() => handleSubmit().catch(() => null)}
                  loading={saving}
                  style={styles.footerButton}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={saveSuccessVisible} transparent animationType="fade" onRequestClose={() => setSaveSuccessVisible(false)}>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark-circle" size={54} color={colors.success} />
            </View>
            <Text style={styles.successTitle}>{saveSuccessMessage}</Text>
            <Text style={styles.successBody}>Your menu is updated and ready for live Bamako orders.</Text>
            <OrangeButton label="View Menu" onPress={() => setSaveSuccessVisible(false)} style={styles.successButton} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 20,
    paddingBottom: 32,
  },
  searchCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    marginBottom: 14,
  },
  searchBar: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: "#FAFAF9",
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  connectionText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  errorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  errorChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  tabRow: {
    gap: 10,
    paddingBottom: 14,
  },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabChipText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
  },
  tabChipTextActive: {
    color: "#FFFFFF",
  },
  categoryCardRow: {
    gap: 12,
    paddingBottom: 14,
  },
  categoryCard: {
    width: 154,
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  categoryCardActive: {
    borderColor: colors.primary,
  },
  categoryPreview: {
    width: 54,
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  categoryPreviewImage: {
    width: "100%",
    height: "100%",
  },
  categoryCardIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  categoryCardMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  controlsCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    marginBottom: 14,
  },
  controlsTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  controlsRow: {
    gap: 10,
  },
  controlButton: {
    minHeight: 48,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    gap: 8,
    alignItems: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  emptyBody: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  productCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    marginBottom: 12,
  },
  productImageWrap: {
    width: 94,
    height: 94,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
  },
  productImage: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  productMain: {
    flex: 1,
    gap: 6,
  },
  productTitleRow: {
    gap: 8,
  },
  productName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  productMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  productDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  productFooter: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  productPrice: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
  },
  productQuickActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  iconActionDanger: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dangerSoft,
  },
  availabilityBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  availabilityBadgeOn: {
    backgroundColor: colors.successSoft,
  },
  availabilityBadgeOff: {
    backgroundColor: colors.dangerSoft,
  },
  availabilityBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  availabilityBadgeTextOn: {
    color: colors.success,
  },
  availabilityBadgeTextOff: {
    color: colors.danger,
  },
  skeletonBlock: {
    backgroundColor: "#E7E5E4",
  },
  skeletonLine: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#E7E5E4",
  },
  floatingButton: {
    position: "absolute",
    right: 20,
    bottom: 24,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#111111",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
  floatingButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17,17,17,0.42)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "92%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  modalHeaderText: {
    flex: 1,
    gap: 4,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  modalCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalContent: {
    gap: 14,
    paddingBottom: 20,
  },
  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  previewImageFrame: {
    width: "100%",
    height: 190,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#EEF2F7",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  previewPlaceholderText: {
    color: colors.muted,
    fontWeight: "700",
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,17,17,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  imageActionButton: {
    flex: 1,
    minHeight: 46,
  },
  uploadErrorCard: {
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: 18,
    padding: 12,
  },
  uploadErrorText: {
    color: colors.danger,
    fontWeight: "700",
    lineHeight: 18,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  textarea: {
    minHeight: 96,
  },
  modalCategoryRow: {
    gap: 8,
  },
  modalCategoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCategoryChipActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.primary,
  },
  modalCategoryChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  modalCategoryChipTextActive: {
    color: colors.primaryDark,
  },
  switchCard: {
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
    fontSize: 12,
    lineHeight: 18,
  },
  modalFooterRow: {
    flexDirection: "row",
    gap: 10,
  },
  footerButton: {
    flex: 1,
  },
  successOverlay: {
    flex: 1,
    backgroundColor: "rgba(17,17,17,0.38)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  successCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 22,
    gap: 12,
    alignItems: "center",
  },
  successIconWrap: {
    width: 78,
    height: 78,
    borderRadius: 999,
    backgroundColor: colors.successSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  successBody: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  successButton: {
    alignSelf: "stretch",
    marginTop: 8,
  },
});
