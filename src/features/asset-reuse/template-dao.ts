import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { contentTemplateLimit, TEMPLATE_STATUSES } from "./template-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const timeSchema = z.iso.datetime();

const templateRowSchema = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema.nullable(),
  system: flag,
  sourceTemplateId: brandIdSchema.nullable(),
  factGate: flag,
  publicLicenseGate: flag,
  reviewGate: flag,
  status: z.enum(TEMPLATE_STATUSES),
  asksToInventCaseStudy: flag,
  name: z.string().min(1).max(120),
  createdAt: timeSchema,
  updatedAt: timeSchema,
});

const loadedTemplateSchema = templateRowSchema.extend({
  ownerId: z.string().min(1).max(128).nullable(),
});

export type ContentTemplateRow = z.infer<typeof templateRowSchema>;
export type LoadedContentTemplate = z.infer<typeof loadedTemplateSchema>;

export type ContentTemplateInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  sourceTemplateId: string;
  asksToInventCaseStudy: 0 | 1;
  name: string;
  createdAt: string;
};

const columns = `id, brand_id AS "brandId", is_system AS "system", source_template_id AS "sourceTemplateId",
  fact_gate AS "factGate", public_license_gate AS "publicLicenseGate", review_gate AS "reviewGate",
  status, asks_to_invent_case_study AS "asksToInventCaseStudy", name,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export function systemTemplatesQuery(limit = contentTemplateLimit) {
  return {
    sql: `SELECT ${columns} FROM content_template
      WHERE is_system = 1
      ORDER BY created_at, id
      LIMIT ?`,
    values: [limit] as QueryValue[],
  };
}

export function brandTemplatesQuery(ownerId: string, brandId: string, limit = contentTemplateLimit) {
  return {
    sql: `SELECT ${columns} FROM content_template
      WHERE owner_id = ? AND brand_id = ? AND is_system = 0
      ORDER BY created_at, id
      LIMIT ?`,
    values: [ownerId, brandId, limit] as QueryValue[],
  };
}

function parseRows(rows: readonly Record<string, unknown>[]) {
  return z.array(templateRowSchema).parse(rows);
}

export async function listSystemTemplates(db: QueryConnection) {
  const query = systemTemplatesQuery();
  return parseRows(await queryWithParameters(db, query.sql, query.values));
}

export async function listBrandTemplates(db: QueryConnection, ownerId: string, brandId: string) {
  const query = brandTemplatesQuery(ownerId, brandId);
  return parseRows(await queryWithParameters(db, query.sql, query.values));
}

export async function loadContentTemplate(db: QueryConnection, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT ${columns}, owner_id AS "ownerId" FROM content_template WHERE id = ?`,
    [id],
  );
  return row ? loadedTemplateSchema.parse(row) : null;
}

export async function insertContentTemplateClone(db: QueryConnection, row: ContentTemplateInsert) {
  const [inserted] = await queryWithParameters(
    db,
    `INSERT INTO content_template (
      id, brand_id, owner_id, is_system, source_template_id,
      fact_gate, public_license_gate, review_gate, status,
      asks_to_invent_case_study, name, created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, 1, 1, 1, 'draft', ?, ?, ?, ?)
    RETURNING ${columns}`,
    [
      row.id,
      row.brandId,
      row.ownerId,
      row.sourceTemplateId,
      row.asksToInventCaseStudy,
      row.name,
      row.createdAt,
      row.createdAt,
    ],
  );
  if (!inserted) throw new Error("content template insert failed");
  return templateRowSchema.parse(inserted);
}

export async function updateOwnedContentTemplate(
  db: QueryConnection,
  row: { id: string; brandId: string; ownerId: string; name: string; status: (typeof TEMPLATE_STATUSES)[number]; updatedAt: string },
) {
  const [updated] = await queryWithParameters(
    db,
    `UPDATE content_template
     SET name = ?, status = ?, updated_at = ?
     WHERE id = ? AND brand_id = ? AND owner_id = ? AND is_system = 0
     RETURNING ${columns}`,
    [row.name, row.status, row.updatedAt, row.id, row.brandId, row.ownerId],
  );
  return updated ? templateRowSchema.parse(updated) : null;
}
