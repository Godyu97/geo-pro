import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import { getAuthEnvironment } from "@/lib/auth/env";
import { authOptions } from "@/lib/auth/options";
import { getDatabase } from "@/lib/db";
import * as schema from "@/lib/db/auth-schema";

function createAuth() {
  const environment = getAuthEnvironment();

  return betterAuth({
    ...authOptions,
    database: drizzleAdapter(getDatabase(), { provider: "pg", schema }),
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(environment.BETTER_AUTH_URL).origin],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}
