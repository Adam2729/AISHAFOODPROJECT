import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";

export type PopularProduct = {
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  category: string;
  scoreCount: number;
};

export type Combo = {
  comboId: string;
  titleEs: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    imageUrl: string;
    category: string;
  }>;
  totalPrice: number;
  savingsLabelEs?: string;
};

type EnhancementsResult = {
  popular: PopularProduct[];
  bestValue: PopularProduct[];
  combos: Combo[];
  meta: {
    windowDays: number;
    computedAt: string;
  };
};

type PopularAggRow = {
  _id: mongoose.Types.ObjectId;
  scoreCount: number;
  snapshotName?: string;
  snapshotCategory?: string;
};

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  price?: number;
  imageUrl?: string;
  category?: string;
  isAvailable?: boolean;
};

type CacheEntry = {
  expiresAt: number;
  value: EnhancementsResult;
};

const CACHE_TTL_MS = 60 * 1000;
const enhancementCache = new Map<string, CacheEntry>();
const SIDE_DRINK_KEYWORDS = [
  "bebida",
  "refresco",
  "jugo",
  "jugo",
  "soda",
  "agua",
  "side",
  "acompan",
  "papas",
  "yuca",
];

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function keyForCache(businessId: string, days: number) {
  return `${process.env.NODE_ENV || "development"}:${businessId}:${days}`;
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categoryKey(product: PopularProduct) {
  const category = String(product.category || "").trim().toLowerCase();
  return category || "uncategorized";
}

function scoreByImagePriceName(left: PopularProduct, right: PopularProduct) {
  const leftImage = left.imageUrl ? 1 : 0;
  const rightImage = right.imageUrl ? 1 : 0;
  if (leftImage !== rightImage) return rightImage - leftImage;
  if (left.price !== right.price) return left.price - right.price;
  return left.name.localeCompare(right.name, "es");
}

function computeMedianPrice(products: PopularProduct[]) {
  if (!products.length) return 0;
  const sorted = [...products].sort((a, b) => a.price - b.price);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1].price + sorted[middle].price) / 2;
  }
  return sorted[middle].price;
}

function buildBestValue(products: PopularProduct[]) {
  if (!products.length) return [];

  const medianPrice = computeMedianPrice(products);
  const primary = products
    .filter((row) => row.price <= medianPrice)
    .sort(scoreByImagePriceName);
  const secondary = products
    .filter((row) => row.price > medianPrice)
    .sort(scoreByImagePriceName);

  const categoryCount = new Map<string, number>();
  const selected: PopularProduct[] = [];

  const tryPush = (candidate: PopularProduct) => {
    if (selected.length >= 8) return;
    const key = categoryKey(candidate);
    const used = Number(categoryCount.get(key) || 0);
    if (used >= 2) return;
    selected.push(candidate);
    categoryCount.set(key, used + 1);
  };

  for (const candidate of primary) {
    tryPush(candidate);
  }
  for (const candidate of secondary) {
    tryPush(candidate);
  }

  return selected.slice(0, 8);
}

function productToPopular(
  product: ProductLean,
  fallbackName: string,
  fallbackCategory: string,
  scoreCount: number
): PopularProduct {
  return {
    productId: String(product._id),
    name: String(product.name || fallbackName || "Producto"),
    price: Math.max(0, toNumber(product.price)),
    imageUrl: String(product.imageUrl || ""),
    category: String(product.category || fallbackCategory || ""),
    scoreCount: Math.max(0, Math.round(toNumber(scoreCount))),
  };
}

function buildPairKey(left: string, right: string) {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function isSideOrDrink(product: PopularProduct) {
  const text = normalizeText(`${product.name} ${product.category}`);
  return SIDE_DRINK_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)));
}

export async function computeMenuEnhancements(
  businessId: mongoose.Types.ObjectId | string,
  days = 14
): Promise<EnhancementsResult> {
  const businessObjectId =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(String(businessId));
  const businessIdStr = String(businessObjectId);
  const safeDays = Math.max(1, Math.min(30, Math.floor(toNumber(days, 14))));
  const cacheKey = keyForCache(businessIdStr, safeDays);

  const cached = enhancementCache.get(cacheKey);
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.value;
  }

  await dbConnect();
  const business = await Business.findById(businessObjectId).select("type").lean();
  const businessType = String((business as { type?: string } | null)?.type || "").toLowerCase();
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const [popularAgg, availableProductsRaw, deliveredOrders] = await Promise.all([
    Order.aggregate<PopularAggRow>([
      {
        $match: {
          businessId: businessObjectId,
          status: "delivered",
          createdAt: { $gte: since },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          scoreCount: { $sum: { $ifNull: ["$items.qty", 0] } },
          snapshotName: { $last: "$items.name" },
          snapshotCategory: { $last: "$items.category" },
        },
      },
      { $sort: { scoreCount: -1 } },
      { $limit: 40 },
    ]),
    Product.find({
      businessId: businessObjectId,
      isAvailable: true,
    })
      .select("_id name price imageUrl category")
      .lean<ProductLean[]>(),
    Order.find({
      businessId: businessObjectId,
      status: "delivered",
      createdAt: { $gte: since },
    })
      .select("items.productId")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean<Array<{ items?: Array<{ productId?: mongoose.Types.ObjectId }> }>>(),
  ]);

  const popularIds = popularAgg
    .map((row) => row._id)
    .filter((row) => row instanceof mongoose.Types.ObjectId);
  const popularProductsRaw = popularIds.length
    ? await Product.find({ _id: { $in: popularIds } })
        .select("_id name price imageUrl category isAvailable")
        .lean<ProductLean[]>()
    : [];
  const popularProductMap = new Map(popularProductsRaw.map((row) => [String(row._id), row]));

  const popular: PopularProduct[] = popularAgg
    .map((row) => {
      const product = popularProductMap.get(String(row._id));
      if (!product) return null;
      return productToPopular(
        product,
        String(row.snapshotName || ""),
        String(row.snapshotCategory || ""),
        row.scoreCount
      );
    })
    .filter(Boolean) as PopularProduct[];

  popular.sort((left, right) => {
    const leftAvailable = toNumber(
      popularProductMap.get(String(left.productId))?.isAvailable ? 1 : 0,
      0
    );
    const rightAvailable = toNumber(
      popularProductMap.get(String(right.productId))?.isAvailable ? 1 : 0,
      0
    );
    if (leftAvailable !== rightAvailable) return rightAvailable - leftAvailable;
    if (left.scoreCount !== right.scoreCount) return right.scoreCount - left.scoreCount;
    return left.name.localeCompare(right.name, "es");
  });

  const availableProducts: PopularProduct[] = availableProductsRaw.map((row) =>
    productToPopular(row, String(row.name || ""), String(row.category || ""), 0)
  );
  const popularScoreMap = new Map(popular.map((row) => [row.productId, row.scoreCount]));
  for (const row of availableProducts) {
    row.scoreCount = Math.max(0, toNumber(popularScoreMap.get(row.productId), 0));
  }

  const bestValue = buildBestValue(availableProducts);

  const combos: Combo[] = [];
  if (businessType === "restaurant") {
    const pairCountMap = new Map<string, number>();
    for (const order of deliveredOrders) {
      const uniqueIds = Array.from(
        new Set(
          (Array.isArray(order.items) ? order.items : [])
            .map((item) => String(item?.productId || ""))
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .slice(0, 8)
        )
      );
      for (let i = 0; i < uniqueIds.length; i += 1) {
        for (let j = i + 1; j < uniqueIds.length; j += 1) {
          const key = buildPairKey(uniqueIds[i], uniqueIds[j]);
          pairCountMap.set(key, Number(pairCountMap.get(key) || 0) + 1);
        }
      }
    }

    const availableMap = new Map(availableProducts.map((row) => [row.productId, row]));
    const sideCandidates = [...popular, ...bestValue]
      .filter((row) => availableMap.has(row.productId))
      .filter(isSideOrDrink)
      .sort((a, b) => {
        if (a.scoreCount !== b.scoreCount) return b.scoreCount - a.scoreCount;
        return scoreByImagePriceName(a, b);
      });

    const pairs = Array.from(pairCountMap.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    for (const pair of pairs) {
      const [leftId, rightId] = pair.key.split("|");
      const left = availableMap.get(leftId);
      const right = availableMap.get(rightId);
      if (!left || !right) continue;

      const items: Combo["items"] = [
        {
          productId: left.productId,
          name: left.name,
          price: left.price,
          imageUrl: left.imageUrl,
          category: left.category,
        },
        {
          productId: right.productId,
          name: right.name,
          price: right.price,
          imageUrl: right.imageUrl,
          category: right.category,
        },
      ];

      const third = sideCandidates.find(
        (candidate) => candidate.productId !== left.productId && candidate.productId !== right.productId
      );
      if (third) {
        items.push({
          productId: third.productId,
          name: third.name,
          price: third.price,
          imageUrl: third.imageUrl,
          category: third.category,
        });
      }

      const totalPrice = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.price)), 0);
      const comboId = `cmb_${items.map((item) => item.productId).join("_")}`;
      const titleEs = `Combo ${items.map((item) => item.name).join(" + ")}`;
      combos.push({
        comboId,
        titleEs,
        items,
        totalPrice: Number(totalPrice.toFixed(2)),
        savingsLabelEs: "Combo sugerido",
      });

      if (combos.length >= 5) break;
    }
  }

  const value: EnhancementsResult = {
    popular: popular.slice(0, 10),
    bestValue: bestValue.slice(0, 8),
    combos: combos.slice(0, 5),
    meta: {
      windowDays: safeDays,
      computedAt: new Date().toISOString(),
    },
  };

  enhancementCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    value,
  });

  return value;
}

