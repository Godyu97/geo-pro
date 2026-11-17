import "server-only";

import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { isDisplayNameError, profileSessionHeader, profileUpdateSchema } from "./profile";

export const beforeProfileUpdate = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/update-user") return;

  const update = profileUpdateSchema.safeParse(ctx.body);
  if (!update.success) {
    const issue = update.error.issues[0]?.message;
    throw APIError.from("BAD_REQUEST", {
      code: isDisplayNameError(issue) ? issue : "INVALID_PROFILE_INPUT",
      message: "Invalid profile update",
    });
  }

  const pageUser = ctx.headers?.get(profileSessionHeader);
  if (pageUser !== undefined && pageUser !== null) {
    // Better Auth's endpoint still requires its own session and writes to that user.
    const session = await getSessionFromCtx(ctx);
    if (session && session.user.id !== pageUser) {
      throw APIError.from("CONFLICT", {
        code: "PROFILE_SESSION_CHANGED",
        message: "Account session changed",
      });
    }
  }

  return { context: { body: update.data } };
});
