import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// An isolated copy permits real loading / failure tests without production fault switches.
const root = process.cwd();
const fixture = path.join(root, ".cache/i18n-app");
const baseURL = new URL(process.env.BETTER_AUTH_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname));
await mkdir(fixture, { recursive: true });
await rm(path.join(fixture, "src"), { recursive: true, force: true });
await cp(path.join(root, "src"), path.join(fixture, "src"), { recursive: true });
for (const file of ["package.json", "pnpm-lock.yaml", "tsconfig.json", "next.config.ts"]) {
  await cp(path.join(root, file), path.join(fixture, file));
}
try { await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir"); }
catch (error) { if (error.code !== "EEXIST") throw error; }

const probes = {
  error: 'export default function Probe() { throw new Error("Private test failure; never display this text"); }',
  loading: 'export default async function Probe() { await new Promise(resolve => setTimeout(resolve, 1500)); return <p>Ready</p>; }',
  unavailable: `import { AuthForm } from "@/components/layout/auth-form";
import { getLocale, getMessages } from "@/lib/i18n/server";
export default async function Probe() { const locale = await getLocale(); return <main id="main-content"><AuthForm configured={false} messages={getMessages(locale).auth} returnTo="/dashboard" /></main>; }`,
  fatal: 'export default function Probe() { return null; }',
};
for (const [name, source] of Object.entries(probes)) {
  const directory = path.join(fixture, `src/app/i18n-probe/${name}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "page.tsx"), `${source}\n`);
}
await cp(path.join(root, "src/app/(dashboard)/dashboard/loading.tsx"), path.join(fixture, "src/app/i18n-probe/loading/loading.tsx"));
const layout = path.join(fixture, "src/app/layout.tsx");
await writeFile(layout, (await readFile(layout, "utf8")).replace(
  '  const locale = await getLocale();',
  '  const requestHeaders = await (await import("next/headers")).headers();\n  if (requestHeaders.get("x-geo-path") === "/i18n-probe/fatal") throw new Error("Private root test failure");\n  const locale = await getLocale();',
));


const dashboard = path.join(fixture, "src/app/(dashboard)/dashboard/page.tsx");
await writeFile(dashboard, (await readFile(dashboard, "utf8")).replace(
  '  const { user } = await requireSession();',
  '  const { user } = await requireSession();\n  const requestHeaders = await (await import("next/headers")).headers();\n  if (requestHeaders.get("x-geo-path")?.includes("probeError=true")) throw new Error("Private dashboard test failure");',
));

const session = path.join(fixture, "src/lib/auth/session.ts");
await writeFile(session, (await readFile(session, "utf8"))
  .replace('  if (!isAuthConfigured()) {',
    '  if ((await headers()).get("cookie")?.includes("geo-auth-unconfigured=1") || !isAuthConfigured()) {')
  .replace('  try {',
    '  try {\n    if ((await headers()).get("cookie")?.includes("geo-auth-unavailable=1")) throw new Error("Private auth test failure");'));
const authRoute = path.join(fixture, "src/app/api/auth/[...all]/route.ts");
await writeFile(authRoute, (await readFile(authRoute, "utf8")).replace(
  '  try {',
  '  try {\n    if (request.cookies.get("geo-auth-unavailable")?.value === "1") throw new Error("Private auth test failure");',
));

const maintenanceService = path.join(fixture, "src/features/maintenance/service.ts");
await writeFile(maintenanceService, (await readFile(maintenanceService, "utf8")).replace(
  '    connection = getConnection();',
  '    connection = getConnection();\n    if ((await (await import("next/headers")).headers()).get("cookie")?.includes("geo-maintenance-unavailable=1")) return maintenanceUnavailable(undefined);',
));
const maintenancePage = path.join(fixture, "src/features/maintenance/access-page.tsx");
await writeFile(maintenancePage, (await readFile(maintenancePage, "utf8")).replace(
  '  await requireSession();',
  '  await requireSession();\n  if ((await (await import("next/headers")).headers()).get("cookie")?.includes("geo-maintenance-slow=1")) await new Promise(resolve => setTimeout(resolve, 1500));',
));

const supportDao = path.join(fixture, "src/features/support/dao.ts");
const supportSource = await readFile(supportDao, "utf8");
const supportRead = '    const id = opaqueIdSchema.parse(operationId);';
assert.ok(supportSource.includes(supportRead));
await writeFile(supportDao, supportSource.replace(supportRead, `    if ((await (await import("next/headers")).cookies()).get("geo-support-read")?.value === "slow-unavailable") {
      await new Promise(resolve => setTimeout(resolve, 1800));
      throw new Error("Private support fixture failure");
    }
${supportRead}`));

const settingsPage = path.join(fixture, "src/features/account/settings-page.tsx");
await writeFile(settingsPage, (await readFile(settingsPage, "utf8")).replace(
  '  const { user } = await requireSession();',
  '  const { user } = await requireSession();\n  if ((await (await import("next/headers")).headers()).get("cookie")?.includes("geo-settings-slow=1")) await new Promise(resolve => setTimeout(resolve, 1500));',
));

const brandService = path.join(fixture, "src/features/brands/service.ts");
await writeFile(brandService, (await readFile(brandService, "utf8")).replace(
  '    return { data: await read(new BrandDao(getConnection())) };',
  '    const brandProbe = (await (await import("next/headers")).headers()).get("cookie") ?? "";\n    if (brandProbe.includes("geo-brands-unavailable=1")) throw new Error("Private brand fixture failure");\n    if (brandProbe.includes("geo-brands-slow=1")) await new Promise(resolve => setTimeout(resolve, 1500));\n    return { data: await read(new BrandDao(getConnection())) };',
));

const evidenceCommands = path.join(fixture, "src/features/evidence/commands.ts");
const evidenceSource = await readFile(evidenceCommands, "utf8");
const evidenceRead = "  const observation = await dao.observationForOwner(ownerId, observationId);\n  if (!observation) return null;";
assert.ok(evidenceSource.includes(evidenceRead));
await writeFile(evidenceCommands, evidenceSource.replace(evidenceRead, `  const probe = (await (await import("next/headers")).cookies()).get("geo-evidence-read")?.value;
  if (probe === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private evidence fixture failure");
  }
${evidenceRead}`));

const briefCommands = path.join(fixture, "src/features/content/commands.ts");
const briefSource = await readFile(briefCommands, "utf8");
const briefRead = `export async function readBriefDetail(
  db: DatabaseConnection,
  ownerId: string,
  briefId: string,
) {
  const dao = new ContentDao(db);`;
assert.ok(briefSource.includes(briefRead));
await writeFile(briefCommands, briefSource.replace(briefRead, `export async function readBriefDetail(
  db: DatabaseConnection,
  ownerId: string,
  briefId: string,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-brief-unavailable")?.value === "1") {
    throw new Error("Private content brief fixture failure");
  }
  const dao = new ContentDao(db);`));

const batchRead = `export async function readBatch(
  db: DatabaseConnection,
  ownerId: string,
  batchId: string,
) {
  const dao = new ContentDao(db);`;
assert.ok(briefSource.includes(batchRead));
await writeFile(briefCommands, (await readFile(briefCommands, "utf8")).replace(batchRead, `export async function readBatch(
  db: DatabaseConnection,
  ownerId: string,
  batchId: string,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-batch-unavailable")?.value === "1") {
    throw new Error("Private content batch fixture failure");
  }
  const dao = new ContentDao(db);`));

const versionRead = `export async function readContentVersion(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  const dao = new ContentDao(db);`;
assert.ok((await readFile(briefCommands, "utf8")).includes(versionRead));
await writeFile(briefCommands, (await readFile(briefCommands, "utf8")).replace(versionRead, `export async function readContentVersion(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-version-unavailable")?.value === "1") {
    throw new Error("Private content version fixture failure");
  }
  const dao = new ContentDao(db);`));

const calendarService = path.join(fixture, "src/features/content/maintenance.ts");
const calendarRead = `export async function readContentCalendar(
  db: DatabaseConnection,
  ownerId: string,
  query: CalendarQuery,
) {
  if (!await ownedBrand(db, ownerId, query.brandId)) return denied("NOT_FOUND");`;
assert.ok((await readFile(calendarService, "utf8")).includes(calendarRead));
await writeFile(calendarService, (await readFile(calendarService, "utf8")).replace(calendarRead, `export async function readContentCalendar(
  db: DatabaseConnection,
  ownerId: string,
  query: CalendarQuery,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-calendar-unavailable")?.value === "1") {
    throw new Error("Private content calendar fixture failure");
  }
  if (!await ownedBrand(db, ownerId, query.brandId)) return denied("NOT_FOUND");`));

const publicationRead = `export async function readPublication(
  db: DatabaseConnection,
  ownerId: string,
  publicationId: string,
) {
  const dao = new ContentDao(db);`;
assert.ok((await readFile(briefCommands, "utf8")).includes(publicationRead));
await writeFile(briefCommands, (await readFile(briefCommands, "utf8")).replace(publicationRead, `export async function readPublication(
  db: DatabaseConnection,
  ownerId: string,
  publicationId: string,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-publication-unavailable")?.value === "1") {
    throw new Error("Private content publication fixture failure");
  }
  const dao = new ContentDao(db);`));

const variantRead = `export async function readChannelVariants(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  const dao = new ContentDao(db);`;
assert.ok((await readFile(briefCommands, "utf8")).includes(variantRead));
await writeFile(briefCommands, (await readFile(briefCommands, "utf8")).replace(variantRead, `export async function readChannelVariants(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  if ((await (await import("next/headers")).cookies()).get("geo-content-variant-unavailable")?.value === "1") {
    throw new Error("Private channel variant fixture failure");
  }
  const dao = new ContentDao(db);`));

const reportCommands = path.join(fixture, "src/features/reports/commands.ts");
const reportList = `export async function listReports(db: QueryConnection, ownerId: string, brandId: string, limit = 20) {
  const brand = await requireOwnedBrand(db, ownerId, brandId);`;
assert.ok((await readFile(reportCommands, "utf8")).includes(reportList));
await writeFile(reportCommands, (await readFile(reportCommands, "utf8")).replace(reportList, `export async function listReports(db: QueryConnection, ownerId: string, brandId: string, limit = 20) {
  if ((await (await import("next/headers")).cookies()).get("geo-reports-unavailable")?.value === "1") {
    throw new Error("Private report fixture failure");
  }
  const brand = await requireOwnedBrand(db, ownerId, brandId);`));

const observationCommands = path.join(fixture, "src/features/formal-retest/commands.ts");
const observationList = `export async function listFormalObservations(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);`;
assert.ok((await readFile(observationCommands, "utf8")).includes(observationList));
await writeFile(observationCommands, (await readFile(observationCommands, "utf8")).replace(observationList, `export async function listFormalObservations(db: DatabaseConnection, ownerId: string, brandId: string) {
  if ((await (await import("next/headers")).cookies()).get("geo-observations-unavailable")?.value === "1") {
    throw new Error("Private observation fixture failure");
  }
  const owned = await new BrandDao(db).owned(ownerId, brandId);`));

const interventionCommands = path.join(fixture, "src/features/formal-retest/intervention-commands.ts");
const interventionSource = await readFile(interventionCommands, "utf8");
const interventionList = "export async function listInterventionBatches(db: DatabaseConnection, ownerId: string, brandId: string): Promise<ListResult> {";
assert.ok(interventionSource.includes(interventionList));
await writeFile(interventionCommands, interventionSource.replace(interventionList, `${interventionList}
  if ((await (await import("next/headers")).cookies()).get("geo-interventions-unavailable")?.value === "1") {
    throw new Error("Private intervention fixture failure");
  }`));

const leadCommands = path.join(fixture, "src/features/business-feedback/commands.ts");
const leadSource = await readFile(leadCommands, "utf8");
const leadList = "export async function listBusinessLeads(db: DatabaseConnection, ownerId: string, brandId: string) {";
assert.ok(leadSource.includes(leadList));
await writeFile(leadCommands, leadSource.replace(leadList, `${leadList}
  if ((await (await import("next/headers")).cookies()).get("geo-leads-unavailable")?.value === "1") {
    throw new Error("Private leads fixture failure");
  }`));

const leadQualityCommands = path.join(fixture, "src/features/business-feedback/quality-commands.ts");
const leadQualitySource = await readFile(leadQualityCommands, "utf8");
const leadQualityList = "export async function listLeadQuality(db: DatabaseConnection, ownerId: string, brandId: string) {";
assert.ok(leadQualitySource.includes(leadQualityList));
await writeFile(leadQualityCommands, leadQualitySource.replace(leadQualityList, `${leadQualityList}
  if ((await (await import("next/headers")).cookies()).get("geo-lead-quality-unavailable")?.value === "1") {
    throw new Error("Private lead quality fixture failure");
  }`));

const leadSuggestionCommands = path.join(fixture, "src/features/business-feedback/suggestion-commands.ts");
const leadSuggestionSource = await readFile(leadSuggestionCommands, "utf8");
const leadSuggestionList = "export async function listLeadSuggestions(db: DatabaseConnection, ownerId: string, brandId: string) {";
const leadSuggestionEnv = "  const env = options.env ?? process.env;";
assert.ok(leadSuggestionSource.includes(leadSuggestionList) && leadSuggestionSource.includes(leadSuggestionEnv));
await writeFile(leadSuggestionCommands, leadSuggestionSource
  .replace(leadSuggestionList, leadSuggestionList + '\n' + [
    '  const probe = (await (await import("next/headers")).cookies()).get("geo-lead-suggestions-read")?.value;',
    '  if (probe === "unavailable") throw new Error("Private lead suggestions fixture failure");',
    '  if (probe === "not-found") return failed("NOT_FOUND");',
  ].join("\n"))
  .replace(leadSuggestionEnv, [
    '  const port = Number((await (await import("next/headers")).cookies()).get("geo-lead-suggestions-mock-port")?.value);',
    '  const env = Number.isSafeInteger(port) && port > 0 && port < 65536 ? {',
    '    OPENAI_BASE_URL: "http://127.0.0.1:" + port + "/v1",',
    '    OPENAI_API_KEY: "fixture-only",',
    '    OPENAI_MODEL: "lead-suggestions-fixture",',
    '  } : {};',
  ].join("\n")));

const crawlerPage = path.join(fixture, "src/features/data-connections/crawler-page.tsx");
const crawlerSource = await readFile(crawlerPage, "utf8");
const crawlerLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(crawlerSource.includes(crawlerLabels));
await writeFile(crawlerPage, crawlerSource.replace(crawlerLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-crawler-visits-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private crawler visits fixture failure");
${crawlerLabels}`));

const connectorEventsPage = path.join(fixture, "src/features/data-connections/event-page.tsx");
const connectorEventsSource = await readFile(connectorEventsPage, "utf8");
const connectorEventLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(connectorEventsSource.includes(connectorEventLabels));
await writeFile(connectorEventsPage, connectorEventsSource.replace(connectorEventLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-connector-events-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private connector events fixture failure");
${connectorEventLabels}`));

const dataConnectionsPage = path.join(fixture, "src/features/data-connections/preview-page.tsx");
const dataConnectionsSource = await readFile(dataConnectionsPage, "utf8");
const dataConnectionLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(dataConnectionsSource.includes(dataConnectionLabels));
await writeFile(dataConnectionsPage, dataConnectionsSource.replace(dataConnectionLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-data-connections-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private data connections fixture failure");
${dataConnectionLabels}`));

const syncAuthorizationsPage = path.join(fixture, "src/features/data-connections/revocation-page.tsx");
const syncAuthorizationsSource = await readFile(syncAuthorizationsPage, "utf8");
const syncAuthorizationLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(syncAuthorizationsSource.includes(syncAuthorizationLabels));
await writeFile(syncAuthorizationsPage, syncAuthorizationsSource.replace(syncAuthorizationLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-sync-authorizations-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private sync authorizations fixture failure");
${syncAuthorizationLabels}`));

const notificationsPage = path.join(fixture, "src/features/notification-endpoints/notifications-page.tsx");
const notificationsSource = await readFile(notificationsPage, "utf8");
const notificationLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(notificationsSource.includes(notificationLabels));
await writeFile(notificationsPage, notificationsSource.replace(notificationLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-notification-endpoints-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private notification endpoints fixture failure");
${notificationLabels}`));

const externalConnectionsPage = path.join(fixture, "src/features/external-connections/connections-page.tsx");
const externalConnectionsSource = await readFile(externalConnectionsPage, "utf8");
const externalConnectionLabels = "    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));";
assert.ok(externalConnectionsSource.includes(externalConnectionLabels));
await writeFile(externalConnectionsPage, externalConnectionsSource.replace(externalConnectionLabels, `    const probe = (await (await import("next/headers")).cookies()).get("geo-external-connections-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private external connections fixture failure");
${externalConnectionLabels}`));

const delegationsPage = path.join(fixture, "src/features/commercial/delegations-page.tsx");
const delegationsSource = await readFile(delegationsPage, "utf8");
const delegationsRead = "    workspace = await listDelegationWorkspace(getConnection(), user.id, now);";
assert.ok(delegationsSource.includes(delegationsRead));
await writeFile(delegationsPage, delegationsSource.replace(delegationsRead, `${delegationsRead}
    const probe = (await (await import("next/headers")).cookies()).get("geo-delegations-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") {
      workspace = null;
      throw new Error("Private brand delegation fixture failure");
    }`));

const ordersPage = path.join(fixture, "src/features/commercial/orders-page.tsx");
const ordersSource = await readFile(ordersPage, "utf8");
const ordersRead = "    workspace = await loadOrderWorkspace(getConnection(), user.id);";
assert.ok(ordersSource.includes(ordersRead));
await writeFile(ordersPage, ordersSource.replace(ordersRead, `${ordersRead}
    const probe = (await (await import("next/headers")).cookies()).get("geo-orders-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") {
      workspace = null;
      throw new Error("Private quote orders fixture failure");
    }`));

const deliveriesPage = path.join(fixture, "src/features/commercial/deliveries-page.tsx");
const deliveriesSource = await readFile(deliveriesPage, "utf8");
const deliveriesRead = "    workspace = await loadDeliveryWorkspace(getConnection(), user.id);";
assert.ok(deliveriesSource.includes(deliveriesRead));
await writeFile(deliveriesPage, deliveriesSource.replace(deliveriesRead, `    const probe = (await (await import("next/headers")).cookies()).get("geo-deliveries-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private delivery fixture failure");
${deliveriesRead}`));

const entitlementsPage = path.join(fixture, "src/features/commercial/entitlements-page.tsx");
const entitlementsSource = await readFile(entitlementsPage, "utf8");
const entitlementsRead = "    workspace = await loadEntitlementWorkspace(getConnection(), user.id);";
assert.ok(entitlementsSource.includes(entitlementsRead));
await writeFile(entitlementsPage, entitlementsSource.replace(entitlementsRead, `    const probe = (await (await import("next/headers")).cookies()).get("geo-entitlements-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private entitlements fixture failure");
${entitlementsRead}`));

const sharesPage = path.join(fixture, "src/features/commercial/shares-page.tsx");
const sharesSource = await readFile(sharesPage, "utf8");
const sharesRead = "    workspace = await loadShareWorkspace(getConnection(), user.id);";
assert.ok(sharesSource.includes(sharesRead));
await writeFile(sharesPage, sharesSource.replace(sharesRead, `    const probe = (await (await import("next/headers")).cookies()).get("geo-shares-read")?.value;
    if (probe === "slow") await new Promise(resolve => setTimeout(resolve, 1800));
    if (probe === "unavailable") throw new Error("Private white-label share fixture failure");
${sharesRead}`));

const demoPage = path.join(fixture, "src/features/monitoring/demo-page.tsx");
const demoSource = await readFile(demoPage, "utf8");
const demoRead = "    const [currentBrand] = await listDemoBrands(connection, user.id);";
assert.ok(demoSource.includes(demoRead));
await writeFile(demoPage, demoSource.replace(demoRead, `    const probe = (await (await import("next/headers")).cookies()).get("geo-demo-read")?.value;
    if (probe === "slow-unavailable") {
      await new Promise(resolve => setTimeout(resolve, 1800));
      throw new Error("Private demo fixture failure");
    }
${demoRead}`));

const monitoringService = path.join(fixture, "src/features/monitoring/service.ts");
const monitoringSource = await readFile(monitoringService, "utf8");
const runRead = "export async function readOwnedRun(ownerId: string, runId: string) {\n  try {";
assert.ok(monitoringSource.includes(runRead));
await writeFile(monitoringService, monitoringSource.replace(runRead, `${runRead}
    if ((await (await import("next/headers")).cookies()).get("geo-run-read")?.value === "slow-unavailable") {
      await new Promise(resolve => setTimeout(resolve, 1800));
      throw new Error("Private run fixture failure");
    }`));

const assetCommands = path.join(fixture, "src/features/asset-reuse/image-asset-commands.ts");
const assetSource = await readFile(assetCommands, "utf8");
const assetRead = 'export async function listImageAssets(db: QueryConnection, actorId: string, brandId: string): Promise<ImageAssetList> {';
assert.ok(assetSource.includes(assetRead));
await writeFile(assetCommands, assetSource.replace(assetRead, `${assetRead}
  if ((await (await import("next/headers")).cookies()).get("geo-image-assets-read")?.value === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private image assets fixture failure");
  }`));

const sourceCommands = path.join(fixture, "src/features/asset-reuse/commands.ts");
const sourceOriginals = await readFile(sourceCommands, "utf8");
const sourceRead = "export async function listImportedOriginals(db: DatabaseConnection, userId: string, brandId: string, now = new Date()) {";
assert.ok(sourceOriginals.includes(sourceRead));
await writeFile(sourceCommands, sourceOriginals.replace(sourceRead, `${sourceRead}
  if ((await (await import("next/headers")).cookies()).get("geo-source-originals-read")?.value === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private source originals fixture failure");
  }`));

const templateCommands = path.join(fixture, "src/features/asset-reuse/template-commands.ts");
const templateSource = await readFile(templateCommands, "utf8");
const templateRead = "export async function listContentTemplates(db: QueryConnection, actorId: string, brandId: string): Promise<TemplateList> {";
assert.ok(templateSource.includes(templateRead));
await writeFile(templateCommands, templateSource.replace(templateRead, `${templateRead}
  if ((await (await import("next/headers")).cookies()).get("geo-content-templates-read")?.value === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private content templates fixture failure");
  }`));

const profileCommands = path.join(fixture, "src/features/channel-variants/commands.ts");
const profileSource = await readFile(profileCommands, "utf8");
const profileRead = "export async function listChannelProfiles(db: DatabaseConnection, ownerId: string, brandId: string) {";
const profileWrite = "  const parsed = publishChannelProfileSchema.safeParse(input);";
assert.ok(profileSource.includes(profileRead) && profileSource.includes(profileWrite));
await writeFile(profileCommands, profileSource
  .replace(profileRead, `${profileRead}
  if ((await (await import("next/headers")).cookies()).get("geo-channel-profiles-read")?.value === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private channel profiles fixture failure");
  }`)
  .replace(profileWrite, `  if ((await (await import("next/headers")).cookies()).get("geo-channel-profiles-write")?.value === "slow") {
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
${profileWrite}`));

const protocolCommands = path.join(fixture, "src/features/monitoring/protocol-commands.ts");
const protocolSource = await readFile(protocolCommands, "utf8");
const protocolRead = "export async function listSamplingProtocols(db: DatabaseConnection, ownerId: string): Promise<SamplingProtocolList> {";
const protocolWrite = `export async function createSamplingProtocol(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateSamplingProtocolInput,
  clock: Clock = systemClock,
): Promise<{ protocol: SamplingProtocolView } | { error: SamplingProtocolError }> {`;
assert.ok(protocolSource.includes(protocolRead) && protocolSource.includes(protocolWrite));
await writeFile(protocolCommands, protocolSource
  .replace(protocolRead, `${protocolRead}
  if ((await (await import("next/headers")).cookies()).get("geo-protocols-read")?.value === "slow-unavailable") {
    await new Promise(resolve => setTimeout(resolve, 1800));
    throw new Error("Private sampling protocols fixture failure");
  }`)
  .replace(protocolWrite, `${protocolWrite}
  if ((await (await import("next/headers")).cookies()).get("geo-protocols-write")?.value === "slow") {
    await new Promise(resolve => setTimeout(resolve, 1200));
  }`));

const usageActivity = path.join(fixture, "src/features/monitoring/activity.ts");
const usageSource = await readFile(usageActivity, "utf8");
const usageRead = "export async function readOwnerUsage(connection: DatabaseConnection, ownerId: string, filter: UsageFilter) {\n  try {";
assert.ok(usageSource.includes(usageRead));
await writeFile(usageActivity, usageSource.replace(usageRead, `${usageRead}
    if ((await (await import("next/headers")).cookies()).get("geo-usage-read")?.value === "slow-unavailable") {
      await new Promise(resolve => setTimeout(resolve, 1800));
      throw new Error("Private usage fixture failure");
    }`));

function command(args) {
  const child = spawn("pnpm", ["exec", "next", ...args], { cwd: root, env: process.env, stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Next.js exited with code ${code}`)));
  });
}
await command(["build", fixture]);
await command(["start", fixture, "--hostname", baseURL.hostname, "--port", baseURL.port]);
