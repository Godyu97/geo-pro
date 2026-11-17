import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository's hand-maintained development rules authoritative.
  agentRules: false,
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
