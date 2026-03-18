import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hop",
    short_name: "Hop",
    description: "Privacy-first campus rideshare for NUS",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#080c18",
    theme_color: "#080c18",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
