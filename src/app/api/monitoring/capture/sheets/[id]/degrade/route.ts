import { captureSheetDegradeResponse } from "@/features/assisted-capture/api";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => captureSheetDegradeResponse(request, params.id));
}
