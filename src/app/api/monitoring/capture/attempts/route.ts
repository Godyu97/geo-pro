import { captureAttemptCreateResponse } from "@/features/assisted-capture/api";

export function POST(request: Request) {
  return captureAttemptCreateResponse(request);
}
