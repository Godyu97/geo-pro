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

test("observation plan keeps the next checkpoint action and recovery in the workspace canvas", () => {
  const page = read("../../src/features/formal-retest/observations-page.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.match(page, /taskEmpty/);
  assert.match(page, /taskPending/);
  assert.match(page, /taskProgress/);
  assert.match(page, /taskExploratory/);
  assert.match(page, /taskFormal/);
  assert.match(page, /requestFormal/);
  assert.match(page, /viewExcluded/);
  assert.match(page, /viewHistory/);
  assert.match(page, /relatedEntries/);
  assert.match(page, /SERVICE_UNAVAILABLE/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /whitespace-normal/);
});

test("report entry keeps the current snapshot action and recovery in the workspace canvas", () => {
  const reports = read("../../src/features/reports/list-page.tsx");
  assert.doesNotMatch(reports, /<main\b/);
  assert.match(reports, /tracking-tight/);
  assert.match(reports, /aria-label=\{relatedLabel\}/);
  assert.match(reports, /break-words/);
  assert.match(reports, /relatedEntries/);
  assert.match(reports, /snapshotTaskCurrent/);
  assert.match(reports, /snapshotTaskEmpty/);
  assert.match(reports, /snapshotTaskHistory/);
  assert.match(reports, /downloadCurrentJson/);
  assert.match(reports, /reportsUnavailable/);
  assert.match(reports, /\[overflow-wrap:anywhere\]/);
  assert.match(reports, /whitespace-normal/);
});

test("sampling protocols keep header actions, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/monitoring/protocols-page.tsx");
  const panel = read("../../src/features/monitoring/protocols-panel.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.doesNotMatch(panel, /<main\b/);
  assert.match(page, /SERVICE_UNAVAILABLE/);
  assert.match(page, /reload/);
  assert.match(page, /goBrands/);
  assert.match(page, /startDraft/);
  assert.match(page, /browseProtocols/);
  assert.match(page, /whitespace-normal/);
  assert.match(panel, /\[overflow-wrap:anywhere\]/);
  assert.match(panel, /aria-disabled=\{pending\}/);
});

test("settings usage keeps header actions, table container, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/monitoring/usage-page.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.match(page, /SERVICE_UNAVAILABLE/);
  assert.match(page, /retry/);
  assert.match(page, /backSettings/);
  assert.match(page, /adjustScope/);
  assert.match(page, /viewLedger/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /<Table/);
  assert.match(page, /<Badge/);
});

test("monitoring run confirmation keeps header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/capabilities/run-page.tsx");
  const confirm = read("../../src/features/capabilities/run-confirm.tsx");
  const registration = read("../../src/features/monitoring/registration.tsx");
  const form = read("../../src/features/monitoring/registration-form.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.doesNotMatch(confirm, /<main\b/);
  assert.doesNotMatch(registration, /<main\b/);
  assert.doesNotMatch(form, /<main\b/);
  assert.match(page, /<header\b/);
  assert.match(page, /SERVICE_UNAVAILABLE/);
  assert.match(page, /retry/);
  assert.match(page, /backMonitoring/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /<Card/);
  assert.match(confirm, /<CardContent/);
  assert.match(confirm, /<Badge/);
  assert.match(confirm, /aria-disabled=\{pending\}/);
  assert.match(confirm, /\[overflow-wrap:anywhere\]/);
  assert.match(registration, /<Card/);
  assert.match(registration, /<Badge/);
  assert.match(form, /\[overflow-wrap:anywhere\]/);
  assert.match(form, /whitespace-normal/);
});

test("assisted capture keeps header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/assisted-capture/capture-page.tsx");
  const panel = read("../../src/features/assisted-capture/capture-panel.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.doesNotMatch(panel, /<main\b/);
  assert.match(page, /<header\b/);
  assert.match(page, /SERVICE_UNAVAILABLE/);
  assert.match(page, /reload/);
  assert.match(page, /backOverview/);
  assert.match(page, /openBrand/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(panel, /<Card/);
  assert.match(panel, /<CardContent/);
  assert.match(panel, /<Badge/);
  assert.match(panel, /<Input/);
  assert.match(panel, /<Label/);
  assert.match(panel, /aria-disabled=\{pending\}/);
  assert.match(panel, /\[overflow-wrap:anywhere\]/);
  assert.match(panel, /whitespace-normal/);
});

test("brand facts workspace keeps header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/brand-facts/page.tsx");
  const workspace = read("../../src/features/brand-facts/workspace.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.doesNotMatch(workspace, /<main\b/);
  assert.match(page, /<header\b/);
  assert.match(page, /messages\.unavailable/);
  assert.match(page, /messages\.reload/);
  assert.match(page, /messages\.back/);
  assert.match(page, /relatedEntries/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(workspace, /<Card/);
  assert.match(workspace, /<CardContent/);
  assert.match(workspace, /<Badge/);
  assert.match(workspace, /<Input/);
  assert.match(workspace, /<Label/);
  assert.match(workspace, /aria-disabled=\{pending\}/);
  assert.match(workspace, /\[overflow-wrap:anywhere\]/);
  assert.match(workspace, /whitespace-normal/);
});

test("entity accuracy workspaces keep header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const reviewsPage = read("../../src/features/entity-accuracy/reviews-page.tsx");
  const reviewsWorkspace = read("../../src/features/entity-accuracy/reviews-workspace.tsx");
  assert.doesNotMatch(reviewsPage, /<main\b/);
  assert.doesNotMatch(reviewsWorkspace, /<main\b/);
  assert.match(reviewsPage, /<header\b/);
  assert.match(reviewsPage, /SERVICE_UNAVAILABLE/);
  assert.match(reviewsPage, /messages\.reload/);
  assert.match(reviewsPage, /messages\.back/);
  assert.match(reviewsPage, /relatedEntries/);
  assert.match(reviewsPage, /whitespace-normal/);
  assert.match(reviewsPage, /\[overflow-wrap:anywhere\]/);
  assert.match(reviewsWorkspace, /<Card/);
  assert.match(reviewsWorkspace, /<CardContent/);
  assert.match(reviewsWorkspace, /<Badge/);
  assert.match(reviewsWorkspace, /<Input/);
  assert.match(reviewsWorkspace, /<Label/);
  assert.match(reviewsWorkspace, /aria-disabled=\{pending\}/);
  assert.match(reviewsWorkspace, /\[overflow-wrap:anywhere\]/);
  assert.match(reviewsWorkspace, /whitespace-normal/);

  const correctionsPage = read("../../src/features/entity-accuracy/corrections-page.tsx");
  const correctionsWorkspace = read("../../src/features/entity-accuracy/corrections-workspace.tsx");
  assert.doesNotMatch(correctionsPage, /<main\b/);
  assert.doesNotMatch(correctionsWorkspace, /<main\b/);
  assert.match(correctionsPage, /<header\b/);
  assert.match(correctionsPage, /SERVICE_UNAVAILABLE/);
  assert.match(correctionsPage, /messages\.reload/);
  assert.match(correctionsPage, /messages\.back/);
  assert.match(correctionsPage, /relatedEntries/);
  assert.match(correctionsPage, /whitespace-normal/);
  assert.match(correctionsPage, /\[overflow-wrap:anywhere\]/);
  assert.match(correctionsWorkspace, /<Card/);
  assert.match(correctionsWorkspace, /<CardContent/);
  assert.match(correctionsWorkspace, /<Badge/);
  assert.match(correctionsWorkspace, /<Input/);
  assert.match(correctionsWorkspace, /<Label/);
  assert.match(correctionsWorkspace, /aria-disabled=\{pendingDisambiguation\}/);
  assert.match(correctionsWorkspace, /aria-disabled=\{pendingCorrection\}/);
  assert.match(correctionsWorkspace, /\[overflow-wrap:anywhere\]/);
  assert.match(correctionsWorkspace, /whitespace-normal/);
});

test("prompt sets workspace keeps header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const page = read("../../src/features/prompts/page.tsx");
  const workspace = read("../../src/features/prompts/workspace.tsx");
  assert.doesNotMatch(page, /<main\b/);
  assert.doesNotMatch(workspace, /<main\b/);
  assert.match(page, /<header\b/);
  assert.match(page, /messages\.unavailable/);
  assert.match(page, /messages\.reload/);
  assert.match(page, /messages\.back/);
  assert.match(page, /relatedEntries/);
  assert.match(page, /whitespace-normal/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(workspace, /<Card/);
  assert.match(workspace, /<CardContent/);
  assert.match(workspace, /<Badge/);
  assert.match(workspace, /<Input/);
  assert.match(workspace, /<Label/);
  assert.match(workspace, /aria-disabled=\{pending\}/);
  assert.match(workspace, /\[overflow-wrap:anywhere\]/);
  assert.match(workspace, /whitespace-normal/);
});

test("entity accuracy workspaces keep header actions, shared cards, wrapping, and read recovery in the workspace canvas", () => {
  const reviewsPage = read("../../src/features/entity-accuracy/reviews-page.tsx");
  const reviewsWorkspace = read("../../src/features/entity-accuracy/reviews-workspace.tsx");
  assert.doesNotMatch(reviewsPage, /<main\b/);
  assert.doesNotMatch(reviewsWorkspace, /<main\b/);
  assert.match(reviewsPage, /<header\b/);
  assert.match(reviewsPage, /SERVICE_UNAVAILABLE/);
  assert.match(reviewsPage, /messages\.reload/);
  assert.match(reviewsPage, /messages\.back/);
  assert.match(reviewsPage, /relatedEntries/);
  assert.match(reviewsPage, /whitespace-normal/);
  assert.match(reviewsPage, /\[overflow-wrap:anywhere\]/);
  assert.match(reviewsWorkspace, /<Card/);
  assert.match(reviewsWorkspace, /<CardContent/);
  assert.match(reviewsWorkspace, /<Badge/);
  assert.match(reviewsWorkspace, /<Input/);
  assert.match(reviewsWorkspace, /<Label/);
  assert.match(reviewsWorkspace, /aria-disabled=\{pending\}/);
  assert.match(reviewsWorkspace, /\[overflow-wrap:anywhere\]/);
  assert.match(reviewsWorkspace, /whitespace-normal/);

  const correctionsPage = read("../../src/features/entity-accuracy/corrections-page.tsx");
  const correctionsWorkspace = read("../../src/features/entity-accuracy/corrections-workspace.tsx");
  assert.doesNotMatch(correctionsPage, /<main\b/);
  assert.doesNotMatch(correctionsWorkspace, /<main\b/);
  assert.match(correctionsPage, /<header\b/);
  assert.match(correctionsPage, /SERVICE_UNAVAILABLE/);
  assert.match(correctionsPage, /messages\.reload/);
  assert.match(correctionsPage, /messages\.back/);
  assert.match(correctionsPage, /relatedEntries/);
  assert.match(correctionsPage, /whitespace-normal/);
  assert.match(correctionsPage, /\[overflow-wrap:anywhere\]/);
  assert.match(correctionsWorkspace, /<Card/);
  assert.match(correctionsWorkspace, /<CardContent/);
  assert.match(correctionsWorkspace, /<Badge/);
  assert.match(correctionsWorkspace, /<Input/);
  assert.match(correctionsWorkspace, /<Label/);
  assert.match(correctionsWorkspace, /aria-disabled=\{pendingDisambiguation\}/);
  assert.match(correctionsWorkspace, /aria-disabled=\{pendingCorrection\}/);
  assert.match(correctionsWorkspace, /\[overflow-wrap:anywhere\]/);
  assert.match(correctionsWorkspace, /whitespace-normal/);
});

test("brand deletion and recovery keep header actions, opaque recovery, and read recovery", () => {
  const brands = read("../../src/features/brands/pages.tsx");
  const buttons = read("../../src/features/brands/deletion-buttons.tsx");
  const deletionLoading = read("../../src/app/(dashboard)/dashboard/brands/[id]/delete/loading.tsx");
  const recoveryLoading = read("../../src/app/(dashboard)/dashboard/brands/[id]/recovery/loading.tsx");
  const deletion = brands.slice(brands.indexOf("export async function BrandDeletionPage"), brands.indexOf("export async function BrandRecoveryPage"));
  const recovery = brands.slice(brands.indexOf("export async function BrandRecoveryPage"), brands.indexOf("export async function brandMetadata"));
  assert.doesNotMatch(deletion, /<main\b/);
  assert.doesNotMatch(recovery, /<main\b/);
  assert.match(deletion, /<header\b/);
  assert.match(recovery, /<header\b/);
  assert.match(deletion, /deletionTask/);
  assert.match(deletion, /relatedEntries/);
  assert.match(deletion, /<Card/);
  assert.match(deletion, /\[overflow-wrap:anywhere\]/);
  assert.match(deletion, /BrandScopeFailure/);
  assert.match(deletion, /t\("unavailable"\)/);
  assert.match(deletion, /t\("reload"\)/);
  assert.match(deletion, /t\("trace"/);
  assert.doesNotMatch(recovery, /fieldName/);
  assert.doesNotMatch(recovery, /impact\.name/);
  assert.match(recovery, /brandReference/);
  assert.match(recovery, /recoveryDeadline/);
  assert.match(recovery, /relatedEntries/);
  assert.match(recovery, /<Card/);
  assert.match(recovery, /\[overflow-wrap:anywhere\]/);
  assert.match(recovery, /BrandScopeFailure/);
  assert.match(recovery, /t\("unavailable"\)/);
  assert.match(recovery, /t\("reload"\)/);
  assert.match(recovery, /brandActionClass/);
  assert.match(buttons, /aria-disabled=\{pending\}/);
  assert.match(buttons, /whitespace-normal/);
  assert.match(deletionLoading, /role="status"/);
  assert.match(deletionLoading, /deletionLoading/);
  assert.match(recoveryLoading, /role="status"/);
  assert.match(recoveryLoading, /recoveryLoading/);
  assert.match(brands, /function BrandScopeFailure/);
  assert.match(brands.slice(brands.indexOf("function BrandScopeFailure"), brands.indexOf("export async function BrandDeletionPage")), /brandActionClass/);
});
