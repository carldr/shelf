import { defineConfig } from "vite";

// Tauri loads the dev server from a fixed port and expects it to fail if the port is taken.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari16" },
});
