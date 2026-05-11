import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mockMenuItems } from "@/src/data/mockData";
import { apiRequest, toApiAssetUrl } from "@/src/lib/api";
import { getToken } from "@/src/lib/session";

function createError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

function normalizeCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "DOP") return "DOP";
  if (normalized === "GBP") return "GBP";
  return "XOF";
}

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProduct(product, businessCurrencyCode = "XOF") {
  const id = String(product?._id || product?.id || "").trim();
  if (!id) return null;

  return {
    id,
    name: String(product?.name || "Untitled item").trim() || "Untitled item",
    category: String(product?.category || "Uncategorized").trim() || "Uncategorized",
    description: String(product?.description || "").trim(),
    price: normalizeMoney(product?.price),
    imageUrl: normalizeImageUrl(
      product?.imageUrl ||
        product?.image?.url ||
        product?.photoUrl ||
        product?.thumbnailUrl ||
        ""
    ),
    available:
      typeof product?.isAvailable === "boolean"
        ? product.isAvailable
        : Boolean(product?.available),
    unavailableReason: String(product?.unavailableReason || "").trim(),
    currencyCode: normalizeCurrencyCode(
      product?.currencyCode || product?.currency || businessCurrencyCode
    ),
    raw: product,
  };
}

function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return toApiAssetUrl(raw);
  } catch {
    return raw;
  }
}

function extractProductsFromResponse(response) {
  const rows = Array.isArray(response)
    ? response
    : Array.isArray(response?.products)
      ? response.products
      : Array.isArray(response?.items)
        ? response.items
        : Array.isArray(response?.data)
          ? response.data
          : null;

  if (!rows) {
    throw createError("OranjeEats server returned an unexpected product response.", {
      code: "INVALID_PRODUCT_RESPONSE",
    });
  }

  const businessCurrencyCode = normalizeCurrencyCode(response?.business?.currencyCode);
  return rows
    .map((product) => normalizeProduct(product, businessCurrencyCode))
    .filter(Boolean);
}

async function getSessionToken() {
  const token = String((await getToken()) || "").trim();
  if (!token) {
    throw createError("You are not signed in. Please log in again.", {
      code: "MISSING_TOKEN",
      status: 401,
    });
  }
  return token;
}

async function submitAvailability(productId, isAvailable, token) {
  const productPath = `/api/merchant/products/${encodeURIComponent(String(productId || "").trim())}/availability`;
  const attempts = [
    () => apiRequest(productPath, "PATCH", { isAvailable }, token),
    () => apiRequest(productPath, "POST", { available: isAvailable, isAvailable }, token),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (error?.status === 404 || error?.status === 405) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Could not update product availability.");
}

export function useMerchantProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [categories, setCategories] = useState([]);
  const [business, setBusiness] = useState(null);

  const inFlightRef = useRef(false);
  const productsRef = useRef([]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const refreshProducts = useCallback(async (options = {}) => {
    const { silent = false } = options;

    if (inFlightRef.current) {
      return productsRef.current;
    }

    inFlightRef.current = true;
    if (!silent) {
      if (productsRef.current.length) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
    }

    try {
      const token = await getSessionToken();
      const response = await apiRequest("/api/merchant/products", "GET", undefined, token);
      const normalized = extractProductsFromResponse(response);
      setProducts(normalized);
      setCategories(
        Array.isArray(response?.categories)
          ? response.categories
              .map((category) => String(category?.name || category || "").trim())
              .filter(Boolean)
          : []
      );
      setBusiness(response?.business || null);
      setUsingDemoData(false);
      setError("");
      return normalized;
    } catch (requestError) {
      const status = requestError?.status;
      const message =
        requestError?.message ||
        "Cannot connect to OranjeEats server. Check EXPO_PUBLIC_API_URL and backend.";

      setError(message);

      if (status === 401 || status === 403 || requestError?.code === "MISSING_TOKEN") {
        setUsingDemoData(false);
        if (!productsRef.current.length) {
          setProducts([]);
        }
        return [];
      }

      const fallback = mockMenuItems.map((item) => ({
        ...item,
        currencyCode: normalizeCurrencyCode(item.currencyCode),
      }));

      if (!productsRef.current.length) {
        setProducts(fallback);
      }
      setCategories(
        Array.from(
          new Set(fallback.map((item) => String(item.category || "").trim()).filter(Boolean))
        )
      );
      setBusiness(null);
      setUsingDemoData(true);
      return productsRef.current.length ? productsRef.current : fallback;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const createProduct = useCallback(async (input) => {
    const token = await getSessionToken();
    const response = await apiRequest(
      "/api/merchant/products",
      "POST",
      {
        name: String(input?.name || "").trim(),
        category: String(input?.category || "").trim(),
        description: String(input?.description || "").trim(),
        price: normalizeMoney(input?.price),
        imageUrl: String(input?.imageUrl || "").trim(),
        isAvailable: Boolean(input?.available),
      },
      token
    );
    const normalized = normalizeProduct(response?.product || response?.item || response?.data || null);
    if (!normalized) {
      throw createError("OranjeEats server returned an unexpected product response.", {
        code: "INVALID_PRODUCT_RESPONSE",
      });
    }
    setProducts((current) => [normalized, ...current.filter((item) => item.id !== normalized.id)]);
    setUsingDemoData(false);
    setError("");
    return normalized;
  }, []);

  const updateProduct = useCallback(async (productId, input) => {
    const token = await getSessionToken();
    const response = await apiRequest(
      `/api/merchant/products/${encodeURIComponent(String(productId || "").trim())}`,
      "PATCH",
      {
        name: String(input?.name || "").trim(),
        category: String(input?.category || "").trim(),
        description: String(input?.description || "").trim(),
        price: normalizeMoney(input?.price),
        imageUrl: String(input?.imageUrl || "").trim(),
        isAvailable: Boolean(input?.available),
      },
      token
    );
    const normalized = normalizeProduct(response?.product || response?.item || response?.data || null);
    if (!normalized) {
      throw createError("OranjeEats server returned an unexpected product response.", {
        code: "INVALID_PRODUCT_RESPONSE",
      });
    }
    setProducts((current) =>
      current.map((item) => (item.id === normalized.id ? normalized : item))
    );
    setUsingDemoData(false);
    setError("");
    return normalized;
  }, []);

  const toggleAvailability = useCallback(async (productId, available) => {
    const token = await getSessionToken();
    const response = await submitAvailability(productId, available, token);
    const normalized = normalizeProduct(response?.product || response?.item || response?.data || null);

    setProducts((current) =>
      current.map((item) =>
        item.id === String(productId)
          ? normalized || {
              ...item,
              available,
              unavailableReason: available ? "" : item.unavailableReason || "out_of_stock",
            }
          : item
      )
    );
    setUsingDemoData(false);
    setError("");
    return normalized;
  }, []);

  const bulkSetAvailability = useCallback(async (available) => {
    const token = await getSessionToken();
    await apiRequest(
      "/api/merchant/products/bulk-availability",
      "POST",
      {
        mode: "all",
        available: Boolean(available),
        isAvailable: Boolean(available),
      },
      token
    );
    setProducts((current) =>
      current.map((item) => ({
        ...item,
        available: Boolean(available),
        unavailableReason: available ? "" : item.unavailableReason || "out_of_stock",
      }))
    );
    setUsingDemoData(false);
    setError("");
    return true;
  }, []);

  const deleteProduct = useCallback(async (productId) => {
    const token = await getSessionToken();
    await apiRequest(
      `/api/merchant/products/${encodeURIComponent(String(productId || "").trim())}`,
      "DELETE",
      undefined,
      token
    );
    setProducts((current) => current.filter((item) => item.id !== String(productId || "").trim()));
    setUsingDemoData(false);
    setError("");
    return true;
  }, []);

  useEffect(() => {
    refreshProducts().catch(() => null);
  }, [refreshProducts]);

  return useMemo(
    () => ({
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
    }),
    [
      business,
      bulkSetAvailability,
      categories,
      createProduct,
      deleteProduct,
      error,
      loading,
      products,
      refreshProducts,
      refreshing,
      toggleAvailability,
      updateProduct,
      usingDemoData,
    ]
  );
}
