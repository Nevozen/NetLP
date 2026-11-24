import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function connectDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 5000,
      max: 10,
    }),
  });
}

const globalDb = globalThis as typeof globalThis & {
  lpstacksDb?: PrismaClient;
};

export function database() {
  if (!globalDb.lpstacksDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required.");
    globalDb.lpstacksDb = connectDatabase(url);
  }
  return globalDb.lpstacksDb;
}
