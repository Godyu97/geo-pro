import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { writeFeedbackAccess } from "./brand-access.ts";
import type { RecordLeadFeedbackInput } from "./feedback-contracts.ts";
import { LeadFeedbackDao, type LeadFeedback } from "./feedback-dao.ts";
import { LeadQualityDao } from "./quality-dao.ts";

function flag(value: boolean | null) {
  return value === null ? null : value ? 1 as const : 0 as const;
}

export async function recordLeadFeedback(db: DatabaseConnection, actorId: string, input: RecordLeadFeedbackInput) {
  return db.transaction(async (tx) => {
    const scope = await writeFeedbackAccess(tx, actorId, input.brandId);
    if ("error" in scope) return scope;
    const dao = new LeadFeedbackDao(tx);
    if (!await dao.lockLead(scope.ownerId, scope.brandId, input.leadId)) {
      return { error: "NOT_FOUND" as const };
    }
    const rule = await new LeadQualityDao(tx).ruleForOwner(scope.ownerId, input.ruleId);
    if (!rule || rule.brandId !== input.brandId) return { error: "NOT_FOUND" as const };
    if (!rule.frozen) return { error: "RULE_NOT_FROZEN" as const };

    const current = await dao.read(input.leadId);
    const criteria = [
      [rule.requiresRealNeed, input.realNeed],
      [rule.requiresIndustry, input.targetIndustry],
      [rule.requiresFollowUp, input.canFollowUp],
    ].filter(([required]) => required === 1).map(([, value]) => value);
    let status: LeadFeedback["status"] = "qualified";
    if (criteria.includes(false)) status = "disqualified";
    else if (criteria.includes(null)) status = "unknown";

    const values = {
      ruleId: rule.id,
      realNeed: flag(input.realNeed),
      targetIndustry: flag(input.targetIndustry),
      canFollowUp: flag(input.canFollowUp),
      outcome: input.outcome,
    };
    if (current && current.ruleId === values.ruleId && current.realNeed === values.realNeed
      && current.targetIndustry === values.targetIndustry && current.canFollowUp === values.canFollowUp
      && current.outcome === values.outcome) {
      return { feedback: current };
    }
    const revision = current?.revision ?? 0;
    if (input.expectedRevision !== revision) return { error: "FEEDBACK_CHANGED" as const };
    const feedback: LeadFeedback = {
      ...values,
      id: randomUUID(),
      leadId: input.leadId,
      ruleVersion: rule.version,
      revision: revision + 1,
      status,
      createdAt: new Date().toISOString(),
    };
    await dao.insert(feedback, actorId);
    return { feedback };
  });
}
