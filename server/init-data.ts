import { createHmac, timingSafeEqual } from "node:crypto";

// Проверка подписи данных запуска мини-приложения (dev.max.ru/docs/webapps/validation):
// secret = HMAC_SHA256(ключ "WebAppData", сообщение = токен бота),
// hash   = hex(HMAC_SHA256(secret, отсортированные пары key=value через \n, без hash)).

export interface MaxInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInit {
  user: MaxInitUser | null;
  authDate: number;
}

const MAX_AGE_SEC = 60 * 60; // документация советует не старше часа

export function verifyInitData(initData: string, botToken: string, now = Date.now()): VerifiedInit | null {
  if (!initData || !botToken) return null;
  // initData может прийти целиком из #фрагмента (WebAppData=...&WebAppPlatform=...) или уже как WebAppData
  let raw = initData.startsWith("#") ? initData.slice(1) : initData;
  const outer = new URLSearchParams(raw);
  if (outer.has("WebAppData")) raw = outer.get("WebAppData")!;

  const pairs = raw.split("&").filter(Boolean);
  let hash: string | null = null;
  const kv: [string, string][] = [];
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = decodeURIComponent(p.slice(0, i));
    const v = decodeURIComponent(p.slice(i + 1).replace(/\+/g, "%20"));
    if (k === "hash") {
      if (hash !== null) return null; // hash должен быть ровно один
      hash = v;
    } else kv.push([k, v]);
  }
  if (!hash) return null;
  kv.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const check = kv.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const params = Object.fromEntries(kv);
  const authDate = Number(params.auth_date) || 0;
  if (authDate && now / 1000 - authDate > MAX_AGE_SEC) return null;

  let user: MaxInitUser | null = null;
  try {
    user = params.user ? JSON.parse(params.user) : null;
  } catch {
    user = null;
  }
  return { user, authDate };
}
