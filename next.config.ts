import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server (.next/standalone) for the Docker image; the image copies static files and migrations next to it.
  output: "standalone",
  // The Content-Security-Policy (per-request nonce) is set in src/proxy.ts; these cover framing and referrer leaks.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera stays off: guests scan the invite QR with their phone's own camera app, not inside Salo.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Sessions and invites are private: never in search results, even if a link leaks.
        source: "/:prefix(s|j|api)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
