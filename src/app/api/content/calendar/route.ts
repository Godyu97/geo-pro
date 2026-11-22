import { contentCalendarResponse } from "@/features/content/api";

export async function GET(request: Request) {
  return contentCalendarResponse(request);
}
