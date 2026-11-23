import { syncAuthorizationCreateResponse } from "@/features/data-connections/revocation-api";

export function POST(request: Request) {
  return syncAuthorizationCreateResponse(request);
}
