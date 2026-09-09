import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roam — community-signal travel",
    short_name: "Roam",
    description:
      "Real local places from 13 keyless open-data sources, with an on-device voice trip planner.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F2EB",
    theme_color: "#D96B43",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
