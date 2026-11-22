import { contentMaintenanceResponse } from "@/features/content/api";

export async function POST(request: Request) {
  return contentMaintenanceResponse(request);
}
