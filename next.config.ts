import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Vendor documents and entrance media live in Supabase Storage.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "mwdwebsitec.netlify.app" }
    ]
  },
  headers: async () => [
    {
      // The service worker must be served from the root scope.
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" }
      ]
    }
  ]
};

export default withNextIntl(nextConfig);
