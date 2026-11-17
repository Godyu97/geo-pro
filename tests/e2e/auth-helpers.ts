import { expect, type APIResponse, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { setTimeout } from "node:timers/promises";

async function waitForAuthRetry(response: APIResponse | Response) {
  const retryAfter = Number(response.headers()["retry-after"] ?? response.headers()["x-retry-after"]);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(10);
  await setTimeout((retryAfter + 1) * 1000);
}

export async function registerTestAccount(
  context: BrowserContext,
  account: { name: string; email: string; password: string },
) {
  const register = () => context.request.post("/api/auth/sign-up/email", {
    headers: { Origin: "http://localhost:3100" }, data: account,
  });
  let response = await register();
  // Keep the real production limit. Only a definite 429 during disposable
  // account provisioning is retried, never an unknown write outcome.
  if (response.status() === 429) {
    await waitForAuthRetry(response);
    response = await register();
  }
  return response;
}

export async function submitTestAccountForm(
  page: Page,
  button: Locator,
  endpoint: "/api/auth/sign-up/email" | "/api/auth/sign-in/email",
) {
  const submit = async () => {
    const submitted = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === "POST");
    await button.click();
    return submitted;
  };
  let response = await submit();
  // A definite rejection can be retried through the UI without replaying an
  // unknown outcome or weakening the production limit for the test suite.
  if (response.status() === 429) {
    await expect(button).toBeEnabled();
    await waitForAuthRetry(response);
    response = await submit();
  }
  return response;
}
