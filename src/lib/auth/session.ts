import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthConfigured } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";

export async function requireSession() {
  if (!isAuthConfigured()) {
    redirect("/login");
  }

  const session = await getAuth().api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return session;
}
