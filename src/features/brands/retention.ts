import "server-only";

import { z } from "zod";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "./dao.ts";

function summaryText() {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= 2000 && value.isWellFormed() && !value.includes("\0");
  });
}

export const retentionPolicyInputSchema = z.strictObject({
  summaryZh: summaryText(),
  summaryEn: summaryText(),
  recoverableDays: z.number().int().min(1).max(3650),
});

export type RetentionPolicyInput = z.infer<typeof retentionPolicyInputSchema>;

// Inserts the next version only. Existing acceptance rows are not updated.
export async function publishRetentionPolicy(connection: DatabaseConnection, input: unknown, clock = () => new Date()) {
  const parsed = retentionPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" as const };
  const publishedAt = clock().toISOString();
  return connection.transaction(async (transaction) => {
    const dao = new BrandDao(transaction);
    if (transaction.kind === "postgresql") await dao.lockRetentionPolicies("exclusive");
    const policy = await dao.insertRetentionPolicy({ ...parsed.data, publishedAt });
    return { policy };
  });
}
