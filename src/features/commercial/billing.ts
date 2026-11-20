export type OrderState = "draft" | "quoted" | "awaiting_payment" | "paid";

/** A quote without a payment connector stays unpaid. White-label copies keep sample limits. */
export function recordOrder(input: { paymentConnected: boolean; quoted: boolean }) {
  if (!input.paymentConnected) {
    return { state: input.quoted ? "awaiting_payment" as const : "draft" as const, paid: false };
  }
  return { state: "quoted" as const, paid: false };
}

export function whitelabelReport(input: {
  track: string;
  sampleSize: number;
  grade: string;
}) {
  return {
    track: input.track,
    sampleSize: input.sampleSize,
    grade: input.grade,
    guaranteeRemoved: false,
  };
}
