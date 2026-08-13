import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Served from the project server's root, so absolute asset paths are correct.
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The board is served from loopback by a process on the same machine.
    // Sourcemaps cost nothing here and make a production bug debuggable.
    sourcemap: true,
  },
  server: {
    // `bun run dev` proxies to whichever server the project has running.
    proxy: {
      "/api": {
        target: process.env.CC_DEV_API ?? "http://127.0.0.1:4400",
        changeOrigin: true,
      },
    },
  },
});
