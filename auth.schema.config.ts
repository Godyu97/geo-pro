import { loadEnvConfig } from "@next/env";
import { betterAuth } from "better-auth";

import { authOptions } from "./src/lib/auth/options";

loadEnvConfig(process.cwd());

// CLI-only configuration: no database or generated-schema imports.
export const auth = betterAuth({
  ...authOptions,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
});
