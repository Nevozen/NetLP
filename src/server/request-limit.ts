import { randomUUID } from "node:crypto";
import { requireFact } from "@/domain/values";
import { database } from "./db";

export async function limitOwnerRequest(
  key: string,
  max: number,
  interval: number,
  message: string,
) {
  const now = BigInt(Date.now());
  const cutoff = now - BigInt(interval);
  const rate = await database().$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" (id, key, count, "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."lastRequest" < ${cutoff} THEN 1 ELSE "RateLimit".count + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${cutoff} THEN ${now} ELSE "RateLimit"."lastRequest" END
    WHERE "RateLimit"."lastRequest" < ${cutoff} OR "RateLimit".count < ${max}
    RETURNING count`;
  requireFact(rate.length, message);
}
