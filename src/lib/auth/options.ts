import type { BetterAuthOptions } from "better-auth";

// Shared by the schema CLI and the runtime so auth schema options cannot drift.
export const authOptions = {
  appName: "GeoPro",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
} satisfies BetterAuthOptions;
