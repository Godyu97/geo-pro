import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthConfigured } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";
import { safeReturnTo } from "@/lib/auth/return-to";

export async function requireSession() {
  const requestHeaders = await headers();
  const returnTo = safeReturnTo(requestHeaders.get("x-geo-path"));
  const loginPath = returnTo === "/dashboard"
    ? "/login"
    : `/login?returnTo=${encodeURIComponent(returnTo)}`;
  if (!isAuthConfigured()) {
    redirect(loginPath);
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect(loginPath);
  }

  return session;
}
