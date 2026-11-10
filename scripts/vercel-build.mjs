// Сборка ДЕМО-версии для Vercel (Build Output API v3): статика мини-приложения + одна функция /api.
// Запуск: node scripts/vercel-build.mjs, потом npx vercel deploy --prebuilt --prod
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });

execSync("npx vite build", { stdio: "inherit" });
cpSync("dist", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["server/vercel-demo.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: `${fn}/index.mjs`,
  logLevel: "warning",
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 10 }, null, 2));

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // /api/<путь> → функция, путь — параметром
        { src: "^/api/(.*)$", dest: "/api?__path=$1" },
        { handle: "filesystem" },
        // Всё остальное — мини-приложение (одна страница)
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("ok: .vercel/output готов");
