"use client";

import { usePathname } from "next/navigation";

import { resolveWorkspaceSection, type WorkspaceSectionId } from "@/components/layout/workspace-section";

export function WorkspaceLocation({
  currentLocation,
  labels,
}: {
  currentLocation: string;
  labels: Record<WorkspaceSectionId, string>;
}) {
  const section = resolveWorkspaceSection(usePathname() ?? "/dashboard");
  return (
    <p className="min-w-0 truncate text-sm font-medium" data-workspace-section={section}>
      <span className="sr-only">{currentLocation}: </span>
      {labels[section]}
    </p>
  );
}
