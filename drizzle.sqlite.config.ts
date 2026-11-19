import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/lib/db/auth-schema.sqlite.ts", "./src/lib/db/maintenance-schema.sqlite.ts", "./src/lib/db/brand-schema.sqlite.ts", "./src/lib/db/data-export-schema.sqlite.ts", "./src/lib/db/quota-schema.sqlite.ts", "./src/lib/db/auth-mail-schema.sqlite.ts", "./src/lib/db/brand-fact-schema.sqlite.ts", "./src/lib/db/capability-schema.sqlite.ts"],
  out: "./drizzle/sqlite",
});
