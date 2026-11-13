import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Проверка номера, который пришёл из окна MAX «Поделиться номером». Если подпись верна — номер настоящий,
// его нельзя вписать чужой. Формат подписи MAX официально не описан, поэтому пробуем несколько схем
// (как у данных запуска мини-приложения и как у Telegram) и запоминаем, какая подошла — без цифр номера.

export interface ContactCheck {
  verified: boolean;
  /** какая схема подошла (для наладки), null — ни одна */
  scheme: string | null;
  /** какие поля прислал MAX (только названия и типы — без значений) */
  fields: string[];
}

const eq = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export function checkContact(raw: unknown, botToken: string): ContactCheck {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields = Object.keys(c).map((k) => `${k}:${typeof c[k]}`);
  const hash = typeof c.hash === "string" ? c.hash.toLowerCase() : "";
  if (!hash || !botToken) return { verified: false, scheme: null, fields };

  const phone = String(c.phone ?? c.phone_number ?? "");
  const authDate = String(c.authDate ?? c.auth_date ?? "");
  const str = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  // Строки для подписи: все поля, кроме hash, по алфавиту «ключ=значение» через перевод строки — и короткие варианты
  const all = Object.keys(c)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${str(c[k])}`)
    .join("\n");
  const allSnake = Object.keys(c)
    .filter((k) => k !== "hash")
    .map((k) => [k === "authDate" ? "auth_date" : k, c[k]] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${str(v)}`)
    .join("\n");
  const texts: Record<string, string> = {
    all,
    allSnake,
    "auth_date+phone": `auth_date=${authDate}\nphone=${phone}`,
    "auth_date+phone(без+)": `auth_date=${authDate}\nphone=${phone.replace(/^\+/, "")}`,
    "phone+auth_date": `phone=${phone}\nauth_date=${authDate}`,
  };
  const keys: Record<string, Buffer> = {
    WebAppData: createHmac("sha256", "WebAppData").update(botToken).digest(),
    "sha256(token)": createHash("sha256").update(botToken).digest(),
    token: Buffer.from(botToken),
  };
  for (const [kn, key] of Object.entries(keys)) {
    for (const [tn, text] of Object.entries(texts)) {
      if (eq(createHmac("sha256", key).update(text).digest("hex"), hash)) return { verified: true, scheme: `${kn}/${tn}`, fields };
    }
  }
  return { verified: false, scheme: null, fields };
}
