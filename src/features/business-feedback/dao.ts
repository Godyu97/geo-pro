import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { leadEvidenceSchema } from "./contracts.ts";

const leadRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  eventId: z.string().min(1).max(64),
  primary: leadEvidenceSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
});

const evidenceRow = z.object({
  id: brandIdSchema,
  leadId: brandIdSchema,
  brandId: brandIdSchema,
  category: leadEvidenceSchema,
  position: z.number().int().min(1).max(4),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type BusinessLeadRecord = z.infer<typeof leadRow>;
export type BusinessLeadEvidenceRecord = z.infer<typeof evidenceRow> & { ownerId: string };

const leadColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", event_id AS "eventId",
  primary_class AS "primary", created_at AS "createdAt"`;

const evidenceColumns = `id, lead_id AS "leadId", brand_id AS "brandId", category, position, created_at AS "createdAt"`;

export function businessLeadListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${leadColumns} FROM business_lead
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function businessLeadEvidenceQuery(ownerId: string, leadIds: readonly string[]) {
  if (leadIds.length === 0) return null;
  return {
    sql: `SELECT ${evidenceColumns} FROM business_lead_evidence
      WHERE owner_id = ? AND lead_id IN (${leadIds.map(() => "?").join(", ")})
      ORDER BY lead_id ASC, position ASC, id ASC`,
    values: [ownerId, ...leadIds] as QueryValue[],
  };
}

export class BusinessLeadDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertLeads(rows: readonly BusinessLeadRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(row.id, row.brandId, row.ownerId, row.eventId, row.primary, row.createdAt);
      return "(?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO business_lead (id, brand_id, owner_id, event_id, primary_class, created_at)
       VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async insertEvidence(rows: readonly BusinessLeadEvidenceRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(row.id, row.leadId, row.brandId, row.ownerId, row.category, row.position, row.createdAt);
      return "(?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO business_lead_evidence (
        id, lead_id, brand_id, owner_id, category, position, created_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async leadsByEvents(ownerId: string, brandId: string, eventIds: readonly string[]) {
    if (eventIds.length === 0) return [];
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${leadColumns} FROM business_lead
       WHERE owner_id = ? AND brand_id = ? AND event_id IN (${eventIds.map(() => "?").join(", ")})${lock}`,
      [ownerId, brandId, ...eventIds],
    );
    return z.array(leadRow).parse(rows);
  }

  async leadsForBrand(ownerId: string, brandId: string) {
    const query = businessLeadListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(leadRow).parse(rows);
  }

  async leadForOwner(ownerId: string, leadId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${leadColumns} FROM business_lead WHERE id = ? AND owner_id = ? LIMIT 1`,
      [leadId, ownerId],
    );
    return row ? leadRow.parse(row) : null;
  }

  async leadsByIds(ownerId: string, leadIds: readonly string[]) {
    if (leadIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${leadColumns} FROM business_lead
       WHERE owner_id = ? AND id IN (${leadIds.map(() => "?").join(", ")})
       ORDER BY created_at ASC, id ASC`,
      [ownerId, ...leadIds],
    );
    return z.array(leadRow).parse(rows);
  }

  async evidenceFor(ownerId: string, leadIds: readonly string[]) {
    const query = businessLeadEvidenceQuery(ownerId, leadIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(evidenceRow).parse(rows);
  }

  async upgradePrimary(ownerId: string, rows: readonly { id: string; primary: BusinessLeadRecord["primary"] }[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const cases = rows.map((row) => {
      values.push(row.id, row.primary);
      return "WHEN ? THEN ?";
    });
    const ids = rows.map((row) => {
      values.push(row.id);
      return "?";
    });
    values.push(ownerId);
    await queryWithParameters(
      this.db,
      `UPDATE business_lead SET primary_class = CASE id ${cases.join(" ")} END
       WHERE id IN (${ids.join(", ")}) AND owner_id = ?`,
      values,
    );
  }
}
