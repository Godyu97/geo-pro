const mobile = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const international = /(?<!\d)\+\d{8,15}(?!\d)/;
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export type LeadSuggestionQuestion = { text: string; frozen: false };

export function containsDirectIdentifier(value: string) {
  return mobile.test(value) || international.test(value) || email.test(value);
}

export function summaryAsksToIgnore(value: string) {
  const folded = value.toLowerCase();
  return value.includes("忽略规则") || value.includes("冻结题集") || folded.includes("ignore the rules");
}

function requestedChange(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function compact(value: string) {
  return value.replace(/\s+/g, "");
}

export function echoesSummary(question: string, summary: string) {
  const left = compact(question);
  const right = compact(summary);
  if (left.length < 12 || right.length < 12) return false;
  return right.includes(left) || left.includes(right);
}

function readQuestion(value: unknown, summary: string): { text: string } | { drop: "invalid" | "blocked" } {
  if (!value || Array.isArray(value) || typeof value !== "object") return { drop: "invalid" };
  const record = value as Record<string, unknown>;
  if (requestedChange(record.freeze) || requestedChange(record.publish) || record.frozen !== false) {
    return { drop: "blocked" };
  }
  if (typeof record.text !== "string") return { drop: "invalid" };
  const text = record.text.trim();
  const length = [...text].length;
  if (length < 8 || length > 180 || !text.isWellFormed() || text.includes("\0")) return { drop: "invalid" };
  if (containsDirectIdentifier(text) || summaryAsksToIgnore(text) || echoesSummary(text, summary)) {
    return { drop: "blocked" };
  }
  return { text };
}

export function parseLeadSuggestions(outputText: string, summary: string): {
  questions: LeadSuggestionQuestion[];
  modelAskedToChange: boolean;
} | null {
  let payload: unknown;
  try {
    payload = JSON.parse(outputText);
  } catch {
    return null;
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.questions)) return null;
  if (requestedChange(record.freeze) || requestedChange(record.publish)) {
    return { questions: [], modelAskedToChange: true };
  }
  const questions: LeadSuggestionQuestion[] = [];
  let modelAskedToChange = false;
  for (const item of record.questions) {
    const read = readQuestion(item, summary);
    if ("drop" in read) {
      if (read.drop === "blocked") modelAskedToChange = true;
      continue;
    }
    questions.push({ text: read.text, frozen: false });
  }
  return { questions: questions.slice(0, 3), modelAskedToChange };
}
