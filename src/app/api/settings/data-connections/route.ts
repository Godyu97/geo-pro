import { dataConnectionCreateResponse } from "@/features/data-connections/api";

export function POST(request: Request) {
  return dataConnectionCreateResponse(request);
}
