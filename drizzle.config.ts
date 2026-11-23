import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/db/auth-schema.ts", "./src/lib/db/maintenance-schema.ts", "./src/lib/db/brand-schema.ts", "./src/lib/db/data-export-schema.ts", "./src/lib/db/quota-schema.ts", "./src/lib/db/auth-mail-schema.ts", "./src/lib/db/brand-fact-schema.ts", "./src/lib/db/capability-schema.ts", "./src/lib/db/prompt-schema.ts", "./src/lib/db/monitoring-schema.ts", "./src/lib/db/evidence-schema.ts", "./src/lib/db/optimization-schema.ts", "./src/lib/db/content-schema.ts", "./src/lib/db/report-schema.ts", "./src/lib/db/competitor-schema.ts", "./src/lib/db/stored-object-schema.ts", "./src/lib/db/source-original-schema.ts", "./src/lib/db/sampling-plan-schema.ts", "./src/lib/db/quality-alert-schema.ts", "./src/lib/db/entity-review-schema.ts", "./src/lib/db/entity-revision-schema.ts", "./src/lib/db/formal-observation-schema.ts", "./src/lib/db/assistant-schema.ts", "./src/lib/db/business-lead-schema.ts", "./src/lib/db/lead-quality-schema.ts", "./src/lib/db/lead-suggestion-schema.ts", "./src/lib/db/team-access-schema.ts", "./src/lib/db/approval-policy-schema.ts", "./src/lib/db/content-template-schema.ts", "./src/lib/db/image-asset-schema.ts", "./src/lib/db/intervention-batch-schema.ts", "./src/lib/db/capture-sheet-schema.ts", "./src/lib/db/external-connection-schema.ts", "./src/lib/db/notification-endpoint-schema.ts", "./src/lib/db/delegation-schema.ts", "./src/lib/db/service-order-schema.ts", "./src/lib/db/whitelabel-share-schema.ts", "./src/lib/db/data-connection-schema.ts", "./src/lib/db/connector-event-schema.ts", "./src/lib/db/crawler-observation-schema.ts", "./src/lib/db/sync-authorization-schema.ts", "./src/lib/db/local-observation-schema.ts", "./src/lib/db/brand-store-schema.ts", "./src/lib/db/media-review-schema.ts", "./src/lib/db/brand-delivery-schema.ts", "./src/lib/db/service-entitlement-schema.ts"],
  out: "./drizzle",
  // Schema generation does not need a URL. Migration requires an explicit URL.
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
