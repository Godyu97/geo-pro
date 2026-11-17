import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/lib/db/auth-schema.sqlite.ts", "./src/lib/db/maintenance-schema.sqlite.ts"],
  out: "./drizzle/sqlite",
});
