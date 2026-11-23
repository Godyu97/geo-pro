import { BrandDao } from "../../src/features/brands/dao.ts";
import { publishRetentionPolicy } from "../../src/features/brands/retention.ts";

export const retentionPolicyInput = {
  summaryZh: "合成保留策略：默认 30 天可恢复。本记录不删除事实、内容或报告。",
  summaryEn: "Synthetic retention policy: recoverable for 30 days by default. This record does not delete facts, content, or reports.",
  recoverableDays: 30,
};

export const retentionDisclosure = {
  summaryZh: "活跃品牌的事实、内容和报告默认持续保留。确认删除后默认可在 30 天内恢复，期满后按已披露策略清除。接受本版本不会删除事实、内容或报告。",
  summaryEn: "Facts, content, and reports for an active brand are kept by default. After deletion is confirmed, access can be restored for 30 days and is then cleared under the disclosed policy. Accepting this version does not delete facts, content, or reports.",
  recoverableDays: 30,
};

export async function ensureRetentionPolicy(db, clock = () => new Date("2026-11-18T08:00:00.000Z"), input = retentionPolicyInput) {
  const current = await new BrandDao(db).currentRetentionPolicy();
  if (current) return current.version;
  const published = await publishRetentionPolicy(db, input, clock);
  if (!("policy" in published)) throw new Error(published.error);
  return published.policy.version;
}
