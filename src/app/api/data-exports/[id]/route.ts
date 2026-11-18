import { downloadExportResponse } from "@/features/data-exports/api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return downloadExportResponse(request, (await params).id);
}
