import type { BrandErrorCode, BrandFieldName } from "./contracts";

export const brandErrorMessage = {
  SESSION_REQUIRED: "sessionRequired",
  SESSION_CHANGED: "sessionChanged",
  NOT_FOUND: "notFound",
  LIMIT_REACHED: "limitReached",
  VERSION_CONFLICT: "versionConflict",
  OPERATION_CONFLICT: "operationConflict",
  INTAKE_CLOSED: "closedDescription",
  INVALID_INPUT: "invalidInput",
  FORBIDDEN: "forbidden",
  SERVICE_UNAVAILABLE: "unavailable",
} as const satisfies Record<BrandErrorCode, string>;

export const brandFieldMessage = {
  name: "invalidName",
  description: "invalidDescription",
  website: "invalidWebsite",
  aliases: "invalidAliases",
  region: "invalidRegion",
  language: "invalidLanguage",
  competitors: "invalidCompetitors",
  questions: "invalidQuestions",
} as const satisfies Record<BrandFieldName, string>;
