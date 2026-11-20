import { spawnSync } from "node:child_process";

// Compose is the isolated target. A caller's .env.local database is not used.
const databaseUrl = process.env.GEO_DUAL_DB_URL || "postgresql://geo:geo@127.0.0.1:55432/geo";
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  console.error("verify:dual-db only accepts a loopback PostgreSQL URL");
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_PROVIDER: "postgresql",
  DATABASE_URL: url.href,
};
const suites = [
  "test:query-plans",
  "test:maintenance",
  "test:brands",
  "test:brand-facts",
  "test:prompts",
  "test:capabilities",
  "test:quotas",
  "test:monitoring",
  "test:data-exports",
  "test:support",
  "test:evidence",
  "test:optimization",
  "test:content",
  "test:reports",
];

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

function run(args) {
  const result = spawnSync("pnpm", args, { env, encoding: "utf8" });
  const output = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  process.stdout.write(output);
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed`);
  return output;
}

try {
  console.log(JSON.stringify({
    event: "dual-db-target",
    host: url.hostname,
    port: url.port,
    database: url.pathname,
    note: "synthetic isolated databases only",
  }));
  run(["db:ddl:check"]);
  for (const suite of suites) {
    const output = run([suite]);
    const skipped = [...output.matchAll(/skipped (\d+)/g)].map((match) => Number(match[1]));
    const failed = [...output.matchAll(/fail (\d+)/g)].map((match) => Number(match[1]));
    if (skipped.length === 0 || skipped.some((count) => count > 0) || failed.some((count) => count > 0)) {
      throw new Error(`${suite} must report zero skipped and zero failed tests`);
    }
  }
  console.log("PASS: dual-database migration, DDL and module tests");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
}
