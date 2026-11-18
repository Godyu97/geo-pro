import { open } from "node:fs/promises";
import nextEnv from "@next/env";
import {
  exportPurgeMarkers, inspectBrandPurge, purgeDueBrands, replayBrandPurges, retryBrandPurge,
} from "../src/features/brands/purge.ts";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { openConnection } from "../src/lib/db/connection.ts";

async function readManifest(path) {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("Expected a manifest file");
    const buffer = Buffer.alloc(64 * 1024);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) return JSON.parse(buffer.toString("utf8", 0, length)).markers;
      length += bytesRead;
    }
    throw new Error("Manifest page too large");
  } finally {
    await file.close();
  }
}

async function run(db, command, args) {
  switch (command) {
    case "run": {
      const [limit, at, id] = args;
      if (![0, 1, 3].includes(args.length) || (limit !== undefined && !/^\d+$/.test(limit))) break;
      const result = await purgeDueBrands(db, { limit: limit === undefined ? undefined : Number(limit), after: at ? { at, id } : undefined });
      if (result.results.some(({ status }) => status === "failed" || status === "incomplete")) process.exitCode = 1;
      return result;
    }
    case "retry": {
      if (args.length !== 2) break;
      const [ownerId, brandId] = args;
      const result = await retryBrandPurge(db, { ownerId, brandId });
      if (result.status !== "cleared") process.exitCode = 1;
      return result;
    }
    case "inspect": {
      if (![2, 5].includes(args.length)) break;
      const [ownerId, brandId, kind, reservationId, attemptId] = args;
      const result = await inspectBrandPurge(db, { ownerId, brandId }, kind ? { kind, reservationId, attemptId } : undefined);
      if (!result) process.exitCode = 1;
      return result ?? { error: "not-found" };
    }
    case "manifest":
      if (args.length <= 1) return exportPurgeMarkers(db, args[0]);
      break;
    case "replay": {
      if (args.length !== 1) break;
      const results = await replayBrandPurges(db, await readManifest(args[0]));
      // Known pending fees can still be reconciled after the content is gone.
      if (results.some(({ status, receipt }) => status !== "cleared" && !(status === "incomplete" && receipt?.issue === "unresolved-costs"))) process.exitCode = 1;
      return { results };
    }
  }
  throw new Error("Invalid arguments");
}

nextEnv.loadEnvConfig(process.cwd());
try {
  const config = parseDatabaseConfig(process.env);
  if (!config.success) throw new Error("Invalid database configuration");
  const [command, ...args] = process.argv.slice(2);
  const connection = openConnection(config.data);
  try {
    console.log(JSON.stringify(await run(connection, command, args)));
  } finally {
    await connection.close();
  }
} catch {
  console.error("Brand purge failed. Controlled server use only: pnpm brands:purge run|retry|inspect|manifest|replay [args]");
  process.exitCode = 1;
}
