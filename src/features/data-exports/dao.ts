import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection } from "../../lib/db/connection.ts";
import { exportIdSchema, exportLocaleSchema } from "./contracts.ts";

const recordSchema = z.object({
  id: exportIdSchema,
  locale: exportLocaleSchema,
  requested: z.number().int().min(1).max(3),
  included: z.number().int().min(0).max(3),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  createdAt: z.iso.datetime(),
}).refine(({ requested, included, fingerprint }) =>
  (requested & included) === included && (included === 0) === (fingerprint === null));

export type ExportRecord = z.infer<typeof recordSchema>;

export async function readExportRecord(db: QueryConnection, ownerId: string, id?: string) {
  const [row] = await queryWithParameters(db, `SELECT id, locale, requested, included, fingerprint, created_at AS "createdAt"
    FROM user_data_export WHERE owner_id = ?${id ? " AND id = ?" : ""}`, id ? [ownerId, id] : [ownerId]);
  return row ? recordSchema.parse(row) : null;
}

export async function saveExportRecord(db: QueryConnection, ownerId: string, record: ExportRecord) {
  await queryWithParameters(db, `INSERT INTO user_data_export (owner_id, id, locale, requested, included, fingerprint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner_id) DO UPDATE SET id = excluded.id, locale = excluded.locale, requested = excluded.requested,
      included = excluded.included, fingerprint = excluded.fingerprint, created_at = excluded.created_at`,
  [ownerId, record.id, record.locale, record.requested, record.included, record.fingerprint, record.createdAt]);
}

const profileSchema = z.object({ name: z.string(), email: z.string() });

export async function readExportProfile(db: QueryConnection, ownerId: string) {
  const [row] = await queryWithParameters(db, 'SELECT name, email FROM "user" WHERE id = ?', [ownerId]);
  return profileSchema.parse(row);
}
