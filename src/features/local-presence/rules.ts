/** The asked city and the sampled place stay separate. Unknown sampling is not a local ranking. */
export function localObservation(input: { targetCity: string; sampledCity: string | null }) {
  return {
    targetCity: input.targetCity,
    sampledCity: input.sampledCity,
    ranked: false,
    claimedLocalUsers: false,
  };
}

export function storeFacts(input: { storeId: string; serviceArea: string; otherStoreArea: string | null }) {
  return {
    storeId: input.storeId,
    serviceArea: input.serviceArea,
    usedOtherStore: false,
    otherStoreArea: input.otherStoreArea,
  };
}
