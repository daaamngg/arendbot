import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { ITEMS, PHONE } from "../shared/catalog.ts";
import { addDays, dayText, daysCount, daysOf, daysText, isDate, rangeText, rub, todaySamara } from "../shared/dates.ts";
import { PROMO, SPIN_COOLDOWN, activeDiscount, promoActive, promoEnd, spinReward } from "../shared/promo.ts";
import { PACKAGES, packageById } from "../shared/packages.ts";
import { DAYS_AHEAD, DELIVERY_PRICE, MAX_DAYS, type Booking, type Item, type User } from "../shared/types.ts";
import type { DocTable } from "./docs.ts";
import { verifyInitData, type VerifiedInit } from "./init-data.ts";
import type { Button, MaxApi, OutMessage } from "./max-api.ts";

// Вся логика бота аренды техники. Одинаково работает в dev-server.ts (локально) и в облачной функции (cloud.ts).
// Путь клиента: каталог → техника → дни в календаре → доставка или самовывоз → заявка.
// Владельцу (Сергею) приходит сообщение с кнопками «Принять / Отклонить»; принял — дни закрываются, клиенту ответ.

export interface Config {
  botToken: string;
  /** код владельца: «/admin <код>» боту — и человек становится владельцем (видит заявки, правит цены и календарь) */
  adminCode: string;
  webhookSecret: string;
  /** разработка: обычный браузер без MAX — тестовый человек (только локально, в облаке выключено) */
  allowBrowser: boolean;
  devUserId?: number;
  botUsername?: string;
  /** сколько часов владелец думает над заявкой днём */
  decideHours: number;
}
export interface Ctx {
  db: DocTable;
  max: MaxApi;
  config: Config;
  log: (s: string) => void;
  now?: () => number;
}
export interface Res {
  status: number;
  json: unknown;
}

const ok = (json: unknown): Res => ({ status: 200, json });
const fail = (status: number, error: string): Res => ({ status, json: { error } });
const now = (ctx: Ctx) => (ctx.now ? ctx.now() : Date.now());
const PHONE_RE = /^\+7\d{10}$/;
const HOLD: Booking["status"][] = ["requested", "confirmed"];

/** Текст от людей: без управляющих и невидимых символов, в одну строку — ещё и без < > { } ` */
const clean = (v: unknown, max: number, oneLine = false) => {
  if (typeof v !== "string") return "";
  let s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, "");
  if (oneLine) s = s.replace(/[\r\n\t]+/g, " ").replace(/[<>`{}\\]/g, "").replace(/ {2,}/g, " ");
  return s.trim().slice(0, max);
};
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Антиспам: не больше N действий в час на человека (в памяти копии сервера)
const hits = new Map<string, number[]>();
function limited(key: string, perHour: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < 3600_000);
  list.push(t);
  hits.set(key, list);
  if (hits.size > 20_000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3600_000) hits.delete(k);
  return list.length > perHour;
}

// --- кто пришёл -----------------------------------------------------------------------
function auth(ctx: Ctx, body: any): { init: VerifiedInit; uid: number } | Res {
  const initData = typeof body?.initData === "string" ? body.initData : "";
  if (initData) {
    const init = verifyInitData(initData, ctx.config.botToken, now(ctx));
    if (!init?.user?.id) return fail(401, "bad initData");
    return { init, uid: init.user.id };
  }
  if (ctx.config.allowBrowser && ctx.config.devUserId) {
    // Разработка: у браузера свой тестовый номер из отдельного диапазона — выдать себя за настоящего нельзя
    const n = Number(body?.demoUser);
    const id = Number.isInteger(n) && n >= 900_000_000 && n < 1_000_000_000 ? n : ctx.config.devUserId;
    return { init: { user: { id, first_name: "Тест" }, authDate: 0 }, uid: id };
  }
  return fail(401, "open from MAX");
}

async function userOf(ctx: Ctx, uid: number, init: VerifiedInit): Promise<User> {
  const name = clean(init.user?.first_name ?? "", 60, true) || null;
  const u = await ctx.db.get<User>("user", String(uid));
  if (u) {
    if (name && u.name !== name) await ctx.db.put({ kind: "user", id: String(uid), data: { ...u, name } });
    return { ...u, name: name ?? u.name };
  }
  const fresh: User = { id: uid, name, phone: null, consentAt: null, createdAt: now(ctx) };
  await ctx.db.put({ kind: "user", id: String(uid), data: fresh });
  return fresh;
}

const owners = async (ctx: Ctx) => (await ctx.db.get<number[]>("kv", "owners")) ?? [];
const isOwner = async (ctx: Ctx, uid: number) => (await owners(ctx)).includes(uid);
const canPreviewSpin = async (ctx: Ctx, uid: number) => (await ctx.db.get<number[]>("kv", "preview-spin-users"))?.includes(uid) ?? false;
/** Проверочную заявку видит только тот, кто её оставил; остальные заявки — все */
const visibleTo = (b: Booking, uid: number) => !b.test || b.clientId === uid;
/** Кому слать уведомление о заявке: обычная — всем владельцам, проверочная — только её автору */
const ownersFor = async (ctx: Ctx, b: Booking) => (b.test ? [b.clientId] : await owners(ctx));

// --- каталог, цены, занятость ----------------------------------------------------------
async function items(ctx: Ctx): Promise<Item[]> {
  const prices = new Map((await ctx.db.prefix<number | null>("price", "")).map(([id, p]) => [id, p]));
  return ITEMS.map((i) => (prices.has(i.id) ? { ...i, priceDay: prices.get(i.id) ?? null } : i));
}
const itemOf = async (ctx: Ctx, id: unknown) => {
  const list = await items(ctx);
  const pack = packageById(id);
  if (!pack) return list.find((i) => i.id === id);
  const included = pack.itemIds.map((x) => list.find((i) => i.id === x)!);
  return { ...included[0], id: pack.id, title: pack.title, short: pack.names.join(" · "), specs: [...pack.names], priceDay: included.every((i) => i.priceDay != null) ? included.reduce((sum, i) => sum + i.priceDay!, 0) : null };
};
const relatedIds = (id: string) => [id, ...PACKAGES.filter((p) => p.itemIds.some((x) => x === id)).map((p) => p.id)];
const bookingsFor = async (db: Pick<Ctx["db"], "find">, id: string) => (await Promise.all(relatedIds(id).map((x) => db.find<Booking>("booking", "g1", x)))).flat().filter((b) => b.itemId === id || b.itemIds?.includes(id));
const bookingRow = (b: Booking) => ({ kind: "booking", id: b.id, g1: b.itemId, g2: String(b.clientId), g3: b.status, data: b });
const saveBooking = (ctx: Ctx, b: Booking) => ctx.db.put(bookingRow(b));

/** Занятые дни техники: закрытые владельцем + дни заявок и подтверждённых аренд */
function busyDays(closed: string[], bookings: Booking[]): Set<string> {
  const s = new Set(closed);
  for (const b of bookings) if (HOLD.includes(b.status)) for (const d of daysOf(b.from, b.to)) s.add(d);
  return s;
}

/** Сумма: сутки × цена + доставка. Цена «по звонку» — суммы нет, доставку всё равно показываем */
/** Сумма: сутки × цена (минус скидка по акции) + доставка. Скидка — только на аренду, не на доставку */
const totalOf = (priceDay: number | null, days: number, delivery: boolean, discount = 0) =>
  priceDay == null ? null : Math.round((priceDay * days * (100 - discount)) / 100) + (delivery ? DELIVERY_PRICE : 0);
const ACTIVE: Booking["status"][] = ["requested", "confirmed"];

/** Срок ответа владельца: днём decideHours часов, а если выпал на ночь (22–8 по Самаре) — до 11 утра */
export function decideDeadline(createdAt: number, hours: number) {
  const due = createdAt + hours * 3600_000;
  const h = new Date(due + 4 * 3600_000).getUTCHours();
  if (h >= 22 || h < 8) return Date.parse(`${h >= 22 ? addDays(todaySamara(due), 1) : todaySamara(due)}T11:00:00+04:00`);
  return due;
}

// --- сообщения ----------------------------------------------------------------------------
const appButton = (ctx: Ctx, text: string, param = ""): Button[][] | undefined =>
  ctx.config.botUsername ? [[{ type: "link", text, url: `https://max.ru/${ctx.config.botUsername}?startapp${param ? `=${param}` : ""}` }]] : undefined;
async function send(ctx: Ctx, to: number, msg: OutMessage) {
  try {
    return await ctx.max.send(to, msg);
  } catch (e) {
    ctx.log(`не отправилось ${to}: ${(e as Error).message}`);
    return null;
  }
}
const money = (b: Booking) => (b.total != null ? rub(b.total) : `цена по звонку${b.delivery ? ` + доставка ${rub(DELIVERY_PRICE)}` : ""}`);
const requestText = (b: Booking, item: string) =>
  [
    `Заявка на аренду: ${item}`,
    ...(b.itemIds ? [`Состав пакета: ${b.itemIds.map((id) => ITEMS.find((i) => i.id === id)?.title ?? id).join(", ")}`] : []),
    `${rangeText(b.from, b.to)}, ${daysText(b.days)}`,
    b.delivery ? `Доставка по городу: ${b.address || "адрес не указан"}` : "Самовывоз",
    `Сумма: ${money(b)}`,
    ...(b.discount ? [`Акция: скидка ${b.discount}% на первую аренду (уже в сумме)`] : []),
    `Клиент: ${b.clientName ?? "без имени"}, ${b.phone}`,
    ...(b.comment ? [`Комментарий: ${b.comment}`] : []),
  ].join("\n");

/** Решение владельца по заявке: принять (дни закрываются) или отклонить. Строка — ответ для кнопки */
async function decide(ctx: Ctx, b: Booking, accept: boolean): Promise<string> {
  if (b.status !== "requested") return "На эту заявку уже ответили.";
  // Одновременно «Принять» в чате и в приложении — сработает только первое
  if (await seenOnce(ctx, `bk:${b.id}:left-requested`)) return "На эту заявку уже ответили.";
  b.status = accept ? "confirmed" : "declined";
  await saveBooking(ctx, b);
  const item = (await itemOf(ctx, b.itemId))?.title ?? "оборудование";
  for (const mid of (await ctx.db.get<string[]>("kv", `msgs:${b.id}`)) ?? []) await ctx.max.edit(mid, { text: `${requestText(b, item)}\n\n${accept ? "Принята" : "Отклонена"}` }).catch(() => {});
  await send(ctx, b.clientId, {
    text: accept
      ? `Аренда подтверждена: ${item}, ${rangeText(b.from, b.to)}. Сумма: ${money(b)}. Вопросы — по телефону ${PHONE}.`
      : `К сожалению, ${item} на ${rangeText(b.from, b.to)} не получится. Выберите другие дни или позвоните: ${PHONE}.`,
    buttons: appButton(ctx, accept ? "Мои заявки" : "Выбрать другие дни"),
  });
  return accept ? "Принята, клиенту отправлено подтверждение." : "Отклонена, клиенту отправлен ответ.";
}

/** Отметка «уже было» одной неделимой операцией: второй одновременный запрос видит её и ничего не делает */
const seenOnce = (ctx: Ctx, key: string) =>
  ctx.db.tx(async (t) => {
    if (await t.get("mark", key)) return true;
    await t.put({ kind: "mark", id: key, data: now(ctx) });
    return false;
  });

const view = async (ctx: Ctx, b: Booking) => ({ ...b, title: (await itemOf(ctx, b.itemId))?.title ?? "Оборудование" });

// --- API мини-приложения ---------------------------------------------------------------
export async function handleApi(ctx: Ctx, path: string, body: any): Promise<Res> {
  const a = auth(ctx, body);
  if ("status" in a) return a;
  const { init, uid } = a;
  const t = now(ctx);
  const today = todaySamara(t);
  const user = await userOf(ctx, uid, init);

  switch (path) {
    case "/me":
      return ok({
        user: { id: uid, name: user.name, phone: user.phone },
        owner: await isOwner(ctx, uid),
        previewAllowed: await canPreviewSpin(ctx, uid),
        demo: ctx.config.allowBrowser,
        promoAt: user.promoAt ?? null,
        spinAt: user.spinAt ?? null,
        spinPercent: user.spinPercent ?? null,
        spinExpiresAt: user.spinExpiresAt ?? null,
        // скидка — только на первую аренду: есть живая заявка или аренда — уже не положена
        promoUsed: (await ctx.db.find<Booking>("booking", "g2", String(uid))).some((b) => ACTIVE.includes(b.status)),
      });

    case "/promo/open": {
      // Время открытия ставится один раз и больше не меняется — таймер не перезапустить
      if (user.promoAt) return ok({ promoAt: user.promoAt });
      await ctx.db.put({ kind: "user", id: String(uid), data: { ...user, promoAt: t } });
      return ok({ promoAt: t });
    }

    case "/spin": {
      const reward = await ctx.db.tx(async (tx) => {
        const current = (await tx.get<User>("user", String(uid))) ?? user;
        if (current.spinAt && t < current.spinAt + SPIN_COOLDOWN) return null;
        const bookings = await tx.find<Booking>("booking", "g2", String(uid));
        const starter = promoActive(current.promoAt, t) && !bookings.some((b) => ACTIVE.includes(b.status));
        const percent = starter ? 5 : spinReward(randomInt(100));
        const expiresAt = starter ? promoEnd(current.promoAt!) : t + SPIN_COOLDOWN;
        await tx.put({ kind: "user", id: String(uid), data: { ...current, spinAt: t, spinPercent: percent, spinExpiresAt: expiresAt } });
        return { spinAt: t, spinPercent: percent, spinExpiresAt: expiresAt };
      });
      return reward ? ok(reward) : fail(409, "spin cooldown");
    }

    case "/spin/preview":
      if (!(await canPreviewSpin(ctx, uid))) return fail(403, "forbidden");
      return ok({ spinPercent: spinReward(randomInt(100)) });

    case "/items":
      return ok({ items: await items(ctx), delivery: DELIVERY_PRICE });

    case "/item": {
      const item = await itemOf(ctx, body?.id);
      if (!item) return fail(404, "not found");
      const ids = packageById(item.id)?.itemIds ?? [item.id];
      const busy = [...new Set((await Promise.all(ids.map(async (id) => busyDays((await ctx.db.get<string[]>("closed", id)) ?? [], (await bookingsFor(ctx.db, id)).filter((b) => visibleTo(b, uid)))))).flatMap((s) => [...s]))].filter((d) => d >= today).sort();
      return ok({ item, busy, delivery: DELIVERY_PRICE });
    }

    case "/phone": {
      if (body?.consent !== true) return fail(400, "consent required");
      const phone = clean(body?.phone, 16, true);
      if (!PHONE_RE.test(phone)) return fail(400, "bad phone");
      if (limited(`ph:${uid}`, 10)) return fail(429, "too many");
      await ctx.db.put({ kind: "user", id: String(uid), data: { ...user, phone, consentAt: t } });
      return ok({ ok: true });
    }

    case "/book": {
      if (!user.phone || !user.consentAt) return fail(400, "phone required");
      if (limited(`bk:${uid}`, 10)) return fail(429, "too many");
      const item = await itemOf(ctx, body?.itemId);
      if (!item) return fail(404, "not found");
      const from = body?.from;
      const to = body?.to;
      if (!isDate(from) || !isDate(to) || to < from || from < today || from > addDays(today, DAYS_AHEAD)) return fail(400, "bad dates");
      const days = daysCount(from, to);
      if (days > MAX_DAYS) return fail(400, "too long");
      const all = await ctx.db.find<Booking>("booking", "g2", String(uid));
      const mine = all.filter((b) => b.status === "requested");
      if (mine.length >= 3) return fail(409, "too many requests");
      const delivery = body?.delivery === true;
      const address = delivery ? clean(body?.address, 200, true) : "";
      if (delivery && address.length < 5) return fail(400, "address required");
      // Акция: подарок открыт и не сгорел, аренда от minDays суток и это первая аренда человека
      const promoUsed = all.some((x) => ACTIVE.includes(x.status));
      const discount = activeDiscount(user.promoAt, promoUsed, user.spinPercent, user.spinExpiresAt, t, days);
      const b: Booking = {
        id: randomUUID().slice(0, 8),
        itemId: item.id,
        ...(packageById(item.id) ? { itemIds: [...packageById(item.id)!.itemIds] } : {}),
        clientId: uid,
        clientName: user.name,
        phone: user.phone,
        from,
        to,
        days,
        delivery,
        address,
        comment: clean(body?.comment, 500),
        priceDay: item.priceDay,
        total: totalOf(item.priceDay, days, delivery, discount),
        discount,
        // Владелец оставил заявку сам себе — это проверка: её не увидят другие и она не займёт дни для клиентов
        ...((await isOwner(ctx, uid)) ? { test: true } : {}),
        status: "requested",
        createdAt: t,
        decideBy: decideDeadline(t, ctx.config.decideHours),
      };
      // Проверка дней и запись — одной транзакцией: две заявки на одни дни не пройдут обе
      const created = await ctx.db.tx(async (tx) => {
        for (const id of b.itemIds ?? [item.id]) {
          const closed = (await tx.get<string[]>("closed", id)) ?? [];
          const busy = busyDays(closed, (await bookingsFor(tx, id)).filter((x) => visibleTo(x, uid)));
          if (daysOf(from, to).some((d) => busy.has(d))) return false;
        }
        await tx.put(bookingRow(b));
        return true;
      });
      if (!created) return fail(409, "busy");
      const mids: string[] = [];
      for (const o of await ownersFor(ctx, b)) {
        const mid = await send(ctx, o, {
          text: requestText(b, item.title),
          buttons: [
            [
              { type: "callback", text: "Принять", payload: `bk:ok:${b.id}` },
              { type: "callback", text: "Отклонить", payload: `bk:no:${b.id}` },
            ],
          ],
        });
        if (mid) mids.push(mid);
      }
      await ctx.db.put({ kind: "kv", id: `msgs:${b.id}`, data: mids });
      return ok({ booking: await view(ctx, b) });
    }

    case "/my": {
      const list = (await ctx.db.find<Booking>("booking", "g2", String(uid))).sort((x, y) => y.createdAt - x.createdAt).slice(0, 50);
      return ok({ bookings: await Promise.all(list.map((b) => view(ctx, b))) });
    }

    case "/cancel": {
      // Клиент отменяет свою заявку или аренду до её начала
      const b = await ctx.db.get<Booking>("booking", clean(body?.id, 16, true));
      if (!b || b.clientId !== uid) return fail(404, "not found");
      if (!HOLD.includes(b.status) || b.from < today) return fail(400, "cannot cancel");
      if (await seenOnce(ctx, `bk:${b.id}:left-${b.status}`)) return fail(409, "already");
      b.status = "cancelled";
      await saveBooking(ctx, b);
      const item = (await itemOf(ctx, b.itemId))?.title ?? "оборудование";
      for (const o of await ownersFor(ctx, b)) await send(ctx, o, { text: `Клиент отменил аренду: ${item}, ${rangeText(b.from, b.to)}. Дни снова свободны.` });
      return ok({ ok: true });
    }

    // --- владелец ---------------------------------------------------------------------
    case "/owner/bookings": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const all = await ctx.db.all<Booking>("booking");
      const list = all.filter((b) => visibleTo(b, uid) && !b.hidden && (b.status === "requested" || (b.status === "confirmed" && b.to >= addDays(today, -7)))).sort((x, y) => (x.from < y.from ? -1 : 1));
      return ok({ bookings: await Promise.all(list.map((b) => view(ctx, b))) });
    }
    case "/owner/decide": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const b = await ctx.db.get<Booking>("booking", clean(body?.id, 16, true));
      if (!b || !visibleTo(b, uid)) return fail(404, "not found");
      return ok({ message: await decide(ctx, b, body?.accept === true) });
    }
    case "/owner/hide": {
      // Аренда закончилась — убрать из списка владельца
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const b = await ctx.db.get<Booking>("booking", clean(body?.id, 16, true));
      if (!b || !visibleTo(b, uid)) return fail(404, "not found");
      if (b.status === "requested" || (b.status === "confirmed" && b.to >= today)) return fail(400, "active");
      await saveBooking(ctx, { ...b, hidden: true });
      return ok({ ok: true });
    }
    case "/owner/calendar": {
      // Владелец закрывает или открывает дни (техника на ремонте, занята своими работами)
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const item = await itemOf(ctx, body?.itemId);
      if (!item) return fail(404, "not found");
      const close = (Array.isArray(body?.close) ? body.close : []).filter(isDate).slice(0, 400);
      const open = new Set((Array.isArray(body?.open) ? body.open : []).filter(isDate));
      const closed = await ctx.db.tx(async (tx) => {
        const cur = (await tx.get<string[]>("closed", item.id)) ?? [];
        const next = [...new Set([...cur, ...close])].filter((d) => d >= today && !open.has(d)).sort().slice(0, 400);
        await tx.put({ kind: "closed", id: item.id, data: next });
        return next;
      });
      const bookings = (await bookingsFor(ctx.db, item.id)).filter((b) => HOLD.includes(b.status) && visibleTo(b, uid));
      return ok({ closed, booked: [...busyDays([], bookings)].sort() });
    }
    case "/owner/price": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const item = await itemOf(ctx, body?.id);
      if (!item) return fail(404, "not found");
      const p = body?.priceDay === null || body?.priceDay === "" ? null : Math.round(Number(body?.priceDay));
      if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1_000_000)) return fail(400, "bad price");
      await ctx.db.put({ kind: "price", id: item.id, data: p });
      return ok({ item: { ...item, priceDay: p } });
    }
  }
  return fail(404, "unknown");
}

// --- бот в MAX ----------------------------------------------------------------------------
export async function handleWebhook(ctx: Ctx, secret: string | undefined, update: any): Promise<Res> {
  if (!ctx.config.webhookSecret || !secret || !safeEq(secret, ctx.config.webhookSecret)) return fail(401, "bad secret");
  await processUpdate(ctx, update);
  return ok({ ok: true });
}

export async function processUpdate(ctx: Ctx, update: any) {
  const type = update?.update_type;
  const hello = (uid: number) =>
    send(ctx, uid, {
      text: "Здравствуйте! Это аренда оборудования «Домашний эксперт» в Самаре и области: моющие и строительные пылесосы Kärcher, пароочистители, мойщики окон, озонатор, отбойный молоток, перфоратор, дрели и болгарки. Оплата за сутки, доставка по городу 500 ₽. Выберите оборудование и свободные дни в приложении.",
      buttons: appButton(ctx, "Выбрать оборудование"),
    });
  if (type === "bot_started" && update?.user?.user_id) return void (await hello(update.user.user_id));

  if (type === "message_created") {
    const uid: number | undefined = update?.message?.sender?.user_id;
    const text: string = (update?.message?.body?.text ?? "").trim();
    if (!uid) return;
    // «/выйти» — перестать быть владельцем (например, Арслан после проверок): заявки клиентов больше не приходят
    if (/^\/(выйти|leave)$/i.test(text)) {
      const list = await owners(ctx);
      if (!list.includes(uid)) return void (await send(ctx, uid, { text: "Вы и так не владелец." }));
      await ctx.db.put({ kind: "kv", id: "owners", data: list.filter((x) => x !== uid) });
      return void (await send(ctx, uid, { text: "Готово: вы больше не владелец. Заявки клиентов сюда не придут. Вернуться можно тем же кодом." }));
    }
    const code = text.match(/^\/admin\s+(\S+)$/i)?.[1];
    if (code) {
      // Не больше 5 попыток в час — код не перебрать
      if (limited(`code:${uid}`, 5)) return;
      if (!ctx.config.adminCode || !safeEq(code, ctx.config.adminCode)) return void (await send(ctx, uid, { text: "Код не подходит." }));
      const list = await owners(ctx);
      // Код мог утечь — остальным владельцам сразу сообщение
      if (!list.includes(uid)) for (const o of list) await send(ctx, o, { text: `Новый владелец по коду: MAX ${uid}. Если это не ваш человек — срочно смените код.` });
      await ctx.db.put({ kind: "kv", id: "owners", data: [...new Set([...list, uid])] });
      return void (await send(ctx, uid, { text: "Готово: вы владелец. Заявки на аренду будут приходить сюда с кнопками «Принять / Отклонить». Цены и календарь — в приложении, вкладка «Управление».", buttons: appButton(ctx, "Открыть управление", "owner") }));
    }
    return void (await hello(uid));
  }

  if (type === "message_callback") {
    const cb = update?.callback;
    const uid: number | undefined = cb?.user?.user_id;
    const [kind, action, id] = String(cb?.payload ?? "").split(":");
    const answer = (n: string) => ctx.max.answerCallback(cb?.callback_id, n).catch(() => {});
    if (!uid || kind !== "bk") return;
    if (!(await isOwner(ctx, uid))) return answer("Нет прав.");
    const b = await ctx.db.get<Booking>("booking", id ?? "");
    if (!b || !visibleTo(b, uid)) return answer("Заявка не найдена.");
    return answer(await decide(ctx, b, action === "ok"));
  }
}

// --- таймер: раз в минуту ---------------------------------------------------------------
export async function sweep(ctx: Ctx) {
  const t = now(ctx);
  const tomorrow = addDays(todaySamara(t), 1);
  for (const b of await ctx.db.all<Booking>("booking")) {
    try {
      // Владелец не ответил вовремя — заявка отменяется, дни освобождаются
      if (b.status === "requested" && t > b.decideBy) {
        if (await seenOnce(ctx, `bk:${b.id}:left-requested`)) continue;
        await saveBooking(ctx, { ...b, status: "expired" });
        await send(ctx, b.clientId, { text: `Владелец не успел ответить на заявку (${rangeText(b.from, b.to)}). Позвоните, договоримся быстрее: ${PHONE}.` });
        continue;
      }
      // За день до начала — напоминание клиенту и владельцу
      if (b.status === "confirmed" && b.from === tomorrow && !b.reminded) {
        await saveBooking(ctx, { ...b, reminded: true });
        const item = (await itemOf(ctx, b.itemId))?.title ?? "оборудование";
        await send(ctx, b.clientId, { text: `Напоминаем: завтра, ${dayText(b.from)}, аренда — ${item}${b.delivery ? `, доставка: ${b.address}` : ", самовывоз"}. Телефон: ${PHONE}.` });
        for (const o of await ownersFor(ctx, b)) await send(ctx, o, { text: `Завтра аренда: ${item}, ${rangeText(b.from, b.to)}. ${b.delivery ? `Доставка: ${b.address}` : "Самовывоз"}. Клиент ${b.clientName ?? ""} ${b.phone}.` });
      }
    } catch (e) {
      ctx.log(`таймер ${b.id}: ${(e as Error).message}`);
    }
  }
}
