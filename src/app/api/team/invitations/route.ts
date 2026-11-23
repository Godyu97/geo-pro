import { teamInvitationCreateResponse, teamInvitationListResponse } from "@/features/team-access/api";

export function GET(request: Request) {
  return teamInvitationListResponse(request);
}

export function POST(request: Request) {
  return teamInvitationCreateResponse(request);
}
