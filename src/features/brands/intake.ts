import "server-only";

import { parseDatabaseConfig } from "../../lib/db/config.ts";
import { functionalMockRequested } from "../functional-mock/mode.ts";
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
export type BrandIntakeDecision =
  | { state: "closed" }
  | { state: "denied"; intake: BrandIntake }
  | { state: "open"; intake: BrandIntake };

const materialModes = new Set<BrandIntakeMode>(["fixture", "mock", "dev"]);

/** Labeled stand-in writes. Host must match BETTER_AUTH_URL. This does not record pilot admission. */
export function functionalMockOrigin(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env) {
  if (!functionalMockRequested(env)) return null;
  const app = configuredOrigin(env);
  if (!app || !hostMatches(headers, app)) return null;
  return app.origin;
}

function configuredDatabaseName(env: NodeJS.ProcessEnv) {
  const db = parseDatabaseConfig(env);
  if (!db.success) return null;
  if (db.data.DATABASE_PROVIDER === "sqlite") {
    const name = db.data.SQLITE_PATH.split(/[/\\]/).pop();
    return name || null;
  }
  const name = decodeURIComponent(new URL(db.data.DATABASE_URL).pathname.replace(/^\//, ""));
  return name || null;
}

export type DevIntakeBlock = "switch_missing" | "target_mismatch" | "host_mismatch" | "lane_conflict" | "open";

/** Why the development lane is closed. HTTP responses stay generic; this is for tests and operators. */
export function explainDevIntake(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env): { status: DevIntakeBlock; origin?: string } {
  if (functionalMockRequested(env) && env.GEO_BRAND_DEV_INTAKE === "true") return { status: "lane_conflict" };
  const devServer = env.NODE_ENV === "development" && env.GEO_BRAND_DEV_INTAKE !== "false" && env.GEO_BRAND_DEV_INTAKE !== "0";
  if (!devServer && env.GEO_BRAND_DEV_INTAKE !== "true") return { status: "switch_missing" };
  const expected = env.GEO_BRAND_DEV_INTAKE_DATABASE?.trim() ?? "";
  const actual = configuredDatabaseName(env);
  if (!actual || (expected ? expected !== actual : !devServer)) return { status: "target_mismatch" };
  const app = configuredOrigin(env);
  if (!app || !hostMatches(headers, app)) return { status: "host_mismatch" };
  return { status: "open", origin: app.origin };
}

export function devIntakeActorAllowed(email: string, env: NodeJS.ProcessEnv = process.env) {
  const actors = (env.GEO_BRAND_DEV_INTAKE_ACTORS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const normalized = email.trim().toLowerCase();
  return actors.length > 0 && actors.includes(normalized);
}

/** Isolated loopback testing stays fixture. Production real writes stay on pilot attestation. */
export function brandIntakeOrigin(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env): BrandIntake | null {
  const fixture = brandFixtureOrigin(headers, env);
  if (fixture) return { mode: "fixture", origin: fixture };
  if (functionalMockRequested(env) && env.GEO_BRAND_DEV_INTAKE === "true") return null;
  const mock = functionalMockOrigin(headers, env);
  if (mock) return { mode: "mock", origin: mock };
  if (readPilotAdmission(env).realIntakeOpen) {
    const app = configuredOrigin(env);
    if (!app || !hostMatches(headers, app)) return null;
    return { mode: "real", origin: app.origin };
  }
  const dev = explainDevIntake(headers, env);
  if (dev.status === "open" && dev.origin) return { mode: "dev", origin: dev.origin };
  return null;
}

export function brandIntakeDecision(headers: HeaderSource, email: string, env: NodeJS.ProcessEnv = process.env): BrandIntakeDecision {
  void email;
  const intake = brandIntakeOrigin(headers, env);
  if (!intake) return { state: "closed" };
  return { state: "open", intake };
}

/** Fixture, functional mock, and authorized development material editors. Production real intake stays on its own gate. */
export function brandMaterialOrigin(headers: HeaderSource, env: NodeJS.ProcessEnv = process.env) {
  const intake = brandIntakeOrigin(headers, env);
  if (intake && materialModes.has(intake.mode)) return intake.origin;
  return null;
}

export function brandMaterialAccess(headers: HeaderSource, email: string, env: NodeJS.ProcessEnv = process.env) {
  const decision = brandIntakeDecision(headers, email, env);
  if (decision.state === "closed") return { ok: false as const, error: "closed" as const };
  if (!materialModes.has(decision.intake.mode)) return { ok: false as const, error: "closed" as const };
  if (decision.state === "denied") return { ok: false as const, error: "devActorDenied" as const };
  return { ok: true as const, origin: decision.intake.origin, mode: decision.intake.mode };
}
