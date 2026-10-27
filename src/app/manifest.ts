import type { MetadataRoute } from "next";

/** Lets people add Dine to their home screen / app drawer (and get reminders on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dine by Livoza",
    short_name: "Dine",
    description: "Tell the PG which meals you'll eat, so nothing is cooked to be thrown away.",
    // The landing page sends signed-in people to their own screen.
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f2ea",
    theme_color: "#f6f2ea",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
