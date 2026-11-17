export function GET() {
  return Response.json(
    { status: "ok", service: "geo-pro" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
