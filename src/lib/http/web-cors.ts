import "server-only";

function parseWebOrigin(value: string) {
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(value)) return null;
  const url = URL.parse(value);
  if (!url || url.username || url.password || url.hostname.includes("*") || value.includes("@")) return null;
  return url.origin;
}

export function getWebCorsConfig(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.GEO_WEB_ALLOWED_ORIGINS ?? "").trim();
  const origins = configured ? configured.split(",").map((value) => parseWebOrigin(value.trim())) : [];
  const cookieMode = env.GEO_WEB_CROSS_SITE_COOKIES;
  const crossSiteCookies = cookieMode === "true";
  const valid = origins.every((origin) => origin !== null)
    && (cookieMode === undefined || cookieMode === "" || cookieMode === "false" || crossSiteCookies)
    && (!crossSiteCookies || (
      origins.length > 0 && URL.parse(env.BETTER_AUTH_URL ?? "")?.protocol === "https:"
    ));

  return {
    valid,
    origins: new Set(valid ? origins.filter((origin) => origin !== null) : []),
    crossSiteCookies: valid && crossSiteCookies,
  };
}

export function isAllowedApiOrigin(request: Request, sameOrigin: string): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && (origin === sameOrigin || getWebCorsConfig().origins.has(origin));
}

export function allowsOptionalApiOrigin(request: Request, sameOrigin = new URL(request.url).origin): boolean {
  return !request.headers.has("origin") || isAllowedApiOrigin(request, sameOrigin);
}
