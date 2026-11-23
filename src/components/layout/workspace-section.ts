export type WorkspaceSectionId =
  | "overview"
  | "assistant"
  | "maintenance"
  | "settings"
  | "brands"
  | "monitoring"
  | "optimization"
  | "content"
  | "reports"
  | "orders"
  | "deliveries"
  | "entitlements"
  | "workspace";

const prefixes: Array<[WorkspaceSectionId, string]> = [
  ["orders", "/dashboard/commercial/orders"],
  ["deliveries", "/dashboard/commercial/deliveries"],
  ["entitlements", "/dashboard/commercial/entitlements"],
  ["brands", "/dashboard/brands"],
  ["monitoring", "/dashboard/monitoring"],
  ["optimization", "/dashboard/optimization"],
  ["content", "/dashboard/content"],
  ["reports", "/dashboard/reports"],
  ["settings", "/dashboard/settings"],
  ["maintenance", "/dashboard/maintenance"],
  ["assistant", "/dashboard/assistant"],
];

export function normalizeWorkspacePath(pathname: string) {
  const withoutHash = pathname.split("#")[0] ?? "/";
  const path = withoutHash.split("?")[0] ?? "/";
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function resolveWorkspaceSection(pathname: string): WorkspaceSectionId {
  const path = normalizeWorkspacePath(pathname);
  for (const [id, prefix] of prefixes) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return id;
  }
  if (path === "/dashboard") return "overview";
  return "workspace";
}

export function isWorkspaceSectionActive(pathname: string, section: string) {
  return resolveWorkspaceSection(pathname) === section;
}
