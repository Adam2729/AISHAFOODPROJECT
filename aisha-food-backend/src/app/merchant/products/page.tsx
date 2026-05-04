"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MerchantPortalShell from "@/app/merchant/MerchantPortalShell";

type AvailabilityReason = "out_of_stock" | "busy" | "closed";
type ProductFilter = "active" | "available" | "unavailable" | "archived" | "all";

type Product = {
  _id: string;
  name: string;
  category: string;
  price: number;
  description?: string;
  imageUrl?: string;
  imageSource?: "external" | "upload" | null;
  quantityValue?: number | null;
  quantityUnit?: string;
  displaySize?: string;
  isAvailable: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  unavailableReason?: AvailabilityReason | null;
  unavailableUpdatedAt?: string | null;
  updatedAt?: string | null;
};

type CatalogCategory = {
  id: string;
  name: string;
  isArchived?: boolean;
  source?: "stored" | "product";
};

type MerchantBusinessContext = {
  id: string;
  name: string;
  type?: string;
  merchantType?: string;
  storeCategory?: string;
  cuisineType?: string;
  cityId?: string | null;
  cityCode?: string;
  cityName?: string;
  defaultLanguage?: "es" | "fr" | "bm" | "en";
  currencyCode?: string;
  currencyDisplay?: string;
  supportWhatsApp?: string;
  paymentMethods?: string[];
  timezone?: string;
  productImageUploadsEnabled?: boolean;
};

type MenuQualityPayload = {
  menuQuality: {
    productsTotalCount: number;
    productsActiveCount: number;
    productsWithImageCount: number;
    categoriesCount: number;
    menuQualityScore: number;
  };
  targets: {
    minProductsRequired: number;
    minScore: number;
  };
  checklist: {
    addProducts: boolean;
    addImages: boolean;
    addCategories: boolean;
    missingProducts: number;
    missingImages: number;
    missingCategories: number;
  };
  paused?: boolean;
  pausedReason?: string;
};

type BulkMode = "all" | "category" | "selected";

const REASONS: AvailabilityReason[] = ["out_of_stock", "busy", "closed"];
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const QUANTITY_UNITS = [
  "kg",
  "g",
  "litre",
  "ml",
  "piece",
  "pack",
  "bottle",
  "can",
  "box",
];
const INPUT_CLASS_NAME = "rounded-lg border border-slate-300 px-3 py-2";

const initialProductForm = {
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  price: "",
  quantityValue: "",
  quantityUnit: "",
  displaySize: "",
  isAvailable: true,
};

function formatDate(
  value: string | null | undefined,
  language: "es" | "fr",
  timezone?: string | null
) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "es-DO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone || undefined,
  }).format(date);
}

function formatMoney(
  value: number | string | null | undefined,
  currencyCode: string,
  language: "es" | "fr"
) {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "es-DO", {
    style: "currency",
    currency: currencyCode || "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function looksGeneratedName(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return /(product-\d+|^bko-product-|^demo-|^smoke-)/i.test(normalized);
}

function isValidProductImageUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/uploads/products/")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function productToForm(product: Product) {
  return {
    name: String(product.name || ""),
    category: String(product.category || ""),
    description: String(product.description || ""),
    imageUrl: String(product.imageUrl || ""),
    price: String(product.price ?? ""),
    quantityValue: product.quantityValue ? String(product.quantityValue) : "",
    quantityUnit: String(product.quantityUnit || ""),
    displaySize: String(product.displaySize || ""),
    isAvailable: product.isAvailable !== false,
  };
}

function normalizeCategoryName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function unitLabel(unit: string) {
  if (unit === "litre") return "L";
  if (unit === "piece") return "pcs";
  return unit;
}

export default function MerchantProductsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [business, setBusiness] = useState<MerchantBusinessContext | null>(null);
  const [menuQuality, setMenuQuality] = useState<MenuQualityPayload | null>(null);
  const [form, setForm] = useState(initialProductForm);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(initialProductForm);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rowReasonMap, setRowReasonMap] = useState<Record<string, AvailabilityReason>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkReason, setBulkReason] = useState<AvailabilityReason>("out_of_stock");
  const [statusFilter, setStatusFilter] = useState<ProductFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState("");
  const [createImageFile, setCreateImageFile] = useState<File | null>(null);
  const [createImagePreview, setCreateImagePreview] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState("");
  const [editRemoveImage, setEditRemoveImage] = useState(false);

  const language = business?.defaultLanguage === "fr" ? "fr" : "es";
  const currencyCode = String(business?.currencyCode || "DOP");
  const uploadsEnabled = business?.productImageUploadsEnabled !== false;
  const merchantType = String(business?.merchantType || business?.type || "restaurant");
  const measuredCatalog =
    String(business?.type || "") === "colmado" ||
    ["corner_shop", "grocery", "pharmacy"].includes(merchantType);

  const text = language === "fr"
    ? {
        refresh: "Actualiser",
        createSection: measuredCatalog ? "Ajouter un article" : "Creer un produit",
        name: measuredCatalog ? "Nom de l'article" : "Nom du produit",
        category: "Categorie",
        description: "Description",
        imageUrl: "URL de l'image",
        price: `Prix ${business?.currencyDisplay || currencyCode}`,
        size: "Taille / quantite",
        quantityValue: "Valeur",
        quantityUnit: "Unite",
        displaySize: "Libelle affiche (optionnel)",
        sizeHint: "Exemples: 2 kg, 500 ml, 12 pcs, 6 pack.",
        available: "Disponible",
        unavailable: "Indisponible",
        archived: "Archive",
        active: "Actif",
        all: "Tous",
        creating: "Creation...",
        save: "Enregistrer",
        saving: "Enregistrement...",
        cancel: "Annuler",
        edit: "Modifier",
        archive: "Archiver",
        archiving: "Archivage...",
        archiveConfirm: "Archiver ce produit ? Il disparaitra du menu client mais restera dans l'historique.",
        categoryArchiveConfirm: "Archiver cette categorie ? Les produits gardent leur libelle jusqu'a modification.",
        setAvailable: "Disponible",
        setUnavailable: "Rupture",
        products: "Catalogue",
        categories: "Categories",
        newCategory: "Nouvelle categorie",
        createCategory: "Ajouter",
        rename: "Renommer",
        bulk: "Actions rapides",
        selectCategory: "Choisir une categorie",
        filterCategory: "Filtrer par categorie",
        selectedUnavailable: "Selection en rupture",
        selectedAvailable: "Selection disponible",
        categoryUnavailable: "Categorie en rupture",
        categoryAvailable: "Categorie disponible",
        allUnavailable: "Tout en rupture",
        allAvailable: "Tout disponible",
        availability: "Disponibilite",
        reason: "Motif",
        updated: "Mis a jour",
        actions: "Actions",
        current: "Actuel",
        noProducts: "Aucun produit dans ce filtre.",
        loadError: "Impossible de charger le catalogue.",
        createError: "Impossible de creer le produit.",
        updateError: "Impossible de mettre a jour le produit.",
        archiveError: "Impossible d'archiver le produit.",
        categoryError: "Impossible de mettre a jour la categorie.",
        bulkError: "La mise a jour en masse a echoue.",
        generatedHint: "Nom genere, pense a le renommer.",
        imageUpload: "Importer une image",
        imageUploadHint: "JPG, PNG ou WebP. Maximum 5 Mo. Une image importee remplace l'URL.",
        imageUnavailable: "Import indisponible; utilise une URL d'image.",
        imagePreview: "Apercu image",
        removeImage: "Retirer l'image",
        successCreate: "Produit cree.",
        successUpdate: "Produit mis a jour.",
        successArchive: "Produit archive.",
        successCategory: "Categorie mise a jour.",
        validationName: "Le nom est requis.",
        validationCategory: "La categorie est requise.",
        validationPrice: "Le prix doit etre superieur a zero.",
        validationQuantity: "La quantite doit etre positive et accompagnee d'une unite.",
        validationImageUrl: "L'URL image doit commencer par http:// ou https://.",
        validationImageFile: "L'image doit etre JPG, PNG ou WebP et faire 5 Mo maximum.",
      }
    : {
        refresh: "Actualizar",
        createSection: measuredCatalog ? "Agregar articulo" : "Crear producto",
        name: measuredCatalog ? "Nombre del articulo" : "Nombre del producto",
        category: "Categoria",
        description: "Descripcion",
        imageUrl: "URL de la imagen",
        price: `Precio ${business?.currencyDisplay || currencyCode}`,
        size: "Tamano / cantidad",
        quantityValue: "Valor",
        quantityUnit: "Unidad",
        displaySize: "Etiqueta visible (opcional)",
        sizeHint: "Ejemplos: 2 kg, 500 ml, 12 pcs, 6 pack.",
        available: "Disponible",
        unavailable: "No disponible",
        archived: "Archivado",
        active: "Activo",
        all: "Todos",
        creating: "Creando...",
        save: "Guardar",
        saving: "Guardando...",
        cancel: "Cancelar",
        edit: "Editar",
        archive: "Archivar",
        archiving: "Archivando...",
        archiveConfirm: "Archivar este producto? Saldra del menu cliente pero queda en el historial.",
        categoryArchiveConfirm: "Archivar esta categoria? Los productos conservan la etiqueta hasta reasignarlos.",
        setAvailable: "Disponible",
        setUnavailable: "Agotado",
        products: "Catalogo",
        categories: "Categorias",
        newCategory: "Nueva categoria",
        createCategory: "Agregar",
        rename: "Renombrar",
        bulk: "Acciones rapidas",
        selectCategory: "Selecciona categoria",
        filterCategory: "Filtrar por categoria",
        selectedUnavailable: "Seleccionados agotados",
        selectedAvailable: "Seleccionados disponibles",
        categoryUnavailable: "Categoria agotada",
        categoryAvailable: "Categoria disponible",
        allUnavailable: "Todo agotado",
        allAvailable: "Todo disponible",
        availability: "Disponibilidad",
        reason: "Motivo",
        updated: "Actualizado",
        actions: "Acciones",
        current: "Actual",
        noProducts: "No hay productos en este filtro.",
        loadError: "No fue posible cargar el catalogo.",
        createError: "No fue posible crear el producto.",
        updateError: "No fue posible actualizar el producto.",
        archiveError: "No fue posible archivar el producto.",
        categoryError: "No fue posible actualizar la categoria.",
        bulkError: "La actualizacion masiva fallo.",
        generatedHint: "Nombre generado; conviene renombrarlo antes del piloto.",
        imageUpload: "Subir imagen",
        imageUploadHint: "JPG, PNG o WebP. Maximo 5 MB. Una imagen subida reemplaza la URL.",
        imageUnavailable: "La subida no esta disponible; usa una URL de imagen.",
        imagePreview: "Vista previa",
        removeImage: "Quitar imagen",
        successCreate: "Producto creado.",
        successUpdate: "Producto actualizado.",
        successArchive: "Producto archivado.",
        successCategory: "Categoria actualizada.",
        validationName: "El nombre es obligatorio.",
        validationCategory: "La categoria es obligatoria.",
        validationPrice: "El precio debe ser mayor que cero.",
        validationQuantity: "La cantidad debe ser positiva y tener unidad.",
        validationImageUrl: "La URL de imagen debe empezar con http:// o https://.",
        validationImageFile: "La imagen debe ser JPG, PNG o WebP y pesar maximo 5 MB.",
      };

  const reasonLabels: Record<AvailabilityReason, string> = {
    out_of_stock: language === "fr" ? "Rupture de stock" : "Sin inventario",
    busy: language === "fr" ? "Charge elevee" : "Alta demanda",
    closed: language === "fr" ? "Ferme" : "Cerrado",
  };

  const activeCategoryNames = useMemo(() => {
    const names = new Set<string>();
    for (const category of categories) {
      const name = normalizeCategoryName(category.name);
      if (name && !category.isArchived) names.add(name);
    }
    for (const row of rows) {
      const name = normalizeCategoryName(row.category);
      if (name && !row.isArchived) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, language === "fr" ? "fr" : "es"));
  }, [categories, language, rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const archived = Boolean(row.isArchived);
      if (statusFilter === "active" && archived) return false;
      if (statusFilter === "available" && (archived || !row.isAvailable)) return false;
      if (statusFilter === "unavailable" && (archived || row.isAvailable)) return false;
      if (statusFilter === "archived" && !archived) return false;
      if (categoryFilter && normalizeCategoryName(row.category) !== categoryFilter) return false;
      return true;
    });
  }, [categoryFilter, rows, statusFilter]);

  function validateImageFile(file: File | null) {
    if (!file) return "";
    if (!PRODUCT_IMAGE_TYPES.has(file.type) || file.size > PRODUCT_IMAGE_MAX_BYTES) {
      return text.validationImageFile;
    }
    return "";
  }

  function validateProductInput(input: typeof initialProductForm, file: File | null) {
    const nextErrors: Record<string, string> = {};
    const quantityValue = String(input.quantityValue || "").trim();
    const quantityUnit = String(input.quantityUnit || "").trim();
    if (!String(input.name || "").trim()) nextErrors.name = text.validationName;
    if (!String(input.category || "").trim()) nextErrors.category = text.validationCategory;
    if (!Number.isFinite(Number(input.price)) || Number(input.price) <= 0) {
      nextErrors.price = text.validationPrice;
    }
    if ((quantityValue || quantityUnit) && (!quantityValue || !quantityUnit || Number(quantityValue) <= 0)) {
      nextErrors.quantity = text.validationQuantity;
    }
    if (!isValidProductImageUrl(String(input.imageUrl || ""))) {
      nextErrors.imageUrl = text.validationImageUrl;
    }
    const fileError = validateImageFile(file);
    if (fileError) nextErrors.imageFile = fileError;
    return nextErrors;
  }

  function updateImageFile(target: "create" | "edit", file: File | null) {
    const fileError = validateImageFile(file);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (fileError) next.imageFile = fileError;
      else delete next.imageFile;
      return next;
    });

    if (fileError) {
      if (target === "create") {
        setCreateImageFile(null);
        setCreateImagePreview("");
      } else {
        setEditImageFile(null);
      }
      return;
    }

    const preview = file ? URL.createObjectURL(file) : "";
    if (target === "create") {
      setCreateImageFile(file);
      setCreateImagePreview(preview);
    } else {
      setEditImageFile(file);
      setEditImagePreview(preview || editForm.imageUrl);
      if (file) setEditRemoveImage(false);
    }
  }

  function appendProductFormData(data: FormData, input: typeof initialProductForm) {
    data.set("name", String(input.name || "").trim());
    data.set("category", String(input.category || "").trim());
    data.set("description", String(input.description || "").trim());
    data.set("imageUrl", String(input.imageUrl || "").trim());
    data.set("price", String(Number(input.price)));
    data.set("quantityValue", String(input.quantityValue || "").trim());
    data.set("quantityUnit", String(input.quantityUnit || "").trim());
    data.set("displaySize", String(input.displaySize || "").trim());
    data.set("isAvailable", String(input.isAvailable));
  }

  async function load() {
    const [productsRes, categoriesRes, menuQualityRes] = await Promise.all([
      fetch("/api/merchant/products", { cache: "no-store" }),
      fetch("/api/merchant/categories", { cache: "no-store" }),
      fetch("/api/merchant/menu-quality", { cache: "no-store" }),
    ]);
    const productsJson = await productsRes.json().catch(() => null);
    if (!productsRes.ok || !productsJson?.ok) {
      setError(productsJson?.error?.message || productsJson?.error || text.loadError);
      if (productsRes.status === 401) router.push("/merchant/login");
      if (productsJson?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }

    const categoriesJson = await categoriesRes.json().catch(() => null);
    if (categoriesRes.ok && categoriesJson?.ok) {
      setCategories(Array.isArray(categoriesJson.categories) ? categoriesJson.categories : []);
    } else {
      setCategories(Array.isArray(productsJson.categories) ? productsJson.categories : []);
    }

    const menuQualityJson = await menuQualityRes.json().catch(() => null);
    if (menuQualityRes.ok && menuQualityJson?.ok) {
      setMenuQuality(menuQualityJson as MenuQualityPayload);
    }

    const nextRows = Array.isArray(productsJson.products) ? (productsJson.products as Product[]) : [];
    setBusiness((productsJson.business as MerchantBusinessContext | null) || null);
    setRows(nextRows);
    setSelectedIds((prev) => prev.filter((id) => nextRows.some((row) => row._id === id && !row.isArchived)));
    setRowReasonMap((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!next[row._id]) {
          const reason = row.unavailableReason || "out_of_stock";
          next[row._id] = REASONS.includes(reason as AvailabilityReason)
            ? (reason as AvailabilityReason)
            : "out_of_stock";
        }
      }
      return next;
    });
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(product: Product) {
    setEditingId(product._id);
    setEditForm(productToForm(product));
    setEditImageFile(null);
    setEditImagePreview(String(product.imageUrl || ""));
    setEditRemoveImage(false);
    setFieldErrors({});
    setError("");
    setSuccess("");
  }

  function cancelEdit() {
    setEditingId("");
    setEditForm(initialProductForm);
    setEditImageFile(null);
    setEditImagePreview("");
    setEditRemoveImage(false);
    setFieldErrors({});
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const nextErrors = validateProductInput(form, createImageFile);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusyAction("create");
    const payload = new FormData();
    appendProductFormData(payload, form);
    if (createImageFile) payload.set("imageFile", createImageFile);
    const res = await fetch("/api/merchant/products", {
      method: "POST",
      body: payload,
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.createError);
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    setForm(initialProductForm);
    setCreateImageFile(null);
    setCreateImagePreview("");
    setFieldErrors({});
    setSuccess(text.successCreate);
    await load();
  }

  async function saveEdit(productId: string) {
    setError("");
    setSuccess("");
    const nextErrors = validateProductInput(editForm, editImageFile);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusyAction(`edit:${productId}`);
    const payload = new FormData();
    appendProductFormData(payload, editForm);
    payload.set("removeImage", String(editRemoveImage));
    if (editImageFile) payload.set("imageFile", editImageFile);
    const res = await fetch(`/api/merchant/products/${productId}`, {
      method: "PATCH",
      body: payload,
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.updateError);
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    cancelEdit();
    setSuccess(text.successUpdate);
    await load();
  }

  async function updateAvailability(product: Product, nextIsAvailable: boolean) {
    setError("");
    setBusyAction(`row:${product._id}`);
    const reason = rowReasonMap[product._id] || "out_of_stock";
    const res = await fetch(`/api/merchant/products/${product._id}/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isAvailable: nextIsAvailable,
        reason,
      }),
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.updateError);
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    await load();
  }

  async function runBulk(mode: BulkMode, isAvailable: boolean) {
    setError("");
    setBusyAction(`bulk:${mode}:${isAvailable ? "on" : "off"}`);
    const payload: Record<string, unknown> = {
      mode,
      isAvailable,
      reason: bulkReason,
    };
    if (mode === "category") payload.category = bulkCategory;
    if (mode === "selected") payload.productIds = selectedIds;

    const res = await fetch("/api/merchant/products/bulk-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) || text.bulkError
      );
      return;
    }
    await load();
  }

  async function archiveProduct(productId: string) {
    if (!window.confirm(text.archiveConfirm)) return;
    setError("");
    setSuccess("");
    setBusyAction(`archive:${productId}`);
    const res = await fetch(`/api/merchant/products/${productId}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.archiveError);
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    if (editingId === productId) cancelEdit();
    setSuccess(text.successArchive);
    await load();
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = normalizeCategoryName(categoryName);
    if (!name) return;
    setError("");
    setBusyAction("category:create");
    const res = await fetch("/api/merchant/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.categoryError);
      return;
    }
    setCategoryName("");
    setSuccess(text.successCategory);
    await load();
  }

  async function renameCategory(categoryId: string) {
    const name = normalizeCategoryName(editingCategoryName);
    if (!categoryId || !name) return;
    setError("");
    setBusyAction(`category:${categoryId}`);
    const res = await fetch(`/api/merchant/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.categoryError);
      return;
    }
    setEditingCategoryId("");
    setEditingCategoryName("");
    setSuccess(text.successCategory);
    await load();
  }

  async function archiveCategory(category: CatalogCategory) {
    if (!category.id || !window.confirm(text.categoryArchiveConfirm)) return;
    setError("");
    setBusyAction(`category:${category.id}`);
    const res = await fetch(`/api/merchant/categories/${category.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || text.categoryError);
      return;
    }
    setSuccess(text.successCategory);
    await load();
  }

  function renderSizeFields(
    currentForm: typeof initialProductForm,
    setCurrentForm: (value: typeof initialProductForm) => void
  ) {
    if (!measuredCatalog) return null;
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold">{text.size}</p>
        <p className="mt-1 text-xs text-slate-500">{text.sizeHint}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr,1fr]">
          <input
            className={INPUT_CLASS_NAME}
            inputMode="decimal"
            value={currentForm.quantityValue}
            onChange={(e) => setCurrentForm({ ...currentForm, quantityValue: e.target.value })}
            placeholder={text.quantityValue}
          />
          <select
            className={INPUT_CLASS_NAME}
            value={currentForm.quantityUnit}
            onChange={(e) => setCurrentForm({ ...currentForm, quantityUnit: e.target.value })}
          >
            <option value="">{text.quantityUnit}</option>
            {QUANTITY_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </select>
        </div>
        <input
          className={`${INPUT_CLASS_NAME} mt-2 w-full`}
          value={currentForm.displaySize}
          onChange={(e) => setCurrentForm({ ...currentForm, displaySize: e.target.value })}
          placeholder={text.displaySize}
        />
        {fieldErrors.quantity ? <p className="mt-2 text-xs text-red-600">{fieldErrors.quantity}</p> : null}
      </div>
    );
  }

  return (
    <MerchantPortalShell
      title="Menu / Products"
      subtitle="Create, edit, archive, and control the catalog customers see."
      actions={
        <button
          type="button"
          onClick={load}
          className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {text.refresh}
        </button>
      }
    >
      {menuQuality ? (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {language === "fr" ? "Qualite du menu" : "Calidad del menu"}:{" "}
                {Number(menuQuality.menuQuality.menuQualityScore || 0)}/100
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {language === "fr" ? "Objectif minimum" : "Objetivo minimo"}:{" "}
                {menuQuality.targets.minScore}
              </p>
              {menuQuality.paused && menuQuality.pausedReason ? (
                <p className="mt-1 text-sm font-semibold text-red-700">
                  {menuQuality.pausedReason}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="font-bold">{menuQuality.menuQuality.productsActiveCount}</div>
                <div>{text.active}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="font-bold">{menuQuality.menuQuality.productsWithImageCount}</div>
                <div>Images</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="font-bold">{menuQuality.menuQuality.categoriesCount}</div>
                <div>{text.categories}</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.9fr),minmax(0,1.6fr)]">
        <div className="space-y-4">
          <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">{text.createSection}</h2>
            <div className="mt-3 grid gap-2">
              <input
                className={INPUT_CLASS_NAME}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={text.name}
              />
              {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name}</p> : null}
              <input
                className={INPUT_CLASS_NAME}
                list="merchant-category-options"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder={text.category}
              />
              {fieldErrors.category ? <p className="text-xs text-red-600">{fieldErrors.category}</p> : null}
              <textarea
                className={INPUT_CLASS_NAME}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={text.description}
              />
              {renderSizeFields(form, setForm)}
              <input
                className={INPUT_CLASS_NAME}
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder={text.imageUrl}
              />
              {fieldErrors.imageUrl ? <p className="text-xs text-red-600">{fieldErrors.imageUrl}</p> : null}
              <label className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
                <span className="block font-semibold">{text.imageUpload}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {uploadsEnabled ? text.imageUploadHint : text.imageUnavailable}
                </span>
                <input
                  className="mt-2 block w-full text-xs"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!uploadsEnabled}
                  onChange={(event) => updateImageFile("create", event.target.files?.[0] || null)}
                />
              </label>
              {fieldErrors.imageFile ? <p className="text-xs text-red-600">{fieldErrors.imageFile}</p> : null}
              {createImagePreview || form.imageUrl ? (
                <div className="rounded-lg border border-slate-200 p-2">
                  <p className="mb-2 text-xs font-semibold text-slate-500">{text.imagePreview}</p>
                  <img
                    src={createImagePreview || form.imageUrl}
                    alt=""
                    className="h-32 w-full rounded-lg object-cover"
                  />
                </div>
              ) : null}
              <input
                className={INPUT_CLASS_NAME}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder={text.price}
              />
              {fieldErrors.price ? <p className="text-xs text-red-600">{fieldErrors.price}</p> : null}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isAvailable}
                  onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
                />
                {text.available}
              </label>
              <button
                disabled={busyAction === "create"}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {busyAction === "create" ? text.creating : text.createSection}
              </button>
            </div>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}
          </form>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">{text.categories}</h2>
            <form onSubmit={createCategory} className="mt-3 flex gap-2">
              <input
                className={`${INPUT_CLASS_NAME} min-w-0 flex-1`}
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder={text.newCategory}
              />
              <button
                type="submit"
                disabled={busyAction === "category:create" || !normalizeCategoryName(categoryName)}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {text.createCategory}
              </button>
            </form>
            <div className="mt-3 space-y-2">
              {categories
                .filter((category) => !category.isArchived)
                .map((category) => {
                  const editing = editingCategoryId === category.id;
                  return (
                    <div key={`${category.id || "derived"}:${category.name}`} className="rounded-lg border border-slate-200 p-2 text-sm">
                      {editing ? (
                        <div className="flex flex-wrap gap-2">
                          <input
                            className={`${INPUT_CLASS_NAME} min-w-0 flex-1`}
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                          />
                          <button
                            type="button"
                            disabled={busyAction === `category:${category.id}`}
                            onClick={() => renameCategory(category.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            {text.save}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategoryId("");
                              setEditingCategoryName("");
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            {text.cancel}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{category.name}</span>
                          {category.id ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCategoryId(category.id);
                                  setEditingCategoryName(category.name);
                                }}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                              >
                                {text.rename}
                              </button>
                              <button
                                type="button"
                                onClick={() => archiveCategory(category)}
                                className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
                              >
                                {text.archive}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">from products</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{text.products}</h2>
            <button
              type="button"
              onClick={load}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              {text.refresh}
            </button>
          </div>

          <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[1fr,1fr]">
              <select
                className={`${INPUT_CLASS_NAME} text-sm`}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ProductFilter)}
              >
              <option value="active">{text.active}</option>
              <option value="available">{text.available}</option>
              <option value="unavailable">{text.unavailable}</option>
              <option value="archived">{text.archived}</option>
              <option value="all">{text.all}</option>
            </select>
              <select
                className={`${INPUT_CLASS_NAME} text-sm`}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
              <option value="">{text.filterCategory}</option>
              {activeCategoryNames.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{text.bulk}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className={`${INPUT_CLASS_NAME} text-sm`}
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value as AvailabilityReason)}
                >
                {REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {text.reason}: {reasonLabels[reason]}
                  </option>
                ))}
              </select>
                <select
                  className={`${INPUT_CLASS_NAME} text-sm`}
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                >
                <option value="">{text.selectCategory}</option>
                {activeCategoryNames.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => runBulk("selected", false)} disabled={!selectedIds.length || busyAction.startsWith("bulk:")} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                {text.selectedUnavailable}
              </button>
              <button type="button" onClick={() => runBulk("selected", true)} disabled={!selectedIds.length || busyAction.startsWith("bulk:")} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                {text.selectedAvailable}
              </button>
              <button type="button" onClick={() => runBulk("category", false)} disabled={!bulkCategory || busyAction.startsWith("bulk:")} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                {text.categoryUnavailable}
              </button>
              <button type="button" onClick={() => runBulk("category", true)} disabled={!bulkCategory || busyAction.startsWith("bulk:")} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                {text.categoryAvailable}
              </button>
              <button type="button" onClick={() => runBulk("all", false)} disabled={busyAction.startsWith("bulk:")} className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700">
                {text.allUnavailable}
              </button>
              <button type="button" onClick={() => runBulk("all", true)} disabled={busyAction.startsWith("bulk:")} className="rounded border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                {text.allAvailable}
              </button>
            </div>
          </div>

          <datalist id="merchant-category-options">
            {activeCategoryNames.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">
                    <input
                      type="checkbox"
                      checked={
                        visibleRows.filter((row) => !row.isArchived).length > 0 &&
                        selectedIds.length === visibleRows.filter((row) => !row.isArchived).length
                      }
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked
                            ? visibleRows.filter((row) => !row.isArchived).map((row) => row._id)
                            : []
                        )
                      }
                    />
                  </th>
                  <th className="pb-2">Image</th>
                  <th className="pb-2">{text.name}</th>
                  <th className="pb-2">{text.category}</th>
                  <th className="pb-2">{text.size}</th>
                  <th className="pb-2">{text.price}</th>
                  <th className="pb-2">{text.availability}</th>
                  <th className="pb-2">{text.updated}</th>
                  <th className="pb-2">{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length ? (
                  visibleRows.map((product) => {
                    const rowBusy = busyAction === `row:${product._id}`;
                    const rowArchiveBusy = busyAction === `archive:${product._id}`;
                    const rowEditBusy = busyAction === `edit:${product._id}`;
                    const reason = rowReasonMap[product._id] || "out_of_stock";
                    const editing = editingId === product._id;
                    const archived = Boolean(product.isArchived);
                    return (
                      <Fragment key={product._id}>
                        <tr className={`border-t border-slate-100 align-top ${archived ? "bg-slate-50 text-slate-500" : ""}`}>
                          <td className="py-2">
                            <input
                              type="checkbox"
                              disabled={archived}
                              checked={selectedIds.includes(product._id)}
                              onChange={(e) =>
                                setSelectedIds((prev) =>
                                  e.target.checked
                                    ? [...prev, product._id]
                                    : prev.filter((id) => id !== product._id)
                                )
                              }
                            />
                          </td>
                          <td className="py-2">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt=""
                                className="h-14 w-14 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-400">
                                No image
                              </div>
                            )}
                          </td>
                          <td className="py-2 font-medium">
                            <div>{product.name}</div>
                            {product.displaySize ? (
                              <p className="text-xs text-slate-500">{product.displaySize}</p>
                            ) : null}
                            {looksGeneratedName(product.name) ? (
                              <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
                                {text.generatedHint}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2">{product.category || "-"}</td>
                          <td className="py-2">{product.displaySize || "-"}</td>
                          <td className="py-2">{formatMoney(product.price, currencyCode, language)}</td>
                          <td className="py-2">
                            {archived ? (
                              <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                                {text.archived}
                              </span>
                            ) : product.isAvailable ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                                {text.available}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                                {text.unavailable}
                              </span>
                            )}
                            {!archived ? (
                              <select
                                className={`${INPUT_CLASS_NAME} mt-2 text-xs`}
                                value={reason}
                                onChange={(e) =>
                                  setRowReasonMap((prev) => ({
                                    ...prev,
                                    [product._id]: e.target.value as AvailabilityReason,
                                  }))
                                }
                              >
                                {REASONS.map((entry) => (
                                  <option key={entry} value={entry}>
                                    {reasonLabels[entry]}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            {!product.isAvailable && product.unavailableReason ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {text.current}: {reasonLabels[product.unavailableReason]}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2 text-xs text-slate-500">
                            {formatDate(
                              product.archivedAt || product.unavailableUpdatedAt || product.updatedAt,
                              language,
                              business?.timezone
                            )}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-2">
                              {!archived ? (
                                <button
                                  type="button"
                                  disabled={rowBusy || rowArchiveBusy || rowEditBusy}
                                  onClick={() => updateAvailability(product, !product.isAvailable)}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                                >
                                  {rowBusy
                                    ? text.saving
                                    : product.isAvailable
                                    ? text.setUnavailable
                                    : text.setAvailable}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={rowBusy || rowArchiveBusy || rowEditBusy}
                                onClick={() => startEdit(product)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                              >
                                {text.edit}
                              </button>
                              {!archived ? (
                                <button
                                  type="button"
                                  disabled={rowBusy || rowArchiveBusy || rowEditBusy}
                                  onClick={() => archiveProduct(product._id)}
                                  className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
                                >
                                  {rowArchiveBusy ? text.archiving : text.archive}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>

                        {editing ? (
                          <tr className="border-t border-slate-50 bg-slate-50">
                            <td colSpan={9} className="p-3">
                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="grid gap-2 md:grid-cols-2">
                                  <input
                                    className={INPUT_CLASS_NAME}
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    placeholder={text.name}
                                  />
                                  <input
                                    className={INPUT_CLASS_NAME}
                                    list="merchant-category-options"
                                    value={editForm.category}
                                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                    placeholder={text.category}
                                  />
                                  <input
                                    className={INPUT_CLASS_NAME}
                                    value={editForm.price}
                                    onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                                    placeholder={text.price}
                                  />
                                  <input
                                    className={INPUT_CLASS_NAME}
                                    value={editForm.imageUrl}
                                    onChange={(e) => {
                                      setEditForm({ ...editForm, imageUrl: e.target.value });
                                      if (!editImageFile) setEditImagePreview(e.target.value);
                                      setEditRemoveImage(false);
                                    }}
                                    placeholder={text.imageUrl}
                                  />
                                  <textarea
                                    className={`${INPUT_CLASS_NAME} md:col-span-2`}
                                    value={editForm.description}
                                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                    placeholder={text.description}
                                  />
                                </div>
                                <div className="mt-3">{renderSizeFields(editForm, setEditForm)}</div>
                                {fieldErrors.name ? <p className="mt-2 text-xs text-red-600">{fieldErrors.name}</p> : null}
                                {fieldErrors.category ? <p className="mt-2 text-xs text-red-600">{fieldErrors.category}</p> : null}
                                {fieldErrors.price ? <p className="mt-2 text-xs text-red-600">{fieldErrors.price}</p> : null}
                                {fieldErrors.imageUrl ? <p className="mt-2 text-xs text-red-600">{fieldErrors.imageUrl}</p> : null}
                                <label className="mt-3 flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={editForm.isAvailable}
                                    disabled={archived}
                                    onChange={(event) => setEditForm({ ...editForm, isAvailable: event.target.checked })}
                                  />
                                  {text.available}
                                </label>
                                <div className="mt-3 grid gap-3 md:grid-cols-[1fr,160px]">
                                  <label className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
                                    <span className="block font-semibold">{text.imageUpload}</span>
                                    <span className="mt-1 block text-xs text-slate-500">
                                      {uploadsEnabled ? text.imageUploadHint : text.imageUnavailable}
                                    </span>
                                    <input
                                      className="mt-2 block w-full text-xs"
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      disabled={!uploadsEnabled}
                                      onChange={(event) => updateImageFile("edit", event.target.files?.[0] || null)}
                                    />
                                    {fieldErrors.imageFile ? <p className="mt-2 text-xs text-red-600">{fieldErrors.imageFile}</p> : null}
                                  </label>
                                  {editImagePreview && !editRemoveImage ? (
                                    <img
                                      src={editImagePreview}
                                      alt=""
                                      className="h-32 w-full rounded-lg object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-32 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-400">
                                      No image
                                    </div>
                                  )}
                                </div>
                                <label className="mt-3 flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={editRemoveImage}
                                    onChange={(event) => {
                                      setEditRemoveImage(event.target.checked);
                                      if (event.target.checked) {
                                        setEditImageFile(null);
                                        setEditImagePreview("");
                                        setEditForm({ ...editForm, imageUrl: "" });
                                      }
                                    }}
                                  />
                                  {text.removeImage}
                                </label>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={rowEditBusy}
                                    onClick={() => saveEdit(product._id)}
                                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                  >
                                    {rowEditBusy ? text.saving : text.save}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={rowEditBusy}
                                    onClick={cancelEdit}
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                                  >
                                    {text.cancel}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-3 text-center text-slate-500">
                      {text.noProducts}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

    </MerchantPortalShell>
  );
}
