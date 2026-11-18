import "server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";
import { queryWithParameters as query, type DatabaseConnection } from "../../../lib/db/connection.ts";
import type { MailKind } from "./contracts";

const policy = {
  verify: { limit: 3, windowMs: 60 * 60_000 },
  reset: { limit: 5, windowMs: 15 * 60_000 },
} satisfies Record<MailKind, { limit: number; windowMs: number }>;

const attemptsSchema = z.array(z.int().nonnegative()).max(5);
const bucketSchema = z.object({ key: z.string(), attempts: z.string() });
class MailRateLimited extends Error {
  readonly retrySeconds: number;

  constructor(retrySeconds: number) {
    super("Mail request rate exceeded");
    this.retrySeconds = retrySeconds;
  }
}

export async function reserveMailRequest(
  connection: DatabaseConnection, kind: MailKind, email: string, ip: string, secret: string,
  now = Date.now(),
) {
  const { limit, windowMs } = policy[kind];
  const keys = [["account", email], ["ip", ip]].map(([scope, value]) =>
    createHmac("sha256", secret).update(JSON.stringify(["account-mail", kind, scope, value])).digest("hex")
  ).sort();

  return connection.transaction(async (tx) => {
    // Both claims take locks in primary-key order, including the first insert.
    const rows = await query(tx, `INSERT INTO auth_mail_rate (key, attempts, expires_at)
      VALUES (?, '[]', ?), (?, '[]', ?) ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
      RETURNING key, attempts`, [keys[0], now, keys[1], now]);
    const buckets = rows.map((row) => {
      const { key, attempts } = bucketSchema.parse(row);
      const recent = attemptsSchema.parse(JSON.parse(attempts)).filter((time) => time > now - windowMs);
      return { key, recent };
    });
    if (buckets.length !== keys.length) throw new Error("Mail quota buckets missing");
    const retryMs = Math.max(0, ...buckets.map(({ recent }) =>
      recent.length < limit ? 0 : recent[0] + windowMs - now
    ));
    if (retryMs > 0) throw new MailRateLimited(Math.ceil(retryMs / 1000));

    const [first, second] = buckets;
    await query(tx, `UPDATE auth_mail_rate SET attempts = CASE key WHEN ? THEN ? ELSE ? END, expires_at = ?
      WHERE key IN (?, ?)`, [
      first.key, JSON.stringify([...first.recent, now].sort((a, b) => a - b)),
      JSON.stringify([...second.recent, now].sort((a, b) => a - b)),
      Math.max(now, ...first.recent, ...second.recent) + windowMs, first.key, second.key,
    ]);
    return 0;
  }).catch((error: unknown) => {
    // Roll back empty buckets from requests already blocked by the other key.
    if (error instanceof MailRateLimited) return error.retrySeconds;
    throw error;
  });
}

export async function pruneMailRate(connection: DatabaseConnection, now = Date.now()) {
  await query(connection, `DELETE FROM auth_mail_rate WHERE key IN (
    SELECT key FROM auth_mail_rate WHERE expires_at <= ? ORDER BY expires_at LIMIT 32
    ${connection.kind === "postgresql" ? "FOR UPDATE SKIP LOCKED" : ""}
  )`, [now]);
}
