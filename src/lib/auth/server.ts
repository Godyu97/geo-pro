import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { sql } from "drizzle-orm";

import { sendResetMail } from "@/features/account/email/delivery";
import { beforeProfileUpdate } from "@/features/account/profile-update";
import { getAuthEnvironment } from "@/lib/auth/env";
import { authOptions } from "@/lib/auth/options";
import { trustedAppOrigins } from "@/lib/auth/origin";
import { getDatabase, withAuthDatabaseTransaction } from "@/lib/db";

type UserKey = { id: string } | { email: string };
type LockUser = (key: UserKey) => Promise<void>;

function createAuth(scopedDatabase?: ReturnType<typeof getDatabase>, lockUser?: LockUser) {
  const environment = getAuthEnvironment();
  const { database, provider, schema } = scopedDatabase ?? getDatabase();

  return betterAuth({
    ...authOptions,
    emailAndPassword: { ...authOptions.emailAndPassword, sendResetPassword: sendResetMail },
    verification: { ...authOptions.verification, disableCleanup: Boolean(scopedDatabase) },
    disabledPaths: ["/send-verification-email", "/verify-email", "/request-password-reset", "/reset-password"],
    hooks: { before: beforeProfileUpdate },
    plugins: lockUser ? [{
      id: "lock-password-sign-in",
      hooks: {
        before: [{
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            if (typeof ctx.body?.email === "string") {
              await lockUser({ email: ctx.body.email.toLowerCase() });
            }
          }),
        }],
      },
    }] : [],
    // The Next.js handler translates unexpected failures without logging driver details.
    onAPIError: { throw: true },
    logger: { level: "error", log: () => console.error("auth-sdk-error") },
    database: drizzleAdapter(database, { provider, schema }),
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: (request) => trustedAppOrigins(environment.BETTER_AUTH_URL, request),
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}

export function withAuthTransaction<T>(work: (auth: ReturnType<typeof createAuth>, lockUser: LockUser) => Promise<T>) {
  return withAuthDatabaseTransaction((database) => {
    // SQLite already holds a write reservation for this transaction.
    const lockUser: LockUser = async (key) => {
      if (database.provider === "pg") {
        const match = "id" in key ? sql`id = ${key.id}` : sql`email = ${key.email}`;
        await database.database.execute(sql`SELECT id FROM "user" WHERE ${match} FOR UPDATE`);
      }
    };
    return work(createAuth(database, lockUser), lockUser);
  });
}
