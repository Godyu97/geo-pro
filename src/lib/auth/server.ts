import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import { beforeProfileUpdate } from "@/features/account/profile-update";
import { getAuthEnvironment } from "@/lib/auth/env";
import { authOptions } from "@/lib/auth/options";
import { getDatabase } from "@/lib/db";

function createAuth() {
  const environment = getAuthEnvironment();
  const { database, provider, schema } = getDatabase();

  return betterAuth({
    ...authOptions,
    hooks: { before: beforeProfileUpdate },
    // The Next.js handler translates unexpected failures without logging driver details.
    onAPIError: { throw: true },
    database: drizzleAdapter(database, { provider, schema }),
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
