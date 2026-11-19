import "server-only";

import { openCache } from "../../lib/cache/store.ts";
import { getSessionState } from "../../lib/auth/session.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { getConnection } from "../../lib/db/connection.ts";
import { readSupportCase, supportUnavailable, type SupportLookup } from "./read.ts";

export type { SupportLookup } from "./read.ts";

export async function lookupSupport(rawId: string | null, invalidInput = false): Promise<SupportLookup> {
  const session = await getSessionState();
  let connection: DatabaseConnection | undefined;
  try {
    connection = getConnection();
    if (session.status === "authenticated") return await readSupportCase(connection, session.session.user.id, rawId, openCache(), invalidInput);
    if (session.status === "anonymous") return await readSupportCase(connection, null, rawId, openCache(), invalidInput);
  } catch {
    // Database or session infrastructure failure stays a safe unavailable result.
  }
  return supportUnavailable(connection);
}
