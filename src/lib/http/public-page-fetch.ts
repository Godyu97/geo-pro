import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  PUBLIC_PAGE_LIMITS,
  allowedDocumentType,
  classifyFetchedDocument,
  isBlockedAddress,
  isBlockedHostname,
  parsePublicUrl,
  type ClassifiedPublicPage,
} from "./public-page-policy.ts";

export type PublicPageBlockCode =
  | "unsupported_url"
  | "blocked_non_public_address"
  | "too_many_redirects"
  | "response_too_large"
  | "timeout"
  | "fetch_error"
  | "unsupported_content"
  | "name_not_resolved";

export type PublicPageFetchOutcome =
  | ({ ok: true } & ClassifiedPublicPage)
  | { ok: false; code: PublicPageBlockCode };

export type PublicPageFetcher = (url: string) => Promise<PublicPageFetchOutcome>;

export type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

type FetchOptions = {
  allowLoopback?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
};

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export function isPublicPageFetchEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.GEO_PUBLIC_PAGE_FETCH?.trim().toLowerCase() === "true";
}

async function defaultResolveHost(hostname: string) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 as const : 4 as const,
  }));
}

function singleHeader(response: IncomingMessage, name: string) {
  const value = response.headers[name];
  if (Array.isArray(value)) return null;
  return value ?? null;
}

function isTimeout(error: unknown, deadline: AbortSignal) {
  if (deadline.aborted) return true;
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function pinAddress(hostname: string, allowLoopback: boolean, resolveHost: ResolveHost) {
  if (isBlockedHostname(hostname)) return { ok: false as const, code: "blocked_non_public_address" as const };
  const literal = isIP(hostname);
  const records = literal === 0
    ? await resolveHost(hostname)
    : [{ address: hostname, family: literal as 4 | 6 }];
  if (records.length === 0) return { ok: false as const, code: "name_not_resolved" as const };
  if (records.some((record) => isBlockedAddress(record.address, allowLoopback))) {
    return { ok: false as const, code: "blocked_non_public_address" as const };
  }
  const selected = records[0];
  if (!selected) return { ok: false as const, code: "name_not_resolved" as const };
  return { ok: true as const, address: selected.address, family: selected.family };
}

function requestOnce(
  target: { protocol: string; hostname: string; port: number; pathname: string; search: string },
  pinned: { address: string; family: 4 | 6 },
  deadline: AbortSignal,
) {
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<IncomingMessage>((resolve, reject) => {
    if (deadline.aborted) {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      reject(error);
      return;
    }
    const req = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname || "/"}${target.search}`,
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        "Accept-Language": "zh-CN,en;q=0.8",
        "Cache-Control": "no-cache",
        "User-Agent": "GeoProPublicPageCheck/1.0",
      },
      servername: target.hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
          return;
        }
        callback(null, pinned.address, pinned.family);
      },
      rejectUnauthorized: true,
    }, (response) => {
      deadline.removeEventListener("abort", onAbort);
      resolve(response);
    });
    const onAbort = () => {
      req.destroy();
    };
    deadline.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => {
      deadline.removeEventListener("abort", onAbort);
      reject(error);
    });
    req.end();
  });
}

function readBody(response: IncomingMessage, maxBytes: number, deadline: AbortSignal) {
  const declared = singleHeader(response, "content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    response.destroy();
    return Promise.resolve("too_large" as const);
  }
  return new Promise<string | "too_large" | "timeout" | "fetch_error">((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: string | "too_large" | "timeout" | "fetch_error") => {
      if (settled) return;
      settled = true;
      deadline.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      response.destroy();
      finish("timeout");
    };
    if (deadline.aborted) {
      response.destroy();
      finish("timeout");
      return;
    }
    deadline.addEventListener("abort", onAbort, { once: true });
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        finish("too_large");
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      finish(Buffer.concat(chunks).toString("utf8"));
    });
    response.on("error", () => {
      response.destroy();
      finish(deadline.aborted ? "timeout" : "fetch_error");
    });
  });
}

function terminalStatus(status: number) {
  return status === 401 || status === 402 || status === 403 || status === 404 || status === 410;
}

export async function fetchPublicPage(rawUrl: string, options: FetchOptions = {}): Promise<PublicPageFetchOutcome> {
  const allowLoopback = options.allowLoopback === true;
  const timeoutMs = options.timeoutMs ?? PUBLIC_PAGE_LIMITS.timeoutMs;
  const maxBytes = options.maxBytes ?? PUBLIC_PAGE_LIMITS.maxBytes;
  const maxRedirects = options.maxRedirects ?? PUBLIC_PAGE_LIMITS.maxRedirects;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const deadline = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (deadline.aborted) return { ok: false, code: "timeout" };
    const parsed = parsePublicUrl(current);
    if (!parsed.ok) return { ok: false, code: "unsupported_url" };
    let pinned: Awaited<ReturnType<typeof pinAddress>>;
    try {
      pinned = await pinAddress(parsed.hostname, allowLoopback, resolveHost);
    } catch {
      return { ok: false, code: deadline.aborted ? "timeout" : "name_not_resolved" };
    }
    if (!pinned.ok) return pinned;

    let response: IncomingMessage;
    try {
      response = await requestOnce({
        protocol: parsed.url.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.url.pathname,
        search: parsed.url.search,
      }, pinned, deadline);
    } catch (error) {
      return { ok: false, code: isTimeout(error, deadline) ? "timeout" : "fetch_error" };
    }

    const status = response.statusCode ?? 0;
    if (REDIRECT.has(status)) {
      const location = singleHeader(response, "location");
      response.destroy();
      if (redirects === maxRedirects) return { ok: false, code: "too_many_redirects" };
      if (!location || location.length > 2000) return { ok: false, code: "unsupported_url" };
      try {
        current = new URL(location, parsed.url).href;
      } catch {
        return { ok: false, code: "unsupported_url" };
      }
      continue;
    }

    if (terminalStatus(status)) {
      response.destroy();
      const classified = classifyFetchedDocument({
        pathname: parsed.url.pathname,
        httpStatus: status,
        body: "",
      });
      return { ok: true, ...classified, bodyText: "", title: "", containsExecutableInstructions: false };
    }

    if (status < 200 || status >= 300) {
      response.destroy();
      return { ok: false, code: "fetch_error" };
    }

    const contentType = singleHeader(response, "content-type");
    if (!allowedDocumentType(contentType)) {
      response.destroy();
      return { ok: false, code: "unsupported_content" };
    }

    const body = await readBody(response, maxBytes, deadline);
    if (body === "too_large") return { ok: false, code: "response_too_large" };
    if (body === "timeout") return { ok: false, code: "timeout" };
    if (body === "fetch_error") return { ok: false, code: "fetch_error" };
    const classified = classifyFetchedDocument({
      pathname: parsed.url.pathname,
      httpStatus: status,
      body,
    });
    return { ok: true, ...classified };
  }

  return { ok: false, code: "too_many_redirects" };
}
