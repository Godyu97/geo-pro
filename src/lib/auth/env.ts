import "server-only";

import { z } from "zod";

const authEnvironmentSchema = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
  BETTER_AUTH_URL: z.url().refine((value) => /^https?:\/\//.test(value)),
  BETTER_AUTH_SECRET: z.string().min(32),
});

function readAuthEnvironment() {
  return authEnvironmentSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  });
}

export function isAuthConfigured() {
  return readAuthEnvironment().success;
}

export function getAuthEnvironment() {
  const result = readAuthEnvironment();

  if (!result.success) {
    throw new Error("认证配置不完整，请检查服务端环境变量。");
  }

  return result.data;
}
