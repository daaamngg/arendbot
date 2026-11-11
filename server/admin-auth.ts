import { createHash, randomBytes, randomInt } from "node:crypto";
import type { AdminLogin, AdminSession } from "../shared/types.ts";
import type { Store } from "./store.ts";

// Вход в отдельную админку (страница admin.html, открывается и в MAX, и в браузере на компьютере).
// 1. Страница просит код: сервер выдаёт 6 цифр и секрет, который знает только эта страница.
// 2. Человек из команды отправляет код боту. Бот спрашивает «Это вы входите? <устройство>» с кнопками.
// 3. После «Да» страница (она опрашивает сервер) получает ключ входа. Ключ действует, пока не нажали «Выйти»,
//    не отправили боту /logout_all или человека не убрали из команды (это проверяется на каждом запросе).
// Код сам по себе бесполезен: подтвердить его может только тот, кто есть в команде, из своего MAX.

const CODE_TTL = 5 * 60_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startLogin(store: Store, device: string, t: number) {
  // Чистим старые попытки, чтобы записи не копились
  for (const [k, l] of await store.kvList<AdminLogin>("login:")) {
    if (t > l.expiresAt + 60 * 60_000) {
      await store.kvSet(k, undefined);
      await store.kvSet(`code:${l.code}`, undefined);
    }
  }
  let code = "";
  for (let i = 0; i < 20; i++) {
    code = String(randomInt(100000, 1000000));
    const busy = await store.kvGet<string>(`code:${code}`);
    const other = busy ? await store.kvGet<AdminLogin>(`login:${busy}`) : undefined;
    if (!other || t > other.expiresAt) break;
  }
  const secret = randomBytes(24).toString("base64url");
  const login: AdminLogin = {
    id: randomBytes(9).toString("base64url"),
    secretHash: sha(secret),
    code,
    device: device.slice(0, 80) || "неизвестное устройство",
    createdAt: t,
    expiresAt: t + CODE_TTL,
    state: "waiting",
  };
  await store.kvSet(`login:${login.id}`, login);
  await store.kvSet(`code:${code}`, login.id);
  return { id: login.id, secret, code, expiresAt: login.expiresAt };
}

/** Страница спрашивает, подтвердили ли вход. Ключ отдаётся один раз и только странице с правильным секретом */
export async function checkLogin(store: Store, id: string, secret: string, t: number): Promise<{ state: AdminLogin["state"] | "expired"; token?: string }> {
  const l = await store.kvGet<AdminLogin>(`login:${id}`);
  if (!l || l.secretHash !== sha(secret)) return { state: "expired" };
  if (l.state === "approved" && l.uid) {
    const token = randomBytes(32).toString("base64url");
    const s: AdminSession = { uid: l.uid, device: l.device, createdAt: t, lastSeenAt: t };
    await store.kvSet(`sess:${sha(token)}`, s);
    await store.kvSet(`login:${id}`, { ...l, state: "used" });
    await store.kvSet(`code:${l.code}`, undefined);
    return { state: "approved", token };
  }
  if ((l.state === "waiting" || l.state === "asked") && t > l.expiresAt) return { state: "expired" };
  return { state: l.state };
}

/** Бот получил код от человека из команды: запоминаем, кто подтверждает. null — код не подходит */
export async function claimCode(store: Store, code: string, uid: number, t: number): Promise<AdminLogin | null> {
  const id = await store.kvGet<string>(`code:${code}`);
  const l = id ? await store.kvGet<AdminLogin>(`login:${id}`) : undefined;
  if (!l || l.state !== "waiting" || t > l.expiresAt) return null;
  const claimed: AdminLogin = { ...l, state: "asked", uid };
  await store.kvSet(`login:${l.id}`, claimed);
  return claimed;
}

/** Ответ на кнопку «Да, это я» / «Нет». Нажать может только тот, кто отправил код */
export async function answerLogin(store: Store, id: string, uid: number, yes: boolean, t: number): Promise<"ok" | "denied" | "gone"> {
  const l = await store.kvGet<AdminLogin>(`login:${id}`);
  // На ответ даём чуть больше времени, чем на ввод кода: человек мог отвлечься
  if (!l || l.uid !== uid || l.state !== "asked" || t > l.expiresAt + CODE_TTL) return "gone";
  await store.kvSet(`login:${id}`, { ...l, state: yes ? "approved" : "denied" });
  return yes ? "ok" : "denied";
}

/** Кто вошёл по ключу. Время последнего захода обновляем не чаще раза в 10 минут */
export async function sessionUid(store: Store, token: string, t: number): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const key = `sess:${sha(token)}`;
  const s = await store.kvGet<AdminSession>(key);
  if (!s) return null;
  if (t - s.lastSeenAt > 10 * 60_000) await store.kvSet(key, { ...s, lastSeenAt: t });
  return s.uid;
}

export async function logout(store: Store, token: string) {
  await store.kvSet(`sess:${sha(token)}`, undefined);
}

/** Выйти на всех устройствах (команда боту /logout_all или кнопка в админке). Возвращает, сколько закрыто */
export async function logoutAll(store: Store, uid: number) {
  let n = 0;
  for (const [k, s] of await store.kvList<AdminSession>("sess:")) {
    if (s.uid === uid) {
      await store.kvSet(k, undefined);
      n++;
    }
  }
  return n;
}
