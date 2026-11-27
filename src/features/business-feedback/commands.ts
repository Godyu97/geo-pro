import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { writeConnectorEvents } from "../data-connections/event-commands.ts";
import { csvEventDigest } from "../data-connections/sync.ts";
import { readFeedbackAccess, writeFeedbackAccess } from "./brand-access.ts";
import { prepareLeadRow, type ImportBusinessLeadsInput } from "./contracts.ts";
import {
  BusinessLeadDao,
  type BusinessLeadEvidenceRecord,
  type BusinessLeadRecord,
} from "./dao.ts";
import { dedupedLead, previewLeadImport, type LeadEvidence } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export type BusinessLeadView = {
  id: string;
  brandId: string;
  eventId: string;
  primary: LeadEvidence;
  count: 1;
  evidence: LeadEvidence[];
  createdAt: string;
};

function firstSeen(evidence: readonly LeadEvidence[]) {
  const seen = new Set<LeadEvidence>();
  const ordered: LeadEvidence[] = [];
  for (const category of evidence) {
    if (seen.has(category)) continue;
    seen.add(category);
    ordered.push(category);
  }
  return ordered;
}

function toView(row: BusinessLeadRecord, evidence: readonly { leadId: string; category: LeadEvidence }[]): BusinessLeadView {
  return {
    id: row.id,
    brandId: row.brandId,
    eventId: row.eventId,
    primary: row.primary,
    count: 1,
    evidence: evidence.filter((item) => item.leadId === row.id).map((item) => item.category),
    createdAt: row.createdAt,
  };
}

async function viewsFor(dao: BusinessLeadDao, ownerId: string, leadIds: readonly string[]) {
  const leads = await dao.leadsByIds(ownerId, leadIds);
  const evidence = await dao.evidenceFor(ownerId, leads.map((lead) => lead.id));
  return leads.map((lead) => toView(lead, evidence));
}

export async function listBusinessLeads(db: DatabaseConnection, actorId: string, brandId: string) {
  const access = await readFeedbackAccess(db, actorId, brandId);
  if (!access) return { error: "NOT_FOUND" as const };
  return listBusinessLeadsForBrand(db, access.ownerId, brandId);
}

export async function listBusinessLeadsForBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const dao = new BusinessLeadDao(db);
  const leads = await dao.leadsForBrand(ownerId, brandId);
  const evidence = await dao.evidenceFor(ownerId, leads.map((lead) => lead.id));
  return { leads: leads.map((lead) => toView(lead, evidence)) };
}

export async function readBusinessLead(db: DatabaseConnection, actorId: string, leadId: string) {
  const brandId = await new BusinessLeadDao(db).leadBrandId(leadId);
  const access = brandId && await readFeedbackAccess(db, actorId, brandId);
  if (!access) return { error: "NOT_FOUND" as const };
  return readBusinessLeadForBrand(db, access.ownerId, brandId, leadId);
}

export async function readBusinessLeadForBrand(db: QueryConnection, ownerId: string, brandId: string, leadId: string) {
  const dao = new BusinessLeadDao(db);
  const lead = await dao.leadForOwner(ownerId, leadId);
  if (!lead || lead.brandId !== brandId) return { error: "NOT_FOUND" as const };
  const evidence = await dao.evidenceFor(ownerId, [lead.id]);
  return { lead: toView(lead, evidence) };
}

export async function writeBusinessLeads(
  tx: QueryConnection,
  ownerId: string,
  input: ImportBusinessLeadsInput,
  clock: Clock = systemClock,
) {
  const preview = previewLeadImport(input.rows.map(prepareLeadRow));
    const ranked = dedupedLead(preview.leads.flatMap((lead) =>
      lead.evidence.map((evidence) => ({ eventId: lead.eventId, evidence })),
    ));
    if (ranked.length === 0) return { leads: [], rejected: preview.rejected };
    const dao = new BusinessLeadDao(tx);
    const now = clock();
    const existing = await dao.leadsByEvents(ownerId, input.brandId, ranked.map((lead) => lead.eventId));
    const existingByEvent = new Map(existing.map((lead) => [lead.eventId, lead]));
    const storedEvidence = await dao.evidenceFor(ownerId, existing.map((lead) => lead.id));
    const evidenceByLead = new Map<string, { category: LeadEvidence; position: number }[]>();
    for (const row of storedEvidence) {
      const list = evidenceByLead.get(row.leadId) ?? [];
      list.push({ category: row.category, position: row.position });
      evidenceByLead.set(row.leadId, list);
    }

    const leadInserts: BusinessLeadRecord[] = [];
    const evidenceInserts: BusinessLeadEvidenceRecord[] = [];
    const upgrades: { id: string; primary: LeadEvidence }[] = [];
    const touched: string[] = [];

    for (const lead of ranked) {
      const categories = firstSeen(lead.evidence);
      const found = existingByEvent.get(lead.eventId);
      if (!found) {
        const id = randomUUID();
        touched.push(id);
        leadInserts.push({
          id,
          brandId: input.brandId,
          ownerId,
          eventId: lead.eventId,
          primary: lead.primary,
          createdAt: now,
        });
        categories.forEach((category, index) => {
          evidenceInserts.push({
            id: randomUUID(),
            leadId: id,
            brandId: input.brandId,
            ownerId,
            category,
            position: index + 1,
            createdAt: now,
          });
        });
        continue;
      }
      touched.push(found.id);
      const stored = evidenceByLead.get(found.id) ?? [];
      const merged = dedupedLead([
        ...stored.map((item) => ({ eventId: lead.eventId, evidence: item.category })),
        ...categories.map((evidence) => ({ eventId: lead.eventId, evidence })),
      ])[0];
      if (merged && merged.primary !== found.primary) upgrades.push({ id: found.id, primary: merged.primary });
      const have = new Set(stored.map((item) => item.category));
      let position = stored.reduce((max, item) => Math.max(max, item.position), 0);
      for (const category of categories) {
        if (have.has(category)) continue;
        position += 1;
        evidenceInserts.push({
          id: randomUUID(),
          leadId: found.id,
          brandId: input.brandId,
          ownerId,
          category,
          position,
          createdAt: now,
        });
      }
    }

    await dao.insertLeads(leadInserts);
    await dao.upgradePrimary(ownerId, upgrades);
    await dao.insertEvidence(evidenceInserts);
    return { leads: await viewsFor(dao, ownerId, touched), rejected: preview.rejected };
}

export async function importBusinessLeads(
  db: DatabaseConnection,
  actorId: string,
  input: ImportBusinessLeadsInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const access = await writeFeedbackAccess(tx, actorId, input.brandId);
    if ("error" in access) return access;
    const { ownerId } = access;
    // Serialize imports into the same ledger, including when its first event is new.
    if (!await new BrandDao(tx).lockOwner(ownerId)) return { error: "NOT_FOUND" as const };
    const current = await writeFeedbackAccess(tx, actorId, input.brandId);
    if ("error" in current) return current;
    if (current.ownerId !== ownerId) return { error: "NOT_FOUND" as const };
    const result = await writeBusinessLeads(tx, ownerId, input, clock);
    if ("error" in result || result.leads.length === 0) return result;
    await writeConnectorEvents(tx, ownerId, {
      brandId: input.brandId,
      rows: result.leads.map((lead) => ({
        eventKey: lead.eventId,
        source: "csv" as const,
        payloadDigest: csvEventDigest(lead.eventId),
      })),
    }, clock);
    return result;
  });
}
