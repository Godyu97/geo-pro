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
