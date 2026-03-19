import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hop",
    short_name: "Hop",
    description: "Privacy-first campus rideshare for NUS",
    scope: "/",
    start_url: "/dashboard",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "portrait",
    background_color: "#f5f6fa",
    theme_color: "#f5f6fa",
    categories: ["travel", "education", "utilities"],
    shortcuts: [
      {
        name: "Schedule a ride",
        short_name: "Schedule",
        url: "/availability",
      },
      {
        name: "View your group",
        short_name: "Group",
        url: "/group",
      },
    ],
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
      {
        src: "/maskable-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
