import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkMessages, validateCatalogs } from "../../scripts/check-i18n.mjs";
import { resolveLocale } from "../../src/lib/i18n/locale.ts";
import { createTranslator } from "../../src/lib/i18n/translate.ts";
import { formatCount, formatDateTime, formatMoney, formatNumber, formatPercent } from "../../src/lib/i18n/format.ts";
import { loginPath, safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { signUpSchema } from "../../src/lib/auth/validation.ts";

test("saved preferences take priority; invalid and unsupported locales safely fall back", () => {
  assert.equal(resolveLocale(), "zh-CN");
  assert.equal(resolveLocale(undefined, "en-US,en;q=0.9,zh-CN;q=0.5"), "en");
  assert.equal(resolveLocale(undefined, "fr-FR,zh-Hans;q=0.8,en;q=0.7"), "zh-CN");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  for (const invalid of ["fr", "EN", "", "../en", "<script>"]) {
    assert.equal(resolveLocale(invalid, "en-US"), "zh-CN");
  }
  for (const header of ["fr-FR", "en;q=0,zh-CN;q=0", "en;q=2", "en;q=bad", "*"]) {
    assert.equal(resolveLocale(undefined, header), "zh-CN");
  }
});

test("both catalogs are complete; missing / extra / empty keys and parameter drift fail", async () => {
  assert.ok(await checkMessages() > 100);
  const sample = { "zh-CN": { greeting: "你好，{name}" }, en: { greeting: "Hello, {name}" } };
  assert.equal(validateCatalogs(sample), 1);
  for (const en of [{}, { greeting: "" }, { greeting: "Hello, {user}" }, { greeting: "Hello, {name}", extra: "Extra" }]) {
    assert.throws(() => validateCatalogs({ ...sample, en }));
  }
});

test("runtime failures log only key and locale and return a safe message", (context) => {
  const log = context.mock.method(console, "error", () => {});
  const t = createTranslator("en", { greeting: "Hello, {name}" });
  assert.equal(t("greeting", { name: "品牌 <script>" }), "Hello, 品牌 <script>");
  assert.equal(t("greeting"), "This content is temporarily unavailable. Please try again.");
  assert.equal(t("missing"), "This content is temporarily unavailable. Please try again.");
  assert.equal(log.mock.callCount(), 2);
  assert.equal(JSON.stringify(log.mock.calls).includes("<script>"), false);
  assert.equal(createTranslator("en", {}, { greeting: "你好，{name}" })("greeting", { name: "Geo" }), "你好，Geo");
});

test("formatting keeps CNY, precision, absolute time and Shanghai day boundaries", () => {
  for (const locale of ["zh-CN", "en"]) {
    assert.equal(formatNumber(locale, 1234.5), "1,234.5");
    assert.equal(formatPercent(locale, 0.1234), "12.3%");
    assert.match(formatMoney(locale, 123.45, "CNY"), /123\.45/);
    assert.doesNotMatch(formatMoney(locale, 123.45, "CNY"), /US\$/);
    assert.match(formatDateTime(locale, new Date("2026-11-17T16:30:00Z")), /18/);
    assert.match(formatDateTime(locale, new Date("2026-11-17T16:30:00Z")), /00:30/);
  }
  assert.deepEqual([0, 1, 2].map((n) => formatCount("en", n, { one: "{count} answer", other: "{count} answers" })), ["0 answers", "1 answer", "2 answers"]);
  assert.equal(formatCount("zh-CN", 1, { one: "{count} 条回答", other: "{count} 条回答" }), "1 条回答");
});

test("validation emits stable codes and keeps mixed Unicode names intact", async () => {
  const input = { name: "品牌🚀 Brand É", email: "unicode@example.invalid", password: "test-password-only" };
  assert.equal(signUpSchema.parse(input).name, input.name);
  assert.equal(signUpSchema.safeParse({ ...input, name: "🚀".repeat(80) }).success, true);
  assert.equal(signUpSchema.safeParse({ ...input, name: "🚀".repeat(81) }).success, false);
  const result = signUpSchema.safeParse({ name: "", email: "invalid", password: "short" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue) => issue.message).sort(), ["emailInvalid", "nameRequired", "passwordMin"]);
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.equal(en.dashboard.greeting, "Hello, {name}");
});

test("login return targets preserve local filters and reject external or malformed paths", () => {
  for (const value of [null, [], "https://evil.invalid", "//evil.invalid", "/login", "/dashboard/../login", "/dashboard\\evil", "/dashboard\n", "/dashboard\x7f", "/dashboard/%2e%2e/login", "/dashboard%2f%2fevil.invalid", "/dashboard?x=" + "a".repeat(2048)]) {
    assert.equal(safeReturnTo(value), "/dashboard");
  }
  assert.equal(safeReturnTo("/dashboard?filter=品牌#monitoring"), "/dashboard?filter=%E5%93%81%E7%89%8C#monitoring");
  const login = new URL(loginPath("/dashboard?filter=品牌&reason=external#monitoring", "session-required"), "https://local.invalid");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("reason"), "session-required");
  assert.equal(login.searchParams.get("returnTo"), "/dashboard?filter=%E5%93%81%E7%89%8C&reason=external#monitoring");
  assert.equal(new URL(loginPath("//evil.invalid", "unavailable"), login).searchParams.get("returnTo"), "/dashboard");
});
