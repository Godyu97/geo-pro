export type CaptureBlock = "captcha" | "login" | null;

/** A login wall or captcha stops the helper. Missing citations stay partial instead of complete. */
export function assistedCapture(input: { blockedBy: CaptureBlock; citationCount: number }) {
  if (input.blockedBy) {
    return { status: "handoff" as const, bypass: false, complete: false, silentEmptyCitations: false };
  }
  if (input.citationCount <= 0) {
    return { status: "partial" as const, bypass: false, complete: false, silentEmptyCitations: false };
  }
  return { status: "preview" as const, bypass: false, complete: false, silentEmptyCitations: false };
}

export function confirmCapture(status: "handoff" | "partial" | "preview", confirmed: boolean) {
  if (!confirmed || status === "handoff") return { saved: false as const, complete: false };
  return { saved: true as const, complete: status === "preview" };
}
