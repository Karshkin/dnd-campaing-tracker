import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/dnd-campaing-tracker/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
