import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Few, light images (plaque, board covers) — served directly; the
  // image-CDN round-trip 502s on CLI deploys and buys us nothing here.
  images: {
    unoptimized: true,
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
