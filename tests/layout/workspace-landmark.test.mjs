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

test("brand entry keeps the task and related actions in the workspace canvas", () => {
  const brands = read("../../src/features/brands/pages.tsx");
  const index = brands.slice(brands.indexOf("export async function BrandIndexPage"), brands.indexOf("export async function NewBrandPage"));
  assert.doesNotMatch(index, /<main\b/);
  assert.match(index, /relatedLabel=\{relatedLabel\}/);
  assert.match(index, /break-words/);
  assert.match(index, /relatedEntries/);
  assert.match(brands, /whitespace-normal/);
  assert.match(index, /noActiveBrand/);
  assert.match(index, /viewBrand/);
  assert.match(index, /newOrResume/);
});

test("brand detail keeps the monitoring action and recovery in the workspace canvas", () => {
  const brands = read("../../src/features/brands/pages.tsx");
  const detail = brands.slice(brands.indexOf("export async function BrandDetailsPage"), brands.indexOf("export async function BrandDeletionPage"));
  assert.doesNotMatch(detail, /<main\b/);
  assert.match(detail, /detailTask/);
  assert.match(detail, /relatedEntries/);
  assert.match(detail, /readinessAction/);
  assert.match(detail, /\[overflow-wrap:anywhere\]/);
  assert.match(detail, /brandActionClass/);
  assert.match(detail, /readinessUnavailable/);
});

test("answer list keeps the task and related actions in the workspace canvas", () => {
  const answers = read("../../src/features/evidence/answers-page.tsx");
  assert.doesNotMatch(answers, /<main\b/);
  assert.match(answers, /aria-label=\{relatedLabel\}/);
  assert.match(answers, /break-words/);
  assert.match(answers, /relatedEntries/);
  assert.match(answers, /whitespace-normal/);
  assert.match(answers, /answersNoBrand/);
  assert.match(answers, /openEvidence/);
});

test("evidence overview keeps the task and related actions in the workspace canvas", () => {
  const overview = read("../../src/features/evidence/overview-page.tsx");
  assert.doesNotMatch(overview, /<main\b/);
  assert.match(overview, /aria-label=\{relatedLabel\}/);
  assert.match(overview, /break-words/);
  assert.match(overview, /relatedEntries/);
  assert.match(overview, /whitespace-normal/);
  assert.doesNotMatch(overview, /<Badge/);
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

test("competitor analysis keeps the task, share table and recovery in the workspace canvas", () => {
  const page = read("../../src/features/competitors/page.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.match(page, /aria-label=\{relatedLabel\}/);
  assert.match(page, /relatedEntries/);
  assert.match(page, /currentBrand/);
  assert.match(page, /shareRegion/);
  assert.match(page, /overflow-x-auto/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /unorderedCount > 0 && !workspace\.rank\.ranked/);
  assert.match(page, /saveSet/);
});

test("content batch keeps the next action and recovery in the workspace canvas", () => {
  const batch = read("../../src/features/content/batch-page.tsx");
  assert.doesNotMatch(batch, /<main\b/);
  assert.match(batch, /batchTaskRetry/);
  assert.match(batch, /batchTaskPaused/);
  assert.match(batch, /batchUnavailable/);
  assert.match(batch, /relatedEntries/);
  assert.match(batch, /retry-failed/);
  assert.match(batch, /canPause/);
  assert.match(batch, /\[overflow-wrap:anywhere\]/);
  assert.match(batch, /whitespace-normal/);
  assert.doesNotMatch(batch, /attempts=/);
});

test("content version keeps the next review action and recovery in the workspace canvas", () => {
  const version = read("../../src/features/content/version-page.tsx");
  assert.doesNotMatch(version, /<main\b/);
  assert.match(version, /versionTaskDraft/);
  assert.match(version, /versionTaskReview/);
  assert.match(version, /versionUnavailable/);
  assert.match(version, /relatedEntries/);
  assert.match(version, /submit-review/);
  assert.match(version, /approve-content/);
  assert.match(version, /\[overflow-wrap:anywhere\]/);
  assert.match(version, /whitespace-normal/);
});

test("channel variants keep the next approval action and recovery in the workspace canvas", () => {
  const page = read("../../src/features/content/channel-variants-page.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.match(page, /channelVariantTaskDiverged/);
  assert.match(page, /channelVariantTaskUnapproved/);
  assert.match(page, /channelVariantTaskExport/);
  assert.match(page, /channelVariantTaskBlocked/);
  assert.match(page, /channelVariantUnavailable/);
  assert.match(page, /relatedEntries/);
  assert.match(page, /saveChannelVariant/);
  assert.match(page, /approveChannelVariant/);
  assert.match(page, /exportChannelVariant/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /whitespace-normal/);
});

test("content calendar keeps the next maintenance action and recovery in the workspace canvas", () => {
  const calendar = read("../../src/features/content/calendar-page.tsx");
  assert.doesNotMatch(calendar, /<main\b/);
  assert.match(calendar, /calendarTaskPlanned/);
  assert.match(calendar, /calendarTaskBlocked/);
  assert.match(calendar, /calendarTaskEmpty/);
  assert.match(calendar, /calendarUnavailable/);
  assert.match(calendar, /relatedEntries/);
  assert.match(calendar, /calendarOpenPlanned/);
  assert.match(calendar, /calendarOpenBlocked/);
  assert.match(calendar, /overflow-x-auto/);
  assert.match(calendar, /\[overflow-wrap:anywhere\]/);
  assert.match(calendar, /whitespace-normal/);
  assert.match(calendar, /whitespace-nowrap/);
});

test("content publication keeps the next check and recovery in the workspace canvas", () => {
  const publication = read("../../src/features/content/publication-page.tsx");
  assert.doesNotMatch(publication, /<main\b/);
  assert.match(publication, /publicationTaskCheck/);
  assert.match(publication, /publicationTaskLimited/);
  assert.match(publication, /publicationTaskDraft/);
  assert.match(publication, /publicationUnavailable/);
  assert.match(publication, /relatedEntries/);
  assert.match(publication, /runPublicCheck/);
  assert.match(publication, /submitManualEvidence/);
  assert.match(publication, /\[overflow-wrap:anywhere\]/);
  assert.match(publication, /whitespace-normal/);
});

test("content brief keeps the next action and recovery in the workspace canvas", () => {
  const brief = read("../../src/features/content/brief-page.tsx");
  assert.doesNotMatch(brief, /<main\b/);
  assert.match(brief, /briefTaskReady/);
  assert.match(brief, /briefTaskGaps/);
  assert.match(brief, /briefUnavailable/);
  assert.match(brief, /relatedEntries/);
  assert.match(brief, /confirmBrief/);
  assert.match(brief, /gapActionAudience/);
  assert.match(brief, /\[overflow-wrap:anywhere\]/);
  assert.match(brief, /whitespace-normal/);
  assert.match(brief, /gapFields\[gap\.code\]\.text/);
});

test("report entry stays inside the workspace canvas", () => {
  const reports = read("../../src/features/reports/list-page.tsx");
  assert.doesNotMatch(reports, /<main\b/);
  assert.match(reports, /tracking-tight/);
  assert.match(reports, /aria-label=\{relatedLabel\}/);
  assert.match(reports, /break-words/);
  assert.match(reports, /relatedEntries/);
});
