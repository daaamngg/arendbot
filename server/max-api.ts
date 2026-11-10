// Bot API MAX. Токен — в заголовке Authorization (без Bearer), только из переменных окружения.
// platform-api.max.ru работает без сертификата Минцифры (проверено на боте-калькуляторе 06.11.2026).

export interface Button {
  type: "callback" | "link";
  text: string;
  payload?: string;
  url?: string;
}

export interface OutMessage {
  text: string;
  format?: "markdown" | "html";
  buttons?: Button[][];
  /** фото, которые хозяин прислал в чат: пересылаем по токену, без повторной загрузки */
  images?: { token?: string; url?: string }[];
}

export interface MaxApi {
  send(userId: number, msg: OutMessage): Promise<string | null>;
  edit(messageId: string, msg: OutMessage): Promise<void>;
  answerCallback(callbackId: string, notification: string, msg?: OutMessage): Promise<void>;
  subscribe(url: string, secret: string): Promise<unknown>;
  me(): Promise<{ user_id?: number; username?: string; name?: string }>;
  /** Long polling — только для разработки (в проде MAX требует вебхук) */
  updates(marker?: number): Promise<{ updates: unknown[]; marker?: number }>;
}

const body = (m: OutMessage) => ({
  text: m.text,
  format: m.format,
  attachments: [
    ...(m.images ?? []).slice(0, 10).map((p) => ({ type: "image", payload: p.token ? { token: p.token } : { url: p.url } })),
    ...(m.buttons?.length ? [{ type: "inline_keyboard", payload: { buttons: m.buttons } }] : []),
  ],
});

export function maxApi(opts: { token: string; baseUrl?: string; dryRun?: boolean; log?: (s: string) => void }): MaxApi {
  const base = (opts.baseUrl ?? "https://platform-api.max.ru").replace(/\/$/, "");
  const log = opts.log ?? console.log;

  async function call(method: string, path: string, payload?: unknown) {
    if (opts.dryRun) {
      log(`[MAX dry-run] ${method} ${path}\n${JSON.stringify(payload, null, 2)}`);
      return { message: { body: { mid: `dry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } } };
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: opts.token, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`MAX ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  return {
    async send(userId, msg) {
      const r = await call("POST", `/messages?user_id=${userId}`, body(msg));
      return r?.message?.body?.mid ?? null;
    },
    async edit(mid, msg) {
      await call("PUT", `/messages?message_id=${encodeURIComponent(mid)}`, body(msg));
    },
    async answerCallback(callbackId, notification, msg) {
      await call("POST", `/answers?callback_id=${encodeURIComponent(callbackId)}`, {
        notification,
        ...(msg ? { message: body(msg) } : {}),
      });
    },
    subscribe(url, secret) {
      return call("POST", "/subscriptions", { url, secret, update_types: ["bot_started", "message_created", "message_callback"] });
    },
    me() {
      return opts.dryRun ? Promise.resolve({}) : call("GET", "/me");
    },
    async updates(marker) {
      if (opts.dryRun) return { updates: [] };
      const q = new URLSearchParams({ timeout: "25", types: "bot_started,message_created,message_callback" });
      if (marker != null) q.set("marker", String(marker));
      return call("GET", `/updates?${q}`);
    },
  };
}
