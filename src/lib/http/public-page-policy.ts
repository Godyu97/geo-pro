import { BlockList, isIP } from "node:net";

export const PUBLIC_PAGE_LIMITS = {
  maxRedirects: 3,
  timeoutMs: 8_000,
  maxBytes: 1_048_576,
} as const;

const EXECUTABLE_INSTRUCTION =
  /(立即发布|马上发布|修改权限|grant\s+access|change\s+permission|publish\s+now|执行以下命令|run\s+this\s+command)/i;

const blockList = new BlockList();
blockList.addSubnet("0.0.0.0", 8, "ipv4");
blockList.addSubnet("10.0.0.0", 8, "ipv4");
blockList.addSubnet("100.64.0.0", 10, "ipv4");
blockList.addSubnet("127.0.0.0", 8, "ipv4");
blockList.addSubnet("169.254.0.0", 16, "ipv4");
blockList.addSubnet("172.16.0.0", 12, "ipv4");
blockList.addSubnet("192.0.0.0", 24, "ipv4");
blockList.addSubnet("192.0.2.0", 24, "ipv4");
blockList.addSubnet("192.168.0.0", 16, "ipv4");
blockList.addSubnet("198.18.0.0", 15, "ipv4");
blockList.addSubnet("198.51.100.0", 24, "ipv4");
blockList.addSubnet("203.0.113.0", 24, "ipv4");
blockList.addSubnet("224.0.0.0", 4, "ipv4");
blockList.addAddress("::", "ipv6");
blockList.addAddress("::1", "ipv6");
blockList.addSubnet("fc00::", 7, "ipv6");
blockList.addSubnet("fe80::", 10, "ipv6");
blockList.addSubnet("fec0::", 10, "ipv6");
blockList.addSubnet("ff00::", 8, "ipv6");
blockList.addSubnet("2001:db8::", 32, "ipv6");

const BLOCKED_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

export function containsExecutableInstruction(text: string) {
  return EXECUTABLE_INSTRUCTION.test(text);
}

export function parsePublicUrl(input: string): { ok: true; url: URL; hostname: string; port: number } | { ok: false } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  if (url.username || url.password) return { ok: false };
  if (url.href.length > 2000) return { ok: false };
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname.length > 253) return { ok: false };
  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false };
  return { ok: true, url, hostname, port };
}

export function isBlockedHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || BLOCKED_NAMES.has(host)) return true;
  if (isIP(host) !== 0) return false;
  if (!host.includes(".")) return true;
  return host.endsWith(".local")
    || host.endsWith(".localhost")
    || host.endsWith(".localdomain")
    || host.endsWith(".internal");
}

function ipv6Words(address: string): number[] | null {
  const bare = address.split("%")[0].toLowerCase();
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const parseSide = (part: string) => {
    if (part === "") return [] as number[];
    const groups = part.split(":");
    const words: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? "";
      if (group.includes(".")) {
        if (index !== groups.length - 1) return null;
        const pieces = group.split(".");
        if (pieces.length !== 4) return null;
        const bytes = pieces.map((item) => Number(item));
        if (bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
        words.push(((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0), ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      words.push(Number.parseInt(group, 16));
    }
    return words;
  };
  const head = parseSide(halves[0] ?? "");
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseSide(halves[1] ?? "");
  if (!tail || head.length + tail.length > 8) return null;
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function embeddedNat64(address: string) {
  const words = ipv6Words(address);
  if (!words || words.length !== 8) return null;
  const wellKnown = words[0] === 0x0064 && words[1] === 0xff9b
    && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0;
  const local = words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001;
  if (!wellKnown && !local) return null;
  const high = words[6] ?? 0;
  const low = words[7] ?? 0;
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function isLoopback(address: string, family: 4 | 6) {
  if (family === 4) return address.startsWith("127.");
  return address.toLowerCase() === "::1";
}

export function isBlockedAddress(address: string, allowLoopback = false) {
  const bare = address.split("%")[0];
  const family = isIP(bare);
  if (family !== 4 && family !== 6) return true;
  const nat64 = family === 6 ? embeddedNat64(bare) : null;
  if (nat64 && isBlockedAddress(nat64, false)) return true;
  if (allowLoopback && isLoopback(bare, family)) return false;
  return blockList.check(bare, family === 4 ? "ipv4" : "ipv6");
}

export type ClassifiedPublicPage = {
  httpStatus: number;
  title: string;
  bodyText: string;
  accessClass: "public" | "login_wall" | "draft_box" | "removed";
  robots: string | null;
  containsExecutableInstructions: boolean;
};

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function safeCodePoint(code: number) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function robotsMeta(html: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/(?:name|property)=["']robots["']/i.test(tag)) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    const cleaned = content.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 120);
    return cleaned || null;
  }
  return null;
}

function visibleText(html: string) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutNoise).replace(/\s+/g, " ").trim().slice(0, 100_000);
}

export function classifyFetchedDocument(input: {
  pathname: string;
  httpStatus: number;
  body: string;
}): ClassifiedPublicPage {
  const pathname = input.pathname.toLowerCase();
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(input.body)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const bodyText = visibleText(input.body);
  const robots = robotsMeta(input.body);
  const base = {
    httpStatus: input.httpStatus,
    title,
    bodyText,
    robots,
    containsExecutableInstructions: containsExecutableInstruction(bodyText),
  };
  if (input.httpStatus === 404 || input.httpStatus === 410) {
    return { ...base, accessClass: "removed" };
  }
  if (input.httpStatus === 401 || input.httpStatus === 403 || input.httpStatus === 402) {
    return { ...base, accessClass: "login_wall" };
  }
  const login = /<input\b[^>]*type=["']password["']/i.test(input.body)
    || /请登录后|登录后查看|登录墙|验证码|付费墙|paywall|login wall/i.test(bodyText)
    || /\/(?:login|signin|sign-in|wp-login\.php)(?:\/|$)/i.test(pathname);
  if (login) return { ...base, accessClass: "login_wall" };
  const draft = /data-page-state=["']draft["']/i.test(input.body)
    || /草稿箱|此内容为草稿|此稿为草稿|draft only/i.test(bodyText)
    || /\/(?:draft|drafts|preview)(?:\/|$)/i.test(pathname);
  if (draft) return { ...base, accessClass: "draft_box" };
  return { ...base, accessClass: "public" };
}

export function allowedDocumentType(contentType: string | null) {
  if (!contentType) return true;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "text/html" && mime !== "application/xhtml+xml" && mime !== "text/plain") return false;
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  return !charset || charset === "utf-8" || charset === "utf8" || charset === "us-ascii";
}
