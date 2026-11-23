import { notificationRevokeResponse } from "@/features/notification-endpoints/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => notificationRevokeResponse(request, params.id));
}
