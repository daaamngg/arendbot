// Загрузка сайта в бакет с правильными путями (yc storage s3 cp на Windows пишет «assets\файл» с обратной чертой).
// node scripts/cloud-upload-site.mjs <бакет> [профиль]
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const [bucket, profile = "default"] = process.argv.slice(2);
const yc = process.env.YC ?? join(homedir(), "yandex-cloud", "bin", "yc.exe");
const root = "cloud-dist/site";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json" };
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const file of walk(root)) {
  const key = relative(root, file).split("\\").join("/");
  const ext = key.slice(key.lastIndexOf("."));
  // index.html — всегда свежий; файлы со «отпечатком» в имени (assets/…-abc123.js) кэшируются надолго
  const cache = key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  // Облако иногда отвечает ошибкой на один файл из многих — повторяем до 4 раз с паузой
  for (let i = 1; ; i++) {
    try {
      execFileSync(yc, ["--profile", profile, "storage", "s3api", "put-object", "--bucket", bucket, "--key", key, "--body", file, "--content-type", types[ext] ?? "application/octet-stream", "--cache-control", cache], { stdio: "ignore" });
      break;
    } catch (e) {
      if (i >= 4) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * i);
    }
  }
  console.log("загружен", key);
}
