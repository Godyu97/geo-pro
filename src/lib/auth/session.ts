import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthConfigured } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";
import { loginPath } from "@/lib/auth/return-to";

// React cache is request-scoped: layout and page share one authoritative check.
// Never cache a user's session across requests or treat a Cookie as authorization.
export const getSessionState = cache(async () => {
  if (!isAuthConfigured()) {
    return { status: "not-configured" } as const;
  }

  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    return session
      ? { status: "authenticated", session } as const
      : { status: "anonymous" } as const;
  } catch {
    return { status: "unavailable" } as const;
  }
});

export async function requireSession() {
  const state = await getSessionState();
  if (state.status === "authenticated") return state.session;

  const requestHeaders = await headers();
  redirect(loginPath(
    requestHeaders.get("x-geo-path"),
    state.status === "unavailable" ? "unavailable" : "session-required",
  ));
}
