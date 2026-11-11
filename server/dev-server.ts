import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { handleApi, handleWebhook, processUpdate, sweep, type Config, type Ctx } from "./handlers.ts";
import { maxApi } from "./max-api.ts";
import { fileStore } from "./store.ts";

// Локальный сервер: npm run api (порт 8788, Vite проксирует /api сюда).
// Переменные — в .env.local (в git не идёт):
//   MAX_BOT_TOKEN  токен бота
//   ADMIN_CODE     код для команды боту «/admin <код>» (так Сергей становится модератором)
//   MAX_SEND=1     реально слать сообщения в MAX (иначе только печать в консоль)
//   MAX_POLL=1     получать события бота long polling'ом без вебхука
//   DEV_USER       MAX id, под которым работает обычный браузер при разработке

const env = process.env;
const config: Config = {
  botToken: env.MAX_BOT_TOKEN ?? "",
  adminCode: env.ADMIN_CODE ?? "",
  webhookSecret: env.WEBHOOK_SECRET ?? "",
  allowBrowser: env.ALLOW_BROWSER !== "0",
  devUserId: Number(env.DEV_USER) || 1,
  botUsername: env.BOT_USERNAME,
  decideHours: Number(env.DECIDE_HOURS ?? 3),
  moderation: env.MODERATION === "pre" ? "pre" : "post",
  adminUrl: env.ADMIN_URL ?? "http://localhost:5197/admin.html",
};
const log = (s: string) => console.log(`[${new Date().toLocaleTimeString("ru-RU")}] ${s}`);
const ctx: Ctx = {
  store: fileStore(fileURLToPath(new URL("./.data/db.json", import.meta.url))),
  max: maxApi({ token: config.botToken, baseUrl: env.MAX_API_URL, dryRun: env.MAX_SEND !== "1", log }),
  config,
  log,
};

const readBody = (req: import("node:http").IncomingMessage) =>
  new Promise<any>((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      // Фото из приложения приходят base64 (до ~3,5 МБ), остальное — маленькие JSON
      if (raw.length > 4_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const reply = (status: number, json: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(json));
  };
  try {
    // Загруженные из приложения фото (локально; в облаке они лежат в Object Storage)
    const photo = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (req.method === "GET" && photo) {
      const buf = await ctx.store.readPhoto(photo[1]);
      if (!buf) return reply(404, { error: "not found" });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(buf);
    }
    if (req.method !== "POST") return reply(200, { ok: true, service: "arenda-bot" });
    const body = await readBody(req);
    if (body === null) return reply(400, { error: "bad json" });
    if (url.pathname === "/webhook") {
      const r = await handleWebhook(ctx, req.headers["x-max-bot-api-secret"] as string | undefined, body);
      return reply(r.status, r.json);
    }
    if (url.pathname.startsWith("/api/")) {
      const r = await handleApi(ctx, url.pathname.slice(4), body, { ip: req.socket.remoteAddress });
      if (r.status >= 400) log(`${url.pathname} → ${r.status} ${JSON.stringify(r.json)}`);
      return reply(r.status, r.json);
    }
    reply(404, { error: "not found" });
  } catch (e) {
    log(`Ошибка: ${(e as Error).stack}`);
    reply(500, { error: "server error" });
  }
}).listen(8788, () => {
  log(`API: http://localhost:8788  ·  отправка в MAX: ${env.MAX_SEND === "1" ? "ВКЛ" : "выкл (печать в консоль)"}`);
});

setInterval(() => sweep(ctx).catch((e) => log(`sweep: ${(e as Error).message}`)), 60_000);

if (env.MAX_POLL === "1") {
  (async () => {
    let marker: number | undefined;
    log("Слушаю события бота (long polling)");
    for (;;) {
      try {
        const r = await ctx.max.updates(marker);
        marker = r.marker ?? marker;
        for (const u of r.updates) await processUpdate(ctx, u);
      } catch (e) {
        log(`polling: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}
