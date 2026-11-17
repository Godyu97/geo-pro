import "server-only";

import { getSessionState } from "@/lib/auth/session";
import { getConnection, type DatabaseConnection } from "@/lib/db/connection";
import type { MaintenancePermission } from "./contracts";
import { maintenanceUnavailable, readMaintenanceAccess } from "./core";

export async function currentMaintenanceAccess(permission: MaintenancePermission | null = null, invalidInput = false) {
  // Each page/API invokes the server session boundary independently of layout.
  const session = await getSessionState();
  let connection: DatabaseConnection | undefined;
  try {
    connection = getConnection();
    if (session.status === "authenticated") return await readMaintenanceAccess(connection, session.session.user.id, permission, invalidInput);
    if (session.status === "anonymous") return await readMaintenanceAccess(connection, null, permission, invalidInput);
  } catch {
    // A missing/unavailable database is a service failure, never anonymous success.
  }
  return maintenanceUnavailable(connection);
}
