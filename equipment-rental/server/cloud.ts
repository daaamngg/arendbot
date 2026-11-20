import { handleApi, handleWebhook, sweep, type Config, type Ctx } from "./handlers.ts";
import { maxApi } from "./max-api.ts";
import { ydbTable } from "./ydb-table.ts";

// Облачная функция Яндекса: одна на всё. POST …?p=/me, /items, /book… — API мини-приложения;
// POST …?p=/webhook — события бота MAX (с секретом); таймер раз в минуту — отмена просроченных заявок и напоминания.
// Переменные окружения: MAX_BOT_TOKEN, ADMIN_CODE, WEBHOOK_SECRET, BOT_USERNAME, YDB_CONNECTION,
// YDB_METADATA_CREDENTIALS=1, APP_ORIGIN (адрес мини-приложения — только ему разрешены запросы из браузера)

const env = process.env;
const config: Config = {
  botToken: env.MAX_BOT_TOKEN ?? "",
  adminCode: env.ADMIN_CODE ?? "",
  webhookSecret: env.WEBHOOK_SECRET ?? "",
  allowBrowser: false, // в облаке только настоящие люди из MAX
  botUsername: env.BOT_USERNAME,
  decideHours: Number(env.DECIDE_HOURS ?? 3),
};

let ctxPromise: Promise<Ctx> | null = null;
const getCtx = () =>
  (ctxPromise ??= (async () => {
    for (const k of ["MAX_BOT_TOKEN", "WEBHOOK_SECRET", "YDB_CONNECTION", "APP_ORIGIN", "ADMIN_CODE"]) if (!env[k]) throw new Error(`нет настройки ${k}`);
    const log = (s: string) => console.log(s.slice(0, 2000));
    return { db: await ydbTable(env.YDB_CONNECTION!), max: maxApi({ token: config.botToken, dryRun: false, log }), config, log };
  })().catch((e) => {
    ctxPromise = null;
    throw e;
  }));

interface HttpEvent {
  httpMethod?: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  messages?: { event_metadata?: { event_type?: string } }[];
}
const header = (e: HttpEvent, name: string) => {
  const h = e.headers ?? {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : undefined;
};

export async function handler(event: HttpEvent) {
  if (event.messages?.some((m) => m.event_metadata?.event_type?.includes("Timer"))) {
    const ctx = await getCtx();
    // Похожее на таймер событие можно прислать и снаружи — работу делаем не чаще раза в 50 секунд
    const last = await ctx.db.get<number>("mark", "sweep-run");
    if (last && Date.now() - last < 50_000) return { statusCode: 200, body: "ok" };
    await ctx.db.put({ kind: "mark", id: "sweep-run", data: Date.now() });
    await sweep(ctx);
    return { statusCode: 200, body: "ok" };
  }
  const cors = { "Access-Control-Allow-Origin": env.APP_ORIGIN ?? "", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: JSON.stringify(data) });
  try {
    const method = (event.httpMethod ?? "POST").toUpperCase();
    if (method === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (method !== "POST") return json(200, { ok: true });
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    if (raw.length > 100_000) return json(413, { error: "too large" });
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "bad json" });
    }
    const ctx = await getCtx();
    const path = event.queryStringParameters?.p ?? "/";
    const r = path === "/webhook" ? await handleWebhook(ctx, header(event, "X-Max-Bot-Api-Secret"), body) : await handleApi(ctx, path, body);
    return json(r.status, r.json);
  } catch (e) {
    console.error(`Ошибка: ${(e as Error).stack}`);
    return json(500, { error: "server error" });
  }
}
