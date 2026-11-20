import { createHmac } from "node:crypto";

// Для самопроверки: initData, подписанный так же, как это делает MAX, для пользователя с заданным id
export function signedInit(token: string, userId: number, firstName?: string) {
  const p: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, ...(firstName ? { first_name: firstName } : {}) }),
  };
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret)
    .update(Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("\n"))
    .digest("hex");
  return Object.entries({ ...p, hash }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
