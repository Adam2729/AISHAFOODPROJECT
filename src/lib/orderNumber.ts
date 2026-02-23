import { nanoid } from "nanoid";
import { Order } from "@/models/Order";

export async function generateUniqueOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = `AF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`;
    const exists = await Order.exists({ orderNumber });
    if (!exists) return orderNumber;
  }
  throw new Error("Failed to generate unique order number");
}

export function isDuplicateKeyError(error: unknown): boolean {
  const e = error as { code?: number; message?: string };
  return e?.code === 11000 || String(e?.message || "").includes("E11000");
}
