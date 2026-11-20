import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { memoryTable } from "./docs.ts";
import { handleApi, handleWebhook, processUpdate, sweep, type Config, type Ctx } from "./handlers.ts";
import { maxApi } from "./max-api.ts";

// Локальный сервер: npm run api (порт 8789, Vite проксирует /api сюда). Настройки — в .env.local (в git не идёт):
//   MAX_BOT_TOKEN, ADMIN_CODE, WEBHOOK_SECRET, BOT_USERNAME; MAX_SEND=1 — реально слать в MAX; MAX_POLL=1 — слушать бота без вебхука
const env = process.env;
const config: Config = {
  botToken: env.MAX_BOT_TOKEN ?? "",
  adminCode: env.ADMIN_CODE ?? "",
  webhookSecret: env.WEBHOOK_SECRET ?? "",
  allowBrowser: env.ALLOW_BROWSER !== "0",
  devUserId: Number(env.DEV_USER) || 1,
  botUsername: env.BOT_USERNAME,
  decideHours: Number(env.DECIDE_HOURS ?? 3),
};
const log = (s: string) => console.log(`[${new Date().toLocaleTimeString("ru-RU")}] ${s}`);
const ctx: Ctx = {
  db: memoryTable(fileURLToPath(new URL("./.data/db.json", import.meta.url))),
  max: maxApi({ token: config.botToken, dryRun: env.MAX_SEND !== "1", log }),
  config,
  log,
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const reply = (status: number, json: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(json));
  };
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    try {
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/webhook") return reply(...Object.values(await handleWebhook(ctx, req.headers["x-max-bot-api-secret"] as string | undefined, body)) as [number, unknown]);
      if (url.pathname.startsWith("/api/")) {
        const r = await handleApi(ctx, url.pathname.slice(4), body);
        if (r.status >= 400) log(`${url.pathname} → ${r.status} ${JSON.stringify(r.json)}`);
        return reply(r.status, r.json);
      }
      reply(404, { error: "not found" });
    } catch (e) {
      log(`Ошибка: ${(e as Error).stack}`);
      reply(500, { error: "server error" });
    }
  });
}).listen(8789, () => log("API: http://localhost:8789"));

setInterval(() => sweep(ctx).catch((e) => log(`sweep: ${(e as Error).message}`)), 60_000);

if (env.MAX_POLL === "1") {
  (async () => {
    let marker: number | undefined;
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
