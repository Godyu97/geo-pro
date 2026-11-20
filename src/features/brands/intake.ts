import "server-only";

import { parseDatabaseConfig } from "../../lib/db/config.ts";
import { readPilotAdmission, type BrandIntakeMode } from "./pilot-admission.ts";

export type { BrandIntakeMode };

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

type HeaderSource = Pick<Headers, "get">;

function configuredOrigin(env: NodeJS.ProcessEnv) {
  const app = URL.parse(env.BETTER_AUTH_URL ?? "");
  if (!app || !["http:", "https:"].includes(app.protocol)) return null;
  return app;
}

function hostMatches(headers: HeaderSource, app: URL) {
  const forwardedHost = headers.get("x-forwarded-host");
  if (headers.get("host") !== app.host) return false;
  if (forwardedHost !== null && forwardedHost !== app.host) return false;
  return true;
}

export function brandFixtureOrigin(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env) {
  if (env.GEO_BRANDS_FIXTURE !== "1") return null;
  const app = configuredOrigin(env);
  if (!app || !loopbackHosts.has(app.hostname)) return null;
  if (!hostMatches(headers, app)) return null;
  const db = parseDatabaseConfig(env);
  if (!db.success) return null;
  if (db.data.DATABASE_PROVIDER === "postgresql" && !loopbackHosts.has(new URL(db.data.DATABASE_URL).hostname)) return null;
  return app.origin;
}

export type BrandIntake = { mode: BrandIntakeMode; origin: string };

/** Isolated loopback testing stays fixture. Real writes open only after every server attestation. */
export function brandIntakeOrigin(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env): BrandIntake | null {
  const fixture = brandFixtureOrigin(headers, env);
  if (fixture) return { mode: "fixture", origin: fixture };
  if (!readPilotAdmission(env).realIntakeOpen) return null;
  const app = configuredOrigin(env);
  if (!app || !hostMatches(headers, app)) return null;
  return { mode: "real", origin: app.origin };
}
