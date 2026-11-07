import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings that must not be bundled.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // `next dev` would otherwise rewrite AGENTS.md with its own template, dropping our notes.
  agentRules: false,
  async rewrites() {
    return [
      // The API used to live at /api/travel/* on the main site. Llamabear's feed,
      // trip_planning and existing calendar subscriptions still use that prefix.
      { source: "/api/travel/:path*", destination: "/api/:path*" },
    ];
  },
};

export default nextConfig;
