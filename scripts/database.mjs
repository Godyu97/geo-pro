import { execFileSync } from "node:child_process";
import nextEnv from "@next/env";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";

nextEnv.loadEnvConfig(process.cwd());

function run(args) {
  try {
    process.stdout.write(execFileSync("pnpm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error("Database tool failed. Review the local configuration and schema; no connection details are logged.");
  }
}

try {
  const [action, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Usage: pnpm db:generate | db:migrate | db:auth-schema");
  if (action === "generate") {
    for (const config of ["drizzle.config.ts", "drizzle.sqlite.config.ts"]) run(["exec", "drizzle-kit", "generate", `--config=./${config}`]);
  } else if (action === "auth-schema") {
    for (const [dialect, output] of [["postgresql", "auth-schema.ts"], ["sqlite", "auth-schema.sqlite.ts"]]) {
      run(["dlx", "auth@1.7.25", "generate", "--config", "./auth.schema.config.ts", "--output", `./src/lib/db/${output}`, "--adapter", "drizzle", "--dialect", dialect, "--yes"]);
    }
  } else if (action === "migrate") {
    const config = parseDatabaseConfig(process.env);
    if (!config.success) throw new Error("Explicit database configuration required");
    if (config.data.DATABASE_PROVIDER === "postgresql") run(["exec", "drizzle-kit", "migrate", "--config=./drizzle.config.ts"]);
    else {
      const { openConnection } = await import("../src/lib/db/connection.ts");
      const { migrateSqlite } = await import("../src/lib/db/migrate-sqlite.ts");
      const connection = openConnection(config.data, true);
      try { await migrateSqlite(connection); }
      finally { await connection.close(); }
      console.log("PASS: SQLite migrations applied");
    }
  } else throw new Error("Usage: pnpm db:generate | db:migrate | db:auth-schema");
} catch {
  console.error("Database command failed; check the selected local database, reviewed migrations and schema. Credentials and SQL errors are withheld.");
  process.exitCode = 1;
}
