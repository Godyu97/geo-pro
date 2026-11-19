import { confirmFormalRunResponse } from "@/features/capabilities/api";
import { monitoringRunResponse } from "@/features/monitoring/api";

export async function POST(request: Request) {
  const peek = await request.clone().json().catch(() => null);
  if (peek && typeof peek === "object" && !Array.isArray(peek) && "action" in peek) {
    return monitoringRunResponse(request);
  }
  return confirmFormalRunResponse(request);
}
