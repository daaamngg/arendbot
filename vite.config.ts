import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

/**
 * Защита страницы в сборке (CSP). Даже если где-то пролезет чужой код, он не сможет ни подгрузить свой скрипт,
 * ни отправить данные на чужой сервер: скрипты — только наши и мост MAX, запросы — только к нашему API
 */
const csp = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://st.max.ru; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self' https://functions.yandexcloud.net https://*.max.ru; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
    <meta name="referrer" content="no-referrer" />`,
    ),
});

// Мини-приложение в app/, общий код в shared/. API в разработке — server/dev-server.ts на 8788.
// Вместо React в сборке — Preact (тот же код, в разы легче): приложение быстрее открывается на слабых телефонах.
export default defineConfig({
  root: "app",
  base: "./",
  plugins: [react(), tailwindcss(), csp()],
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
