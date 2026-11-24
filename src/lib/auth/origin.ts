const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function trustedAppOrigins(configuredBaseUrl: string, request?: Request, webOrigins: Iterable<string> = []): string[] {
  const configured = new URL(configuredBaseUrl);
  const origins = new Set([configured.origin, ...webOrigins]);

  if (!request || !loopbackHosts.has(configured.hostname)) {
    return [...origins];
  }

  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!host || (forwardedHost !== null && forwardedHost !== host)) {
    return [...origins];
  }

  const candidate = URL.parse(`${configured.protocol}//${host}`);
  if (
    candidate
    && !candidate.username
    && !candidate.password
    && candidate.host === host
    && loopbackHosts.has(candidate.hostname)
  ) {
    origins.add(candidate.origin);
  }

  return [...origins];
}

export function isTrustedAppOrigin(configuredBaseUrl: string, request: Request, webOrigins?: Iterable<string>): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && trustedAppOrigins(configuredBaseUrl, request, webOrigins).includes(origin));
}
