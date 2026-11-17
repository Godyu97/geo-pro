import { z } from "zod";

// Only existing protected app routes are eligible, never external origins.
export function safeReturnTo(value: unknown): string {
  const result = z.string().max(2048).safeParse(value);
  if (!result.success || !/^\/dashboard(?:[/?#]|$)/.test(result.data) || /[\\\u0000-\u001f]/.test(result.data)) {
    return "/dashboard";
  }
  const target = new URL(result.data, "https://local.invalid");
  return target.origin === "https://local.invalid" && target.pathname === "/dashboard"
    ? `${target.pathname}${target.search}${target.hash}`
    : "/dashboard";
}
