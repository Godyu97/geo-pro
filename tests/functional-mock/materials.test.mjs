import assert from "node:assert/strict";
import { test } from "node:test";
import { factGaps } from "../../src/features/brand-facts/rules.ts";
import { brandMaterialOrigin } from "../../src/features/brands/intake.ts";
import { mockBrandFields } from "../../src/features/functional-mock/brand-profile.ts";
import { mockFactFields, mockPromptContent } from "../../src/features/functional-mock/materials.ts";
import { termList, validateDraft } from "../../src/features/prompts/rules.ts";

test("mock facts and prompt sets pass the existing rules and stay labeled", () => {
  const fields = mockFactFields("2026-01-15");
  assert.deepEqual(factGaps(fields, "2026-11-21"), []);
  assert.match(fields.claim, /FUNCTIONAL-MOCK/);

  const content = mockPromptContent();
  const frozen = validateDraft(content, termList(mockBrandFields), [], "freeze");
  assert.equal("error" in frozen, false);
  if (!("error" in frozen)) assert.ok(frozen.preview.primary >= 3);
  assert.ok(content.questions.every((question) => question.text.includes("[FUNCTIONAL-MOCK]")));

  const headers = { get: (name) => (name === "host" ? "localhost:3000" : null) };
  assert.equal(brandMaterialOrigin(headers, { GEO_FUNCTIONAL_MOCK: "1", BETTER_AUTH_URL: "http://localhost:3000" }), "http://localhost:3000");
  assert.equal(brandMaterialOrigin(headers, { BETTER_AUTH_URL: "http://localhost:3000" }), null);
});
