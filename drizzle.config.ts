import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/db/auth-schema.ts", "./src/lib/db/maintenance-schema.ts", "./src/lib/db/brand-schema.ts", "./src/lib/db/data-export-schema.ts", "./src/lib/db/quota-schema.ts", "./src/lib/db/auth-mail-schema.ts", "./src/lib/db/brand-fact-schema.ts", "./src/lib/db/capability-schema.ts", "./src/lib/db/prompt-schema.ts", "./src/lib/db/monitoring-schema.ts", "./src/lib/db/evidence-schema.ts"],
  out: "./drizzle",
  // Schema generation does not need a URL. Migration requires an explicit URL.
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
