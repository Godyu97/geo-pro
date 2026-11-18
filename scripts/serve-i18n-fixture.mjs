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
export default async function Probe() { const locale = await getLocale(); return <main id="main-content"><AuthForm initialMode="login" configured={false} messages={getMessages(locale).auth} returnTo="/dashboard" /></main>; }`,
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

const settingsPage = path.join(fixture, "src/features/account/settings-page.tsx");
await writeFile(settingsPage, (await readFile(settingsPage, "utf8")).replace(
  '  const { user } = await requireSession();',
  '  const { user } = await requireSession();\n  if ((await (await import("next/headers")).headers()).get("cookie")?.includes("geo-settings-slow=1")) await new Promise(resolve => setTimeout(resolve, 1500));',
));

const brandService = path.join(fixture, "src/features/brands/service.ts");
await writeFile(brandService, (await readFile(brandService, "utf8")).replace(
  '    return { data: await read(new BrandDao(getConnection())) };',
  '    if ((await (await import("next/headers")).headers()).get("cookie")?.includes("geo-brands-slow=1")) await new Promise(resolve => setTimeout(resolve, 1500));\n    return { data: await read(new BrandDao(getConnection())) };',
));

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
