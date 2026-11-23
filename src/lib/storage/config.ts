import "server-only";

import { z } from "zod";

export const DEFAULT_PRESIGN_SECONDS = 300;
export const MAX_PRESIGN_SECONDS = 900;
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

const credentialSchema = z.string().min(1).max(256).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

function trimToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isHttpEndpoint(value: string) {
  const parsed = URL.parse(value);
  return Boolean(
    parsed &&
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash,
  );
}

const storageEnvironmentSchema = z.object({
  endpoint: z.string().refine(isHttpEndpoint),
  browserEndpoint: z.string().refine(isHttpEndpoint).optional(),
  region: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  accessKeyId: credentialSchema,
  secretAccessKey: credentialSchema,
  forcePathStyle: z.boolean(),
});

export type StorageEnvironment = z.infer<typeof storageEnvironmentSchema> & {
  browserEndpointInvalid: boolean;
};

export function parseStorageEnvironment(env: Record<string, string | undefined> = process.env) {
  const browserRaw = trimToUndefined(env.S3_ENDPOINT_BROWSER);
  const browserEndpoint = browserRaw && isHttpEndpoint(browserRaw) ? browserRaw : undefined;
  const parsed = storageEnvironmentSchema.safeParse({
    endpoint: trimToUndefined(env.S3_ENDPOINT),
    browserEndpoint,
    region: trimToUndefined(env.S3_REGION),
    bucket: trimToUndefined(env.S3_BUCKET),
    accessKeyId: trimToUndefined(env.S3_ACCESS_KEY_ID),
    secretAccessKey: trimToUndefined(env.S3_SECRET_ACCESS_KEY),
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
  });
  if (!parsed.success) return { success: false as const };
  return {
    success: true as const,
    data: {
      ...parsed.data,
      browserEndpointInvalid: Boolean(browserRaw) && browserEndpoint === undefined,
    },
  };
}
