import { createHash } from "node:crypto";

// The fingerprint covers only the frozen sampling fields. Brand facts and run network state stay out.
export function samplingProtocolFingerprint(fields: {
  newSessionRequired: 0 | 1 | boolean;
  searchRequired: 0 | 1 | boolean;
  targetRegion: string;
  timezone: string;
}) {
  const newSessionRequired = fields.newSessionRequired === true || fields.newSessionRequired === 1 ? 1 : 0;
  const searchRequired = fields.searchRequired === true || fields.searchRequired === 1 ? 1 : 0;
  return createHash("sha256").update(JSON.stringify({
    newSessionRequired,
    searchRequired,
    targetRegion: fields.targetRegion,
    timezone: fields.timezone,
  })).digest("hex");
}
