import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository's hand-maintained development rules authoritative.
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "[::1]", "::1"],
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
