import { z } from "zod";

const safeDashboardPaths = [
  "/dashboard", "/dashboard/maintenance", "/dashboard/maintenance/capabilities", "/dashboard/maintenance/support",
  "/dashboard/settings", "/dashboard/settings/usage", "/dashboard/monitoring/new", "/dashboard/monitoring/plans", "/dashboard/monitoring/alerts", "/dashboard/brands", "/dashboard/brands/new",
];
const brandPath = /^\/dashboard\/brands\/[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}(?:\/delete|\/recovery|\/facts|\/questions|\/entity-reviews)?$/i;
const monitoringRunPath = /^\/dashboard\/monitoring\/runs\/[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

// Only existing protected app routes are eligible, never external origins.
export function safeReturnTo(value: unknown): string {
  const result = z.string().max(2048).safeParse(value);
  if (!result.success || !/^\/dashboard(?:[/?#]|$)/.test(result.data) || /[\\\u0000-\u001f\u007f]/.test(result.data)) {
    return "/dashboard";
  }
  const target = new URL(result.data, "https://local.invalid");
  return target.origin === "https://local.invalid" && (safeDashboardPaths.includes(target.pathname) || brandPath.test(target.pathname) || monitoringRunPath.test(target.pathname))
    ? `${target.pathname}${target.search}${target.hash}`
    : "/dashboard";
}

export function loginPath(returnTo: unknown, reason: "session-required" | "unavailable") {
  const params = new URLSearchParams({ returnTo: safeReturnTo(returnTo), reason });
  return `/login?${params}`;
}
