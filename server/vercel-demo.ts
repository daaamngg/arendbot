import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, sweep, type Ctx } from "./handlers.ts";
import { maxApi } from "./max-api.ts";
import { seedDemo } from "./seed.ts";
import { fileStore } from "./store.ts";

// ДЕМО-версия для Vercel: показать площадку по ссылке. НЕ для настоящих людей:
// - серверы Vercel в США, а персональные данные россиян по 152-ФЗ хранятся в России → настоящий запуск в Яндекс Облаке;
// - диска нет, база во временной папке: при перезапуске всё сбрасывается к тестовым объявлениям;
// - токена бота здесь нет, сообщения в MAX не уходят (только в журнал), любой открывший — тестовый «главный».

const DEMO_USER = 1;
const log = (s: string) => console.log(s.slice(0, 500));
const ctx: Ctx = {
  store: fileStore("/tmp/arenda-demo/db.json"),
  max: maxApi({ token: "", dryRun: true, log: () => {} }),
  config: { botToken: "", adminCode: "", webhookSecret: "", allowBrowser: true, devUserId: DEMO_USER, decideHours: 3, moderation: "post", demo: true },
  log,
};

let ready: Promise<void> | null = null;
const init = () =>
  (ready ??= (async () => {
    if (!(await ctx.store.listListings()).length) await seedDemo(ctx.store, { devUserId: DEMO_USER });
  })());

const readBody = (req: IncomingMessage) =>
  new Promise<any>((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const reply = (status: number, json: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(json));
  };
  try {
    await init();
    const url = new URL(req.url ?? "/", "http://x");
    // Путь после /api/ приходит параметром (так настроена переадресация в config.json)
    const path = `/${url.searchParams.get("__path") ?? ""}`;
    const photo = path.match(/^\/photos\/([^/]+)$/);
    if (req.method === "GET" && photo) {
      const buf = await ctx.store.readPhoto(photo[1]);
      if (!buf) return reply(404, { error: "not found" });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
      return res.end(buf);
    }
    if (req.method !== "POST") return reply(200, { ok: true, service: "arenda-bot demo" });
    const body = await readBody(req);
    if (body === null) return reply(400, { error: "bad json" });
    // Таймера нет — отменяем просроченные запросы и шлём напоминания при обращениях
    sweep(ctx).catch(() => {});
    const r = await handleApi(ctx, path, body, { ip: String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress });
    reply(r.status, r.json);
  } catch (e) {
    log(`Ошибка: ${(e as Error).stack}`);
    reply(500, { error: "server error" });
  }
}
