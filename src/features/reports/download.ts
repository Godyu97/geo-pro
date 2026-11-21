const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };

/** File download responses stay private. A denial has a status and no body. */
export function reportSnapshotFileResponse(body: string | null, status: number, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...headers, ...extra } });
}
