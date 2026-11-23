import { notificationWriteResponse } from "@/features/notification-endpoints/api";

export function POST(request: Request) {
  return notificationWriteResponse(request);
}
