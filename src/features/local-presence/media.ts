/** A picture whose text disagrees with the approved fact cannot be delivered as public proof. */
export function reviewMedia(input: {
  shownValue: string;
  approvedValue: string;
  factVersion: number;
  presentedAsCustomerProof: boolean;
}) {
  const matches = input.shownValue === input.approvedValue;
  return {
    deliver: matches && !input.presentedAsCustomerProof,
    factVersion: input.factVersion,
    reason: input.presentedAsCustomerProof ? "not_proof" as const : matches ? "ok" as const : "fact_mismatch" as const,
  };
}
