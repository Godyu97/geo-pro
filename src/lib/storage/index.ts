import "server-only";

export {
  DEFAULT_PRESIGN_SECONDS,
  DEFAULT_S3_ENDPOINT,
  DEFAULT_S3_REGION,
  MAX_OBJECT_BYTES,
  MAX_PRESIGN_SECONDS,
  parseStorageEnvironment,
} from "./config.ts";
export type { StorageEnvironment } from "./config.ts";
export { createObjectStorage } from "./operations.ts";
export type {
  HeadObject,
  ObjectKeyInput,
  PresignGetInput,
  PresignedGet,
  ReadObject,
  StorageErrorCode,
  StorageFailure,
  StoredObject,
  WriteCleanup,
  WriteFailure,
  WriteObjectInput,
} from "./operations.ts";
