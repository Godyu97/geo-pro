import "server-only";

import { randomUUID } from "node:crypto";
import { getConnection } from "@/lib/db/connection";
import { BrandDao } from "./dao";

export function brandUnavailable() {
  const traceId = randomUUID();
  console.error("brand-store-unavailable", { traceId });
  return { unavailable: true, traceId } as const;
}

export async function readBrandData<T>(read: (dao: BrandDao) => Promise<T>) {
  try {
    return { data: await read(new BrandDao(getConnection())) };
  } catch {
    return brandUnavailable();
  }
}
