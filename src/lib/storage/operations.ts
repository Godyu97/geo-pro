import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import {
  DEFAULT_PRESIGN_SECONDS,
  MAX_OBJECT_BYTES,
  MAX_PRESIGN_SECONDS,
  parseStorageEnvironment,
  type StorageEnvironment,
} from "./config.ts";

export type StorageErrorCode = "config" | "rejected" | "unavailable" | "mismatch";

export type StorageFailure = {
  ok: false;
  status: "failed";
  code: StorageErrorCode;
};

export type WriteCleanup = "not-stored" | "deleted" | "pending";

export type WriteFailure = StorageFailure & {
  cleanup: WriteCleanup;
};

export type StoredObject = {
  ok: true;
  status: "ready";
  bucket: string;
  key: string;
  byteSize: number;
  sha256: string;
  contentType: string;
};

export type ReadObject = {
  ok: true;
  body: Uint8Array;
  byteSize: number;
  sha256: string;
  contentType?: string;
};

export type HeadObject = {
  ok: true;
  byteSize: number;
  contentType?: string;
};

export type PresignedGet = {
  ok: true;
  url: string;
  expiresInSeconds: number;
};

export type WriteObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type ObjectKeyInput = {
  key: string;
};

export type PresignGetInput = {
  key: string;
  contentType: string;
  fileName: string;
  expiresInSeconds?: number;
};

type RequestHandlerInput = S3ClientConfig["requestHandler"];

const objectKeySchema = z.string().min(1).max(1024).refine((key) => {
  if (key.startsWith("/") || key.includes("\\") || key.includes("//") || key.includes("?") || key.includes("#")) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  return key.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
});

const contentTypeSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}$/,
);

function failed(code: StorageErrorCode): StorageFailure {
  return { ok: false, status: "failed", code };
}

function writeFailed(code: StorageErrorCode, cleanup: WriteCleanup): WriteFailure {
  return { ok: false, status: "failed", code, cleanup };
}

function ignoreLog(...content: unknown[]) {
  void content;
}

const silentLogger = {
  debug: ignoreLog,
  info: ignoreLog,
  warn: ignoreLog,
  error: ignoreLog,
};

function resolveRequestHandler(override: RequestHandlerInput): RequestHandlerInput {
  const timeout = {
    requestTimeout: 10_000,
    throwOnRequestTimeout: true,
  };
  if (override && typeof override === "object" && "handle" in override && typeof override.handle === "function") {
    return override;
  }
  if (override && typeof override === "object") {
    return { ...timeout, ...override };
  }
  return timeout;
}

function openClient(endpoint: string, config: StorageEnvironment, requestHandler: RequestHandlerInput) {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 1,
    logger: silentLogger,
    requestHandler: resolveRequestHandler(requestHandler),
  });
}

async function withClient<T>(
  endpoint: string,
  config: StorageEnvironment,
  requestHandler: RequestHandlerInput,
  work: (client: S3Client) => Promise<T>,
) {
  const client = openClient(endpoint, config, requestHandler);
  try {
    return await work(client);
  } finally {
    client.destroy();
  }
}

function httpStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return undefined;
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function classifyStatus(status: number | undefined): "rejected" | "unavailable" {
  if (status === undefined || status >= 500) return "unavailable";
  return "rejected";
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function hasByteReader(body: unknown): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return typeof body === "object"
    && body !== null
    && "transformToByteArray" in body
    && typeof body.transformToByteArray === "function";
}

async function readPayload(body: unknown) {
  if (!hasByteReader(body)) return undefined;
  const bytes = await body.transformToByteArray();
  return bytes instanceof Uint8Array ? bytes : undefined;
}

function resolveExpires(value: number | undefined) {
  if (value === undefined) return DEFAULT_PRESIGN_SECONDS;
  const parsed = z.number().int().min(1).max(MAX_PRESIGN_SECONDS).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function sanitizeFileName(value: string) {
  const base = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const cleaned = base.replaceAll("..", "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length < 1 || cleaned.length > 120 || cleaned === ".") return undefined;
  return cleaned;
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createObjectStorage(options: {
  env?: Record<string, string | undefined>;
  requestHandler?: RequestHandlerInput;
} = {}) {
  const parsed = parseStorageEnvironment(options.env ?? process.env);
  const requestHandler = options.requestHandler;

  async function deleteQuiet(client: S3Client, bucket: string, key: string): Promise<WriteCleanup> {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return "deleted";
    } catch (error) {
      return httpStatus(error) === 404 ? "deleted" : "pending";
    }
  }

  return {
    async putAndReadBack(input: WriteObjectInput): Promise<StoredObject | WriteFailure> {
      if (!parsed.success) return writeFailed("config", "not-stored");
      const key = objectKeySchema.safeParse(input.key);
      const contentType = contentTypeSchema.safeParse(input.contentType);
      if (!key.success || !contentType.success || !(input.body instanceof Uint8Array)) {
        return writeFailed("rejected", "not-stored");
      }
      if (input.body.byteLength < 1 || input.body.byteLength > MAX_OBJECT_BYTES) {
        return writeFailed("rejected", "not-stored");
      }
      const payload = Buffer.from(input.body);
      const digest = sha256Hex(payload);
      const config = parsed.data;
      return withClient(config.endpoint, config, requestHandler, async (client) => {
        try {
          await client.send(new PutObjectCommand({
            Bucket: config.bucket,
            Key: key.data,
            Body: payload,
            ContentType: contentType.data,
            ContentLength: payload.byteLength,
          }));
        } catch (error) {
          return writeFailed(classifyStatus(httpStatus(error)), await deleteQuiet(client, config.bucket, key.data));
        }

        try {
          const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key.data }));
          const actual = await readPayload(response.Body);
          if (!actual || !sameBytes(payload, actual) || sha256Hex(actual) !== digest) {
            return writeFailed("mismatch", await deleteQuiet(client, config.bucket, key.data));
          }
          return {
            ok: true as const,
            status: "ready" as const,
            bucket: config.bucket,
            key: key.data,
            byteSize: payload.byteLength,
            sha256: digest,
            contentType: contentType.data,
          };
        } catch (error) {
          return writeFailed(classifyStatus(httpStatus(error)), await deleteQuiet(client, config.bucket, key.data));
        }
      });
    },

    async getObject(input: ObjectKeyInput): Promise<ReadObject | StorageFailure> {
      if (!parsed.success) return failed("config");
      const key = objectKeySchema.safeParse(input.key);
      if (!key.success) return failed("rejected");
      const config = parsed.data;
      return withClient(config.endpoint, config, requestHandler, async (client) => {
        try {
          const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key.data }));
          const body = await readPayload(response.Body);
          if (!body || body.byteLength < 1) return failed("rejected");
          const contentType = typeof response.ContentType === "string" ? response.ContentType : undefined;
          return {
            ok: true as const,
            body,
            byteSize: body.byteLength,
            sha256: sha256Hex(body),
            contentType,
          };
        } catch (error) {
          return failed(classifyStatus(httpStatus(error)));
        }
      });
    },

    async headObject(input: ObjectKeyInput): Promise<HeadObject | StorageFailure> {
      if (!parsed.success) return failed("config");
      const key = objectKeySchema.safeParse(input.key);
      if (!key.success) return failed("rejected");
      const config = parsed.data;
      return withClient(config.endpoint, config, requestHandler, async (client) => {
        try {
          const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key.data }));
          if (typeof response.ContentLength !== "number" || response.ContentLength < 1) return failed("rejected");
          const contentType = typeof response.ContentType === "string" ? response.ContentType : undefined;
          return { ok: true as const, byteSize: response.ContentLength, contentType };
        } catch (error) {
          return failed(classifyStatus(httpStatus(error)));
        }
      });
    },

    async deleteObject(input: ObjectKeyInput): Promise<{ ok: true } | StorageFailure> {
      if (!parsed.success) return failed("config");
      const key = objectKeySchema.safeParse(input.key);
      if (!key.success) return failed("rejected");
      const config = parsed.data;
      return withClient(config.endpoint, config, requestHandler, async (client) => {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key.data }));
          return { ok: true as const };
        } catch (error) {
          if (httpStatus(error) === 404) return { ok: true as const };
          return failed(classifyStatus(httpStatus(error)));
        }
      });
    },

    async presignGet(input: PresignGetInput): Promise<PresignedGet | StorageFailure> {
      if (!parsed.success || parsed.data.browserEndpointInvalid || !parsed.data.browserEndpoint) {
        return failed("config");
      }
      const key = objectKeySchema.safeParse(input.key);
      const contentType = contentTypeSchema.safeParse(input.contentType);
      const fileName = sanitizeFileName(input.fileName);
      const expiresInSeconds = resolveExpires(input.expiresInSeconds);
      if (!key.success || !contentType.success || !fileName || expiresInSeconds === undefined) {
        return failed("rejected");
      }
      const config = parsed.data;
      const endpoint = config.browserEndpoint;
      if (!endpoint) return failed("config");
      return withClient(endpoint, config, undefined, async (client) => {
        try {
          const url = await getSignedUrl(client, new GetObjectCommand({
            Bucket: config.bucket,
            Key: key.data,
            ResponseContentType: contentType.data,
            ResponseContentDisposition: contentDisposition(fileName),
          }), { expiresIn: expiresInSeconds });
          if (!URL.parse(url)) return failed("rejected");
          return { ok: true as const, url, expiresInSeconds };
        } catch {
          return failed("rejected");
        }
      });
    },
  };
}
