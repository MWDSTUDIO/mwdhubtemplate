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
  // Service-worker caching headers live in public/_headers (Netlify CDN):
  // a headers() rule here would route /sw.js through the server handler,
  // which does not carry public/ assets on Netlify.
};

export default withNextIntl(nextConfig);
