import { defineConfig } from "vite";

// Tauri loads the dev server from a fixed port and expects it to fail if the port is taken.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The webview has no attached console, so its output goes to the `pnpm tauri dev` terminal.
    forwardConsole: { unhandledErrors: true, logLevels: ["error", "warn", "info", "log"] },
  },
  build: { target: "safari16" },
});
