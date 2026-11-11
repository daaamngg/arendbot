// Сборка для Яндекс Облака:
//   cloud-dist/function/  — облачная функция (index.js + package.json; ydb-sdk облако поставит само)
//   cloud-dist/site/      — мини-приложение и админка для бакета Object Storage (статический сайт)
// Запуск: API_URL="https://functions.yandexcloud.net/<id>?p=" node scripts/cloud-build.mjs
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const api = process.env.API_URL;
if (!api || !api.endsWith("?p=")) {
  console.error('Нужен API_URL — адрес функции с «?p=» на конце, например https://functions.yandexcloud.net/d4e…?p=');
  process.exit(1);
}
const out = "cloud-dist";
rmSync(out, { recursive: true, force: true });

// Сайт: адрес API зашивается в сборку
execSync("npx vite build", { stdio: "inherit", env: { ...process.env, VITE_API_URL: api } });
cpSync("dist", `${out}/site`, { recursive: true });

// Функция: весь наш код одним файлом, ydb-sdk — зависимостью (у неё свои файлы сертификатов)
mkdirSync(`${out}/function`, { recursive: true });
await build({
  entryPoints: ["server/cloud.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: `${out}/function/index.js`,
  external: ["ydb-sdk"],
  logLevel: "warning",
});
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(`${out}/function/package.json`, JSON.stringify({ name: "arenda-function", private: true, dependencies: { "ydb-sdk": pkg.dependencies["ydb-sdk"] } }, null, 2));
console.log(`ok: ${out}/function (точка входа index.handler) и ${out}/site`);
