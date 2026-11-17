import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/db/auth-schema.ts", "./src/lib/db/maintenance-schema.ts"],
  out: "./drizzle",
  // Schema generation does not need a URL. Migration requires an explicit URL.
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
