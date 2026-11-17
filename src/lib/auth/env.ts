import "server-only";

import { z } from "zod";
import { parseDatabaseConfig } from "../db/config.ts";

const authEnvironmentSchema = z.object({
  BETTER_AUTH_URL: z.url().refine((value) => /^https?:\/\//.test(value)),
  BETTER_AUTH_SECRET: z.string().min(32),
});

function readAuthEnvironment() {
  return authEnvironmentSchema.safeParse({
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  });
}

export function isAuthConfigured() {
  return readAuthEnvironment().success && parseDatabaseConfig(process.env).success;
}

export function getAuthEnvironment() {
  const result = readAuthEnvironment();
  const database = parseDatabaseConfig(process.env);

  if (!result.success || !database.success) {
    throw new Error("认证配置不完整，请检查服务端环境变量。");
  }

  return { ...result.data, ...database.data };
}
