import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("workspace shell keeps a single content landmark", () => {
  const sidebar = read("../../src/components/ui/sidebar.tsx");
  const inset = sidebar.slice(sidebar.indexOf("function SidebarInset"), sidebar.indexOf("function SidebarInput"));
  assert.match(inset, /<div/);
  assert.doesNotMatch(inset, /<main/);

  const layout = read("../../src/app/(dashboard)/layout.tsx");
  assert.equal([...layout.matchAll(/<main\b/g)].length, 1);
  assert.match(layout, /id="main-content"/);
});

test("content entry keeps the task and related actions in the workspace canvas", () => {
  const content = read("../../src/features/content/list-page.tsx");
  assert.doesNotMatch(content, /<main\b/);
  assert.match(content, /aria-label=\{relatedLabel\}/);
  assert.match(content, /break-words/);
  assert.match(content, /relatedEntries/);
  assert.match(content, /gapCount/);
  assert.doesNotMatch(content, /gaps=/);
});

test("report entry stays inside the workspace canvas", () => {
  const reports = read("../../src/features/reports/list-page.tsx");
  assert.doesNotMatch(reports, /<main\b/);
  assert.match(reports, /tracking-tight/);
  assert.match(reports, /aria-label=\{relatedLabel\}/);
  assert.match(reports, /break-words/);
  assert.match(reports, /relatedEntries/);
});
