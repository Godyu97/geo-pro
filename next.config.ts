import type { NextConfig } from "next";

const authUrl = URL.parse(process.env.BETTER_AUTH_URL ?? "");
const allowedDevOrigins = ["127.0.0.1", "[::1]", "::1"];
// Local development uses the same configured host for the app and HMR.
if (authUrl && (authUrl.protocol === "http:" || authUrl.protocol === "https:") && !authUrl.hostname.includes("*")) {
  allowedDevOrigins.push(authUrl.hostname);
}

const nextConfig: NextConfig = {
  // Keep the repository's hand-maintained development rules authoritative.
  agentRules: false,
  allowedDevOrigins,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
