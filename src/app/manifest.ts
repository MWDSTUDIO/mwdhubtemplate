import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Inner House — Madame Wedding Design",
    short_name: "The Inner House",
    description:
      "The client portal of Madame Wedding Design, a Parisian house of wedding planning and production.",
    start_url: "/",
    display: "standalone",
    background_color: "#22382B",
    theme_color: "#22382B",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
