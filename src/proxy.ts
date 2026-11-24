import { NextResponse, type NextRequest } from "next/server";
import { profileSessionHeader } from "@/features/account/profile";
import { trustedAppOrigins } from "@/lib/auth/origin";
import { getWebCorsConfig } from "@/lib/http/web-cors";

const corsMethods = new Set(["GET", "HEAD", "POST"]);
const corsRequestHeaders = new Set(["authorization", "content-type", profileSessionHeader]);

function apiResponse(request: NextRequest) {
  const { origins, crossSiteCookies } = getWebCorsConfig();
  if (!origins.size) return NextResponse.next();

  const origin = request.headers.get("origin");
  const allowed = origin !== null && origins.has(origin);
  const headers = new Headers({ Vary: "Origin" });
  const requestedMethod = request.headers.get("access-control-request-method");
  if (request.method === "OPTIONS" && origin !== null && requestedMethod !== null) {
    headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
    const requestedHeaders = request.headers.get("access-control-request-headers");
    const headersAllowed = !requestedHeaders || requestedHeaders.split(",").every(
      (name) => corsRequestHeaders.has(name.trim().toLowerCase()),
    );
    if (!allowed || !corsMethods.has(requestedMethod) || !headersAllowed) {
      return new NextResponse(null, { status: 403, headers });
    }
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", [...corsMethods].join(", "));
    headers.set("Access-Control-Allow-Headers", [...corsRequestHeaders].join(", "));
    headers.set("Access-Control-Max-Age", "600");
    return new NextResponse(null, { status: 204, headers });
  }

  if (allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After");
  } else if (crossSiteCookies && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    // Cross-site session cookies also accompany form submissions. Check the
    // source before dispatch even when the browser would hide the response.
    const site = request.headers.get("sec-fetch-site");
    const baseUrl = URL.parse(process.env.BETTER_AUTH_URL ?? "");
    const trusted = origin !== null && baseUrl && trustedAppOrigins(baseUrl.href, request).includes(origin);
    if (origin !== null ? !trusted : site === "cross-site" || site === "same-site") {
      return new NextResponse(null, { status: 403, headers });
    }
  }
  return NextResponse.next({ headers });
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api" || path.startsWith("/api/")) return apiResponse(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-geo-path", `${path}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Cookie / Accept-Language dependent HTML and RSC responses must not be shared.
  response.headers.set("Cache-Control", "private, no-store");
  if (path === "/account-access") {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/((?!api(?:/|$)|_next(?:/|$)|favicon.ico|.*\\.(?:png|jpg|svg|css|js|woff2)$).*)"],
};
