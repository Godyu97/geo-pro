import { expect, type BrowserContext } from "@playwright/test";
import { setTimeout } from "node:timers/promises";

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
    const retryAfter = Number(response.headers()["retry-after"] ?? response.headers()["x-retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(10);
    await setTimeout((retryAfter + 1) * 1000);
    response = await register();
  }
  return response;
}
