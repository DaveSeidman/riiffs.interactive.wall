import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/riffs-interactive-wall/" : "/",
  server: {
    port: 8081,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        experience: resolve("index.html"),
        tracker: resolve("tracker.html"),
      },
    },
  },
});
