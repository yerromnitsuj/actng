import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ports are env-overridable so multiple instances can run side by side
// (e.g. a pristine review instance next to the dev one).
const webPort = Number(process.env.ACTNG_WEB_PORT ?? 5175);
const apiPort = Number(process.env.ACTNG_API_PORT ?? 4600);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
});
