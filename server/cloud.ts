import { handleApi, handleWebhook, sweep, type Config, type Ctx } from "./handlers.ts";
import { docStore } from "./doc-store.ts";
import { maxApi } from "./max-api.ts";
import { ydbTable } from "./ydb-table.ts";

// Облачная функция Яндекса: одна функция на всё.
//   POST …?p=/me, /book, …     — API мини-приложения и админки
//   POST …?p=/webhook          — события бота MAX (с секретом в заголовке)
//   GET  …?p=/photos/<uuid>.jpg — фото, загруженные из приложения
//   таймер раз в минуту        — отмена просроченных запросов, напоминания, просьбы об отзыве
// Путь передаётся параметром p: прямой адрес функции (functions.yandexcloud.net/<id>) не умеет пути,
// а API Gateway мы не ставим — у него бесплатный лимит в 10 раз меньше, чем у функций.
//
// Переменные окружения функции (секреты — из Lockbox, не в коде):
//   MAX_BOT_TOKEN, ADMIN_CODE, WEBHOOK_SECRET, BOT_USERNAME
//   YDB_CONNECTION       grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/…
//   YDB_METADATA_CREDENTIALS=1   вход в базу по сервисному аккаунту функции
//   APP_ORIGIN           адрес мини-приложения (https://….website.yandexcloud.net) — только ему разрешены запросы
//   API_URL              адрес этой функции с «?p=» на конце — для ссылок на фото
//   PHOTO_BUCKET         бакет для фото (публичное чтение, без списка файлов)

const env = process.env;
const config: Config = {
  botToken: env.MAX_BOT_TOKEN ?? "",
  adminCode: env.ADMIN_CODE ?? "",
  modCode: env.MOD_CODE ?? "",
  webhookSecret: env.WEBHOOK_SECRET ?? "",
  // В облаке только настоящие люди из MAX: без подписи — отказ. Никакого демо-режима
  allowBrowser: false,
  botUsername: env.BOT_USERNAME,
  decideHours: Number(env.DECIDE_HOURS ?? 3),
  moderation: env.MODERATION === "pre" ? "pre" : "post",
  adminUrl: env.ADMIN_URL,
};

let ctxPromise: Promise<Ctx> | null = null;
const getCtx = () =>
  (ctxPromise ??= (async () => {
    // Без этих настроек запускаться опасно (вебхук без секрета, вход без подписи) — лучше упасть сразу
    for (const k of ["MAX_BOT_TOKEN", "WEBHOOK_SECRET", "YDB_CONNECTION", "APP_ORIGIN", "API_URL", "PHOTO_BUCKET", "ADMIN_CODE"]) if (!env[k]) throw new Error(`нет настройки ${k}`);
    const table = await ydbTable(env.YDB_CONNECTION!);
    const log = (s: string) => console.log(s.slice(0, 2000));
    return {
      store: docStore(table, { photoUrl: (name) => `${env.API_URL}/photos/${name}`, photos: { save: savePhotoToBucket } }),
      max: maxApi({ token: config.botToken, dryRun: false, log }),
      config,
      log,
    };
  })().catch((e) => {
    ctxPromise = null; // следующий вызов попробует снова
    throw e;
  }));

/** IAM-токен сервисного аккаунта функции: облако передаёт его в каждом вызове, ключи хранить не нужно */
let iamToken = "";

/** Фото — в бакет Object Storage. Читают его напрямую из бакета (не через функцию и не из базы) */
async function savePhotoToBucket(name: string, jpeg: Buffer) {
  const key = `photos/${name}`;
  const url = `https://storage.yandexcloud.net/${env.PHOTO_BUCKET}/${key}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: { "X-YaCloud-SubjectToken": iamToken, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    body: new Uint8Array(jpeg),
  });
  if (!r.ok) throw new Error(`фото не сохранилось: ${r.status}`);
  return url;
}

interface HttpEvent {
  httpMethod?: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { identity?: { sourceIp?: string } };
  /** вызов от таймера */
  messages?: { event_metadata?: { event_type?: string } }[];
}

const header = (e: HttpEvent, name: string) => {
  const h = e.headers ?? {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : undefined;
};

export async function handler(event: HttpEvent, context?: { token?: { access_token?: string } }) {
  if (context?.token?.access_token) iamToken = context.token.access_token;
  // Таймер раз в минуту
  if (event.messages?.some((m) => m.event_metadata?.event_type?.includes("Timer"))) {
    await sweep(await getCtx());
    return { statusCode: 200, body: "ok" };
  }

  const origin = env.APP_ORIGIN ?? "";
  // Запросы из браузера разрешены только с адреса мини-приложения (CORS)
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  const json = (statusCode: number, data: unknown) => ({
    statusCode,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    body: JSON.stringify(data),
  });
  try {
    const method = (event.httpMethod ?? "POST").toUpperCase();
    if (method === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    const path = event.queryStringParameters?.p ?? "/";
    const ctx = await getCtx();

    const photo = path.match(/^\/photos\/([^/]+)$/);
    if (method === "GET" && photo) {
      const buf = await ctx.store.readPhoto(photo[1]);
      if (!buf) return json(404, { error: "not found" });
      return { statusCode: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }, body: buf.toString("base64"), isBase64Encoded: true };
    }
    if (method !== "POST") return json(200, { ok: true });

    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    // Фото из приложения приходят base64 (до ~3,5 МБ), остальное — маленькие JSON
    if (raw.length > 4_000_000) return json(413, { error: "too large" });
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "bad json" });
    }

    if (path === "/webhook") {
      const r = await handleWebhook(ctx, header(event, "X-Max-Bot-Api-Secret"), body);
      return json(r.status, r.json);
    }
    const ip = (header(event, "X-Forwarded-For") ?? "").split(",")[0].trim() || event.requestContext?.identity?.sourceIp;
    const r = await handleApi(ctx, path, body, { ip });
    return json(r.status, r.json);
  } catch (e) {
    console.error(`Ошибка: ${(e as Error).stack}`);
    // DEBUG_ERRORS=1 — временно для наладки: текст ошибки в ответе (в обычной работе выключено)
    return json(500, { error: "server error", ...(env.DEBUG_ERRORS === "1" ? { detail: String((e as Error).message).slice(0, 300) } : {}) });
  }
}
