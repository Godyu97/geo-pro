import { toNextJsHandler } from "better-auth/next-js";

import { isAuthConfigured } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    {
      code: "AUTH_UNAVAILABLE",
      message: "认证服务暂不可用，请稍后重试或联系维护者。",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function handle(request: Request) {
  if (!isAuthConfigured()) {
    return unavailable();
  }

  try {
    const handlers = toNextJsHandler(getAuth());
    return await (request.method === "GET"
      ? handlers.GET(request)
      : handlers.POST(request));
  } catch {
    // Do not send driver errors, connection strings or stack traces to clients.
    return unavailable();
  }
}

export { handle as GET, handle as POST };
