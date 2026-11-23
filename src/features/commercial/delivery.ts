export const deliveryStatuses = ["pending", "accepted", "disputed"] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];

export type DeliveryState = {
  status: DeliveryStatus;
  disputeReason: string | null;
};

export type DeliveryTransition =
  | { ok: true; state: DeliveryState }
  | { ok: false; error: "CONFLICT" };

// A new delivery waits for acceptance. Registration cannot start as accepted or disputed.
export function registerDeliveryState(): DeliveryState {
  return { status: "pending", disputeReason: null };
}

// Only a pending delivery with no dispute reason can be accepted. Acceptance clears no payment.
export function acceptDelivery(current: DeliveryState): DeliveryTransition {
  if (current.status !== "pending" || current.disputeReason !== null) return { ok: false, error: "CONFLICT" };
  return { ok: true, state: { status: "accepted", disputeReason: null } };
}

// A dispute stays on the same row. A later accept or a second dispute is not a legal transition.
export function disputeDelivery(current: DeliveryState, reason: string): DeliveryTransition {
  if (current.status !== "pending" || current.disputeReason !== null) return { ok: false, error: "CONFLICT" };
  return { ok: true, state: { status: "disputed", disputeReason: reason } };
}
