import "server-only";

import { parseDatabaseConfig } from "@/lib/db/config";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function brandFixtureOrigin(headers: Pick<Headers, "get">) {
  if (process.env.GEO_BRANDS_FIXTURE !== "1") return null;
  const app = URL.parse(process.env.BETTER_AUTH_URL ?? "");
  if (!app || !["http:", "https:"].includes(app.protocol) || !loopbackHosts.has(app.hostname)) return null;
  const forwardedHost = headers.get("x-forwarded-host");
  if (headers.get("host") !== app.host || (forwardedHost !== null && forwardedHost !== app.host)) return null;
  const db = parseDatabaseConfig(process.env);
  if (!db.success) return null;
  if (db.data.DATABASE_PROVIDER === "postgresql" && !loopbackHosts.has(new URL(db.data.DATABASE_URL).hostname)) return null;
  return app.origin;
}
