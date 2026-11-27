import "server-only";

import { getConnection } from "@/lib/db/connection";
import { calendarQuerySchema } from "./contracts";
import { readMaintenanceAccess } from "./maintenance";

export const contentCalendarPath = "/dashboard/content/calendar";

export async function calendarBrandUnavailable(actorId: string, requestPath: string | null) {
  if (!requestPath) return false;
  const url = new URL(requestPath, "http://localhost");
  if (url.pathname !== contentCalendarPath) return false;
  const brandIds = url.searchParams.getAll("brandId");
  const factIds = url.searchParams.getAll("factVersionId");
  if (brandIds.length > 1 || factIds.length > 1) return true;
  const query = calendarQuerySchema.partial({ brandId: true }).safeParse({
    brandId: brandIds[0],
    factVersionId: factIds[0],
  });
  if (!query.success) return true;
  if (!query.data.brandId) return false;
  try {
    return !(await readMaintenanceAccess(getConnection(), actorId, query.data.brandId));
  } catch {
    // The calendar renders its retry state when storage is unavailable.
    return false;
  }
}
