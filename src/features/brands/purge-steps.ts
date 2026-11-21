// Object deletion sits before costs so a finished receipt can remove bytes and
// still delete the brand. A historical receipt at step 3 is moved to 4.
export const brandPurgeSteps = ["contents", "exports", "objects", "costs"] as const;

export const brandPurgeIssues = [
  "contents-failed",
  "exports-failed",
  "objects-failed",
  "costs-failed",
  "unresolved-costs",
] as const;
