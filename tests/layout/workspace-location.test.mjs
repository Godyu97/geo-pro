import assert from "node:assert/strict";
import { test } from "node:test";

import { isWorkspaceSectionActive, resolveWorkspaceSection } from "../../src/components/layout/workspace-section.ts";
import { workspaceEntryHrefs } from "../../src/components/layout/module-links.ts";

test("workspace location follows the current dashboard section", () => {
  assert.equal(resolveWorkspaceSection("/dashboard"), "overview");
  assert.equal(resolveWorkspaceSection("/dashboard/"), "overview");
  assert.equal(resolveWorkspaceSection("/dashboard?ready=1"), "overview");
  assert.equal(resolveWorkspaceSection("/dashboard/assistant"), "assistant");
  assert.equal(resolveWorkspaceSection("/dashboard/maintenance/support"), "maintenance");
  assert.equal(resolveWorkspaceSection("/dashboard/settings/team"), "settings");
  assert.equal(resolveWorkspaceSection("/dashboard/brands/brand-1/facts"), "brands");
  assert.equal(resolveWorkspaceSection("/dashboard/brands/brand-1/questions"), "prompts");
  assert.equal(resolveWorkspaceSection("/dashboard/monitoring/evidence/obs-1"), "monitoring");
  assert.equal(resolveWorkspaceSection("/dashboard/optimization/task-1"), "optimization");
  assert.equal(resolveWorkspaceSection("/dashboard/content/batches/batch-1"), "content");
  assert.equal(resolveWorkspaceSection("/dashboard/reports/shares"), "reports");
  assert.equal(resolveWorkspaceSection("/dashboard/commercial/orders"), "orders");
  assert.equal(resolveWorkspaceSection("/dashboard/commercial/deliveries/item"), "deliveries");
  assert.equal(resolveWorkspaceSection("/dashboard/commercial/entitlements"), "entitlements");
  assert.equal(resolveWorkspaceSection("/dashboard/unknown"), "workspace");
  assert.equal(resolveWorkspaceSection("/login"), "workspace");
});

test("sidebar active state matches the section and ignores lookalike prefixes", () => {
  for (const [id, href] of Object.entries(workspaceEntryHrefs)) {
    assert.equal(isWorkspaceSectionActive(href, id), true);
  }
  assert.equal(isWorkspaceSectionActive("/dashboard/monitoring/overview", "monitoring"), true);
  assert.equal(isWorkspaceSectionActive("/dashboard/monitoring/overview", "overview"), false);
  assert.equal(isWorkspaceSectionActive("/dashboard/brands", "brands"), true);
  assert.equal(isWorkspaceSectionActive("/dashboard/brand", "brands"), false);
  assert.equal(isWorkspaceSectionActive("/dashboard", "prompts"), false);
});
