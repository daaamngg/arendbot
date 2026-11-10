import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Мини-приложение в app/, общий код в shared/. API в разработке — server/dev-server.ts на 8788.
// Вместо React в сборке — Preact (тот же код, в разы легче): приложение быстрее открывается на слабых телефонах.
export default defineConfig({
  root: "app",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
      { find: /^react-dom$/, replacement: "preact/compat" },
      { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
      { find: /^react$/, replacement: "preact/compat" },
    ],
  },
  server: { proxy: { "/api": "http://localhost:8788" }, allowedHosts: true },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2020" },
});
