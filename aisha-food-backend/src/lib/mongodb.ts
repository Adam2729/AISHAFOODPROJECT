import mongoose from "mongoose";
import { ENV_MONGODB_URI } from "@/lib/env";

const MONGODB_URI = ENV_MONGODB_URI;

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var mongooseCache: MongooseCache | undefined;
}

let cached = globalThis.mongooseCache;

if (!cached) {
  cached = { conn: null, promise: null };
  globalThis.mongooseCache = cached;
}

export async function dbConnect() {
  if (cached!.conn) return cached!.conn;

  if (!cached!.promise) {
    cached!.promise = mongoose
      .connect(MONGODB_URI)
      .then((m) => m);
  }

  cached!.conn = await cached!.promise;
  return cached!.conn;
}
