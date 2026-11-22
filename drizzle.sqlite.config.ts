import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/lib/db/auth-schema.sqlite.ts", "./src/lib/db/maintenance-schema.sqlite.ts", "./src/lib/db/brand-schema.sqlite.ts", "./src/lib/db/data-export-schema.sqlite.ts", "./src/lib/db/quota-schema.sqlite.ts", "./src/lib/db/auth-mail-schema.sqlite.ts", "./src/lib/db/brand-fact-schema.sqlite.ts", "./src/lib/db/capability-schema.sqlite.ts", "./src/lib/db/prompt-schema.sqlite.ts", "./src/lib/db/monitoring-schema.sqlite.ts", "./src/lib/db/evidence-schema.sqlite.ts", "./src/lib/db/optimization-schema.sqlite.ts", "./src/lib/db/content-schema.sqlite.ts", "./src/lib/db/report-schema.sqlite.ts", "./src/lib/db/competitor-schema.sqlite.ts", "./src/lib/db/stored-object-schema.sqlite.ts", "./src/lib/db/source-original-schema.sqlite.ts", "./src/lib/db/sampling-plan-schema.sqlite.ts", "./src/lib/db/quality-alert-schema.sqlite.ts", "./src/lib/db/entity-review-schema.sqlite.ts", "./src/lib/db/entity-revision-schema.sqlite.ts", "./src/lib/db/formal-observation-schema.sqlite.ts", "./src/lib/db/assistant-schema.sqlite.ts", "./src/lib/db/business-lead-schema.sqlite.ts", "./src/lib/db/lead-quality-schema.sqlite.ts", "./src/lib/db/lead-suggestion-schema.sqlite.ts", "./src/lib/db/team-access-schema.sqlite.ts", "./src/lib/db/approval-policy-schema.sqlite.ts", "./src/lib/db/content-template-schema.sqlite.ts", "./src/lib/db/image-asset-schema.sqlite.ts", "./src/lib/db/intervention-batch-schema.sqlite.ts", "./src/lib/db/capture-sheet-schema.sqlite.ts"],
  out: "./drizzle/sqlite",
});
