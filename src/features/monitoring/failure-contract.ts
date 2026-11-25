import {
  attemptDispositions,
  attemptKinds,
  monitoringErrors,
  monitoringNextSteps,
  type MonitoringError,
  type MonitoringNextStep,
} from "./contracts.ts";

type SamplingCostState = "none" | "pending" | "known" | "unknown";

export type SamplingAttemptFact = {
  slotId: string;
  kind: (typeof attemptKinds)[number];
  disposition: (typeof attemptDispositions)[number];
  costState: SamplingCostState;
  ordinal: number;
};

export const monitoringFailureStepKeys = [
  "nextStepAdjustScope",
  "nextStepRefreshPreview",
  "nextStepVerifyEmail",
  "nextStepVerifyChannel",
  "nextStepConfirmCeiling",
  "nextStepRequestQuota",
  "nextStepAddPrimary",
  "nextStepAwaitChannel",
  "nextStepSignIn",
  "nextStepForbidden",
  "nextStepNotFound",
  "nextStepReview",
  "nextStepRetryLater",
  "nextStepReconcileCost",
  "nextStepRetrySafe",
  "nextStepRetryLimit",
] as const;
export type MonitoringFailureStepKey = (typeof monitoringFailureStepKeys)[number];

const nextKey: Record<MonitoringNextStep, MonitoringFailureStepKey> = {
  "adjust-scope": "nextStepAdjustScope",
  "refresh-preview": "nextStepRefreshPreview",
  "verify-email": "nextStepVerifyEmail",
  "verify-channel": "nextStepVerifyChannel",
  "confirm-ceiling": "nextStepConfirmCeiling",
  "request-quota": "nextStepRequestQuota",
  "add-primary": "nextStepAddPrimary",
  "await-channel": "nextStepAwaitChannel",
};

const codeKey: Record<MonitoringError, MonitoringFailureStepKey> = {
  SESSION_REQUIRED: "nextStepSignIn",
  FORBIDDEN: "nextStepForbidden",
  NOT_FOUND: "nextStepNotFound",
  INVALID_INPUT: "nextStepReview",
  OPERATION_CONFLICT: "nextStepReview",
  CHANNEL_UNVERIFIED: "nextStepVerifyChannel",
  PREVIEW_EXPIRED: "nextStepRefreshPreview",
  VERSION_CONFLICT: "nextStepRefreshPreview",
  QUOTA_INSUFFICIENT: "nextStepAdjustScope",
  NO_TRUSTED_CEILING: "nextStepConfirmCeiling",
  NETWORK_REQUIRED: "nextStepReview",
  EMAIL_UNVERIFIED: "nextStepVerifyEmail",
  NOT_READY: "nextStepAddPrimary",
  NOT_ENTITLED: "nextStepRequestQuota",
  REAL_CHANNEL_CLOSED: "nextStepAwaitChannel",
  SERVICE_UNAVAILABLE: "nextStepRetryLater",
};

const nextStepSet = new Set<string>(monitoringNextSteps);

export function isMonitoringNextStep(value: string | null | undefined): value is MonitoringNextStep {
  return typeof value === "string" && nextStepSet.has(value);
}

export function needsCostReconciliation(attempts: readonly SamplingAttemptFact[]) {
  return attempts.some((attempt) => attempt.kind === "sampling" && (
    attempt.disposition === "pending"
    || attempt.disposition === "unknown"
    || attempt.costState === "pending"
    || attempt.costState === "unknown"
  ));
}

function retryState(attempts: readonly SamplingAttemptFact[]) {
  const bySlot = new Map<string, SamplingAttemptFact[]>();
  for (const attempt of attempts) {
    if (attempt.kind !== "sampling") continue;
    const list = bySlot.get(attempt.slotId) ?? [];
    list.push(attempt);
    bySlot.set(attempt.slotId, list);
  }
  let room = false;
  let limit = false;
  for (const list of bySlot.values()) {
    const safe = list.filter((attempt) => attempt.disposition === "safe_failure"
      && attempt.costState !== "pending" && attempt.costState !== "unknown");
    if (!safe.length) continue;
    if (safe.length >= 3) limit = true;
    else room = true;
  }
  if (room) return "room" as const;
  if (limit) return "limit" as const;
  return "none" as const;
}

export function monitoringFailureContract(input: {
  code: MonitoringError;
  next: MonitoringNextStep | null;
  attempts?: readonly SamplingAttemptFact[];
  costUnreadable?: boolean;
}) {
  const attempts = input.attempts ?? [];
  if (input.costUnreadable || needsCostReconciliation(attempts)) {
    return {
      retryable: false,
      nextStepKeys: ["nextStepReconcileCost"] as const,
      externalCostPossible: true,
    };
  }
  const retry = retryState(attempts);
  if (retry === "limit") {
    return {
      retryable: false,
      nextStepKeys: ["nextStepRetryLimit"] as const,
      externalCostPossible: false,
    };
  }
  const primary = (input.next && nextKey[input.next]) || codeKey[input.code];
  const retryable = input.code === "SERVICE_UNAVAILABLE";
  if (retry === "room") {
    const nextStepKeys = primary === "nextStepRetryLater" || primary === "nextStepRetrySafe"
      ? ["nextStepRetrySafe"] as const
      : [primary, "nextStepRetrySafe"] as const;
    return { retryable, nextStepKeys, externalCostPossible: false };
  }
  return { retryable, nextStepKeys: [primary] as const, externalCostPossible: false };
}

export function monitoringFailureBody(input: {
  code: MonitoringError;
  message: string;
  next: MonitoringNextStep | null;
  translate: (key: MonitoringFailureStepKey) => string;
  attempts?: readonly SamplingAttemptFact[];
  costUnreadable?: boolean;
  traceId?: string;
}) {
  const contract = monitoringFailureContract(input);
  const nextStep = contract.nextStepKeys.map((key) => input.translate(key)).join(" ");
  const next = contract.externalCostPossible ? "reconcile-cost"
    : contract.nextStepKeys[0] === "nextStepRetryLimit" ? "retry-limit"
      : input.next;
  return {
    status: monitoringErrors[input.code],
    body: {
      error: {
        code: input.code,
        message: input.message,
        retryable: contract.retryable,
        nextStep,
        externalCostPossible: contract.externalCostPossible,
      },
      next,
      traceId: input.traceId,
    },
  };
}

export function monitoringSuccessCostNotice(
  attempts: readonly SamplingAttemptFact[],
  translate: (key: "nextStepReconcileCost") => string,
) {
  if (!needsCostReconciliation(attempts)) return null;
  return {
    retryable: false as const,
    nextStep: translate("nextStepReconcileCost"),
    externalCostPossible: true as const,
  };
}

export function samplingCostMessageKey(costState: SamplingCostState, actualMinor: number | null) {
  if (costState === "pending") return "costPending" as const;
  if (costState === "unknown") return "actualUnknown" as const;
  if (costState === "none" || actualMinor === null) return costState === "none" ? "costNone" as const : "actualUnknown" as const;
  return "costKnown" as const;
}
