import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Big 2",
    short_name: "Big 2",
    description: "Play Big 2 against a trained bot, with friends, or ask the bot for the best move.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f0ea",
    theme_color: "#111111",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
