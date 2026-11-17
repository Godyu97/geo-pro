import { z } from "zod";

// Only existing protected app routes are eligible, never external origins.
export function safeReturnTo(value: unknown): string {
  const result = z.string().max(2048).safeParse(value);
  if (!result.success || !/^\/dashboard(?:[/?#]|$)/.test(result.data) || /[\\\u0000-\u001f\u007f]/.test(result.data)) {
    return "/dashboard";
  }
  const target = new URL(result.data, "https://local.invalid");
  return target.origin === "https://local.invalid" && ["/dashboard", "/dashboard/maintenance", "/dashboard/settings"].includes(target.pathname)
    ? `${target.pathname}${target.search}${target.hash}`
    : "/dashboard";
}

export function loginPath(returnTo: unknown, reason: "session-required" | "unavailable") {
  const params = new URLSearchParams({ returnTo: safeReturnTo(returnTo), reason });
  return `/login?${params}`;
}
