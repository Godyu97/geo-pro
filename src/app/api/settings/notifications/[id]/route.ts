import { notificationReadResponse } from "@/features/notification-endpoints/api";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => notificationReadResponse(request, params.id));
}
