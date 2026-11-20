const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function trustedAppOrigins(configuredBaseUrl: string, request?: Request): string[] {
  const configured = new URL(configuredBaseUrl);
  const origins = [configured.origin];

  if (!request || !loopbackHosts.has(configured.hostname)) {
    return origins;
  }

  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!host || (forwardedHost !== null && forwardedHost !== host)) {
    return origins;
  }

  const candidate = URL.parse(`${configured.protocol}//${host}`);
  if (
    candidate
    && !candidate.username
    && !candidate.password
    && candidate.host === host
    && loopbackHosts.has(candidate.hostname)
    && candidate.origin !== configured.origin
  ) {
    origins.push(candidate.origin);
  }

  return origins;
}

export function isTrustedAppOrigin(configuredBaseUrl: string, request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && trustedAppOrigins(configuredBaseUrl, request).includes(origin));
}
