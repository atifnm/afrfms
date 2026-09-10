import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: {
    // Railway (and most PaaS hosts) proxy requests through a generated
    // domain — without this, Vite's preview server rejects the Host header.
    allowedHosts: true,
  },
});
