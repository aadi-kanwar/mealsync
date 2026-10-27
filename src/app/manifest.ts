import type { MetadataRoute } from "next";

/** Lets residents add Dine to their home screen (needed for reminders on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dine by Livoza",
    short_name: "Dine",
    description: "Tell the PG which meals you'll eat, so nothing is cooked to be thrown away.",
    start_url: "/home",
    display: "standalone",
    background_color: "#f6f2ea",
    theme_color: "#f6f2ea",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
