import { captureSheetCreateResponse } from "@/features/assisted-capture/api";

export function POST(request: Request) {
  return captureSheetCreateResponse(request);
}
