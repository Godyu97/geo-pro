import { toNextJsHandler } from "better-auth/next-js";

import { isAuthConfigured } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";
import { localeCookie, resolveLocale } from "@/lib/i18n/locale";
import { getMessages } from "@/lib/i18n/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

function unavailable(request: NextRequest) {
  const locale = resolveLocale(
    request.cookies.get(localeCookie)?.value,
    request.headers.get("accept-language"),
  );
  return Response.json(
    {
      code: "AUTH_UNAVAILABLE",
      message: getMessages(locale).auth.unavailable,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function handle(request: NextRequest) {
  if (!isAuthConfigured()) {
    return unavailable(request);
  }

  try {
    const handlers = toNextJsHandler(getAuth());
    return await (request.method === "GET"
      ? handlers.GET(request)
      : handlers.POST(request));
  } catch {
    // Do not send driver errors, connection strings or stack traces to clients.
    return unavailable(request);
  }
}

export { handle as GET, handle as POST };
