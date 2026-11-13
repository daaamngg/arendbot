import { randomUUID, timingSafeEqual } from "node:crypto";
import { AMENITIES, DISTRICTS, LOCALITIES, MAX_PHOTOS, fullAddress, listingTitle, missingForSubmit } from "../shared/catalog.ts";
import { addDays, busyNights, checkRange, isDate, price, todaySamara } from "../shared/dates.ts";
import { autoCheck, hostHints } from "../shared/auto-check.ts";
import { checkContact } from "./contact-check.ts";
import { hasContacts, maskContacts, suspicion } from "../shared/trust.ts";
import {
  CANCEL_OPTIONS,
  COMPLAINT_REASONS,
  BOOKING_LIMITS,
  HOLDING,
  PLACE_TYPES,
  type Booking,
  type ChatThread,
  type HostStatus,
  type Complaint,
  type Listing,
  type ListingCard,
  type Photo,
  type PublicListing,
  type Review,
  type User,
} from "../shared/types.ts";
import {
  REJECT_REASONS,
  cancelledToOther,
  chatNotify,
  complaintToAdmins,
  hostAppToAdmins,
  hostDecisionToUser,
  confirmedToGuest,
  heldToOwner,
  moderatedToOwner,
  notConfirmedToGuest,
  publishedToOwner,
  reminder,
  requestDecided,
  requestToOwner,
  reviewAsk,
  toModerator,
} from "./format.ts";
import { verifyInitData, type VerifiedInit } from "./init-data.ts";
import type { Button, MaxApi, OutMessage } from "./max-api.ts";
import type { Store } from "./store.ts";

// Вся логика сервера: одинаково работает в dev-server.ts (локально) и в облачной функции.

export interface Config {
  botToken: string;
  /** код для команды боту «/admin <код>» — так Сергей становится модератором */
  adminCode: string;
  /** секрет вебхука MAX (заголовок X-Max-Bot-Api-Secret) */
  webhookSecret: string;
  /** разрешить запросы из обычного браузера без initData (только разработка: тогда пользователь — devUserId) */
  allowBrowser: boolean;
  devUserId?: number;
  /** ник бота — для кнопок-ссылок max.ru/<ник>?startapp */
  botUsername?: string;
  /** сколько часов хозяин думает над запросом (днём) */
  decideHours: number;
  /**
   * post — объявление сразу в поиске, модератор смотрит после (подозрительные всё равно ждут проверки);
   * pre — сначала проверка, потом поиск
   */
  moderation: "post" | "pre";
  /** демо-версия (Vercel): без токена бота, каждый открывший — тестовый пользователь devUserId */
  demo?: boolean;
  /** адрес отдельной админки — больше не используется (админка внутри мини-приложения) */
  adminUrl?: string;
  /** код модераторов (главный может сменить его в админке — тогда действует новый) */
  modCode?: string;
}

export interface Ctx {
  store: Store;
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
const fail = (status: number, error: string, extra: object = {}): Res => ({ status, json: { error, ...extra } });
const now = (ctx: Ctx) => (ctx.now ? ctx.now() : Date.now());

// --- мелочи ----------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const intOrNull = (v: unknown, min: number, max: number) => (v === null || v === "" || v === undefined ? null : int(v, min, max, min));
const PHONE_RE = /^\+7\d{10}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Простой антиспам: не больше N действий в час на человека (в памяти процесса)
const hits = new Map<string, number[]>();
function limited(key: string, perHour: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < 3600_000);
  list.push(t);
  hits.set(key, list);
  // Чистим старые записи, чтобы память не росла, пока копия сервера живёт долго
  if (hits.size > 20_000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3600_000) hits.delete(k);
  return list.length > perHour;
}

/** Номер тестового человека из браузера: только из отдельного диапазона, чтобы не выдать себя за настоящего из MAX */
const demoId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 900_000_000 && n < 1_000_000_000 ? n : null;
};

function auth(ctx: Ctx, body: any): { init: VerifiedInit; uid: number } | Res {
  // Демо: подпись MAX не проверяем (токена нет), все — один тестовый пользователь
  if (ctx.config.demo && ctx.config.devUserId) {
    // Демо: у каждого браузера свой тестовый человек (номер из приложения). Админку получают только по коду
    const id = demoId(body?.demoUser) ?? ctx.config.devUserId;
    return { init: { user: { id, first_name: "Демо" }, authDate: 0 }, uid: id };
  }
  const initData = typeof body?.initData === "string" ? body.initData : "";
  if (initData) {
    const init = verifyInitData(initData, ctx.config.botToken, now(ctx));
    if (!init?.user?.id) return fail(401, "bad initData");
    return { init, uid: init.user.id };
  }
  if (ctx.config.allowBrowser && ctx.config.devUserId) {
    const id = demoId(body?.demoUser) ?? ctx.config.devUserId;
    return { init: { user: { id, first_name: "Разработчик" }, authDate: 0 }, uid: id };
  }
  return fail(401, "open from MAX");
}

async function userOf(ctx: Ctx, uid: number, init?: VerifiedInit): Promise<User> {
  const u = await ctx.store.getUser(uid);
  if (u) {
    // Имя в MAX могло поменяться — держим свежее
    if (init?.user?.first_name && u.name !== init.user.first_name) {
      u.name = init.user.first_name;
      await ctx.store.saveUser(u);
    }
    return u;
  }
  const fresh: User = { id: uid, name: init?.user?.first_name ?? null, phone: null, consentAt: null, createdAt: now(ctx) };
  await ctx.store.saveUser(fresh);
  return fresh;
}

/** Действующий код модераторов: сменённый главным, иначе из настроек */
const modCodeOf = async (ctx: Ctx) => (await ctx.store.kvGet<string>("modcode")) ?? ctx.config.modCode ?? "";

/**
 * Человек прислал код (боту или, в демо, в приложение). Как в калькуляторе: прислал верный пароль — открылась админка.
 * Код главного — полный доступ; код модераторов — проверка объявлений, заявок и жалоб.
 * null — код неверный (попытка записана), строка — что ответить
 */
async function tryCode(ctx: Ctx, uid: number, name: string | null, code: string): Promise<{ role: "owner" | "moderator" } | null> {
  const ownerCode = ctx.config.adminCode;
  const modCode = await modCodeOf(ctx);
  const staff = await ctx.store.getStaff();
  const t = now(ctx);
  if (ownerCode && safeEq(code, ownerCode)) {
    await ctx.store.saveStaff([...staff.filter((x) => x.id !== uid), { id: uid, role: "owner", addedBy: null, addedAt: t }]);
    await audit(ctx, uid, "вошёл как главный по коду", `${name ?? "без имени"} (${uid})`);
    return { role: "owner" };
  }
  if (modCode && safeEq(code, modCode)) {
    const was = staff.find((x) => x.id === uid);
    // Главный, приславший код модераторов, остаётся главным
    if (was?.role === "owner") return { role: "owner" };
    if (!was) await ctx.store.saveStaff([...staff, { id: uid, role: "moderator", addedBy: null, addedAt: t }]);
    await audit(ctx, uid, "вошёл как модератор по коду", `${name ?? "без имени"} (${uid})`);
    // Главным — сразу сообщение: если код утёк, увидят чужого и уберут, а код сменят
    if (!was) for (const o of staff.filter((x) => x.role === "owner")) await send(ctx, o.id, { text: `Новый модератор по коду: ${name ?? "без имени"} (MAX ${uid}). Если это не ваш человек — уберите его в админке («Команда») и смените код модераторов.` });
    return { role: "moderator" };
  }
  await audit(ctx, uid, "неверный код команды", `${name ?? "без имени"} (${uid})`);
  return null;
}

/** Кто в команде площадки: модератор или главный */
const isAdmin = async (ctx: Ctx, uid: number) => (await ctx.store.getAdmins()).includes(uid);
/** Главный (Сергей): назначает и снимает модераторов */
const isOwner = async (ctx: Ctx, uid: number) => (await ctx.store.getStaff()).some((m) => m.id === uid && m.role === "owner");

/**
 * Может ли человек размещать объявления: заявка одобрена модератором.
 * У кого объявления появились до заявок (старые хозяева) — считаются одобренными
 */
async function hostStatusOf(ctx: Ctx, u: User): Promise<HostStatus> {
  if (u.hostStatus === "approved") return "approved";
  if ((await ctx.store.listListings({ ownerId: u.id })).length) return "approved";
  return u.hostStatus ?? "none";
}

/** Запись в журнал действий команды */
const audit = (ctx: Ctx, by: number, action: string, target: string, note?: string) =>
  ctx.store.addAudit({ at: now(ctx), by, action, target, ...(note ? { note } : {}) });

const appButton = (ctx: Ctx, text: string, param = ""): Button[][] | undefined =>
  ctx.config.botUsername
    ? [[{ type: "link", text, url: `https://max.ru/${ctx.config.botUsername}?startapp${param ? `=${param}` : ""}` }]]
    : undefined;

async function send(ctx: Ctx, uid: number, msg: OutMessage, key?: string) {
  try {
    const mid = await ctx.max.send(uid, msg);
    if (mid && key) await ctx.store.addMessageId(key, mid);
    return mid;
  } catch (e) {
    ctx.log(`Не отправилось ${uid}: ${(e as Error).message}`);
    return null;
  }
}

async function editAll(ctx: Ctx, key: string, msg: OutMessage) {
  for (const mid of await ctx.store.getMessageIds(key)) {
    await ctx.max.edit(mid, msg).catch((e) => ctx.log(`edit ${mid}: ${(e as Error).message}`));
  }
}

async function notifyAdmins(ctx: Ctx, msg: OutMessage, key?: string) {
  const admins = await ctx.store.getAdmins();
  // Без текста сообщения: в нём бывают имена и телефоны, а логи в облаке хранятся
  if (!admins.length) ctx.log("Нет модераторов: отправьте боту код главного. Сообщение для команды не доставлено");
  for (const a of admins) await send(ctx, a, msg, key);
}

/**
 * До какого времени хозяин должен ответить. Днём — decideHours часов.
 * Ночью (с 22 до 8 по Самаре) никто не отвечает, поэтому срок — до 11 утра
 */
export function decideDeadline(createdAt: number, hours: number) {
  // Срок выпал на ночь (запрос ночью или поздно вечером) — переносим на 11 утра
  const due = createdAt + hours * 3600_000;
  const samaraHour = new Date(due + 4 * 3600_000).getUTCHours();
  if (samaraHour >= 22 || samaraHour < 8) {
    const day = samaraHour >= 22 ? addDays(todaySamara(due), 1) : todaySamara(due);
    return Date.parse(`${day}T11:00:00+04:00`);
  }
  return due;
}

// --- объявления: что видит гость ----------------------------------------------

const starsOf = (l: Listing) => (l.rating?.count ? Math.round((l.rating.sum / l.rating.count) * 10) / 10 : null);

function card(l: Listing, range?: { checkIn: string; checkOut: string }): ListingCard {
  const p = range ? price(l, range.checkIn, range.checkOut) : null;
  return {
    stars: starsOf(l),
    reviews: l.rating?.count ?? 0,
    createdAt: l.createdAt,
    id: l.id,
    type: l.type,
    title: listingTitle(l),
    locality: l.locality,
    district: l.district,
    address: l.address,
    guests: l.guests,
    rooms: l.rooms,
    area: l.area,
    priceFrom: Math.min(l.priceWeekday, l.priceWeekend),
    photo: l.photos[0]?.url ?? null,
    total: p?.total ?? null,
    nights: p?.nights ?? null,
  };
}

function publicListing(l: Listing, bookings: Booking[], reviews: Review[], favorite: boolean, t: number): PublicListing {
  const { flat: _a, ownerId: _o, closed: _c, moderatorNote: _m, checked: _ch, botChecked: _bc, botReasons: _br, approvedPrice: _ap, showPhone: _sp, ...rest } = l;
  const from = todaySamara(t);
  const to = addDays(from, 120);
  const busy = [...busyNights(l, bookings)].filter((d) => d >= from && d < to).sort();
  return {
    ...rest,
    title: listingTitle(l),
    busy,
    stars: starsOf(l),
    // Отзывы без id гостя — только имя, как в MAX
    reviewList: reviews.slice(0, 20).map((r) => ({ id: r.id, guestName: r.guestName, stars: r.stars, text: r.text, createdAt: r.createdAt })),
    favorite,
    // Номер подставляет маршрут /listing, если хозяин разрешил; по умолчанию его нет
    hostPhone: null,
  };
}

/**
 * Опубликовать или отправить на проверку — после отправки хозяином и после правок содержимого.
 * Возвращает, ушло ли объявление сразу в поиск
 */
async function publishOrHold(ctx: Ctx, l: Listing, ownerPhone: string | null, again: boolean) {
  // Автопроверка ботом: объявление, хозяин, цена против похожих, копии чужих объявлений
  const [owner, all, complaints] = await Promise.all([ctx.store.getUser(l.ownerId), ctx.store.listListings(), ctx.store.listComplaints()]);
  const phoneTwins = owner?.phone ? (await ctx.store.listUsersByPhone(owner.phone)).filter((u) => u.id !== owner.id) : [];
  const held = autoCheck({ listing: l, owner, all, complaints, phoneTwins, now: now(ctx) });
  const live = ctx.config.moderation === "post" && held.length === 0;
  l.status = live ? "active" : "pending";
  // Бот не нашёл замечаний — объявление сразу в поиске и модератору его смотреть не нужно
  l.checked = live;
  l.botChecked = live;
  l.botReasons = held.length ? held : undefined;
  if (live) l.approvedPrice = Math.min(l.priceWeekday, l.priceWeekend);
  await ctx.store.saveListing(l);
  if (live) await audit(ctx, BOT_ID, again ? "бот одобрил изменения" : "бот одобрил объявление", `${listingTitle(l)} (${l.id})`);
  // Модератору пишем только когда нужна его проверка
  else await notifyAdmins(ctx, toModerator(l, ownerPhone, again, false, held), `l-${l.id}`);
  return live;
}

/** Подсказки бота к заявке «хочу сдавать» */
async function hostHintsOf(ctx: Ctx, u: User) {
  const [twins, asGuest, complaints] = await Promise.all([
    u.phone ? ctx.store.listUsersByPhone(u.phone) : Promise.resolve([] as User[]),
    ctx.store.listBookings({ guestId: u.id }),
    ctx.store.listComplaints(),
  ]);
  return hostHints({ user: u, phoneTwins: twins.filter((x) => x.id !== u.id), asGuest, complaintsByUser: complaints.filter((c) => c.userId === u.id).length, now: now(ctx) });
}

/** Ширина и высота JPEG из заголовка (маркер SOF) — без библиотек. Не нашли — пусто */
function jpegSize(b: Buffer): { w?: number; h?: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return {};
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return {};
}

/** «Кто сделал» в журнале для решений автопроверки */
const BOT_ID = 0;

// --- переписка гостя с хозяином ---------------------------------------------------

/**
 * Сообщение в переписку: прячем контакты, сохраняем, второй стороне — уведомление от бота,
 * на которое можно ответить прямо в чате MAX. Возвращает сохранённый текст или ошибку
 */
async function postChat(ctx: Ctx, th: ChatThread, from: "guest" | "owner", raw: string, key = ""): Promise<{ text: string; masked: boolean } | string> {
  const sender = from === "guest" ? th.guestId : th.ownerId;
  const clean = raw.trim().slice(0, 1000);
  if (!clean) return "empty";
  // Связь мигнула и приложение отправило то же сообщение ещё раз — второй копии не будет
  if (key) {
    const dup = (await ctx.store.listChatMessages(th.id, 30)).find((m) => m.clientKey === key);
    if (dup) return { text: dup.text, masked: dup.text !== clean };
  }
  if (limited(`chat:${sender}`, 40)) return "too many";
  const l = await ctx.store.getListing(th.listingId);
  if (!l || l.status === "blocked") return "not found";
  // Собеседника заблокировали (обман) — переписка закрыта, писать ему нельзя
  if ((await ctx.store.getUser(from === "guest" ? th.ownerId : th.guestId))?.blocked) return "not found";
  const { text, masked } = maskContacts(clean);
  const t = now(ctx);
  const msgId = randomUUID().slice(0, 8);
  await ctx.store.addChatMessage({ id: msgId, threadId: th.id, from, text, createdAt: t, ...(key ? { clientKey: key } : {}) });
  th.updatedAt = t;
  th.lastText = text.slice(0, 120);
  if (from === "guest") th.unreadOwner += 1;
  else th.unreadGuest += 1;
  await ctx.store.saveThread(th);
  const to = from === "guest" ? th.ownerId : th.guestId;
  const toOwner = from === "guest";
  // Не засыпаем уведомлениями: если человек не прочитал прошлое, а будили меньше 2 минут назад — молчим.
  // Сообщение всё равно сохранено и видно в приложении
  const lastWake = toOwner ? th.notifiedOwnerAt : th.notifiedGuestAt;
  const unreadBefore = (toOwner ? th.unreadOwner : th.unreadGuest) - 1;
  if (!(unreadBefore > 0 && lastWake && t - lastWake < 120_000)) {
    const guest = toOwner ? await ctx.store.getUser(th.guestId) : undefined;
    const mid = await send(ctx, to, chatNotify(l, from, text, guest?.name ?? null, appButton(ctx, "Открыть переписку", `chat_${th.id}`)));
    // Запомнить, каким сообщением бота разбудили собеседника — если автор удалит, поправим и его
    if (mid) await ctx.store.kvSet(`cmid:${msgId}`, mid);
    // Ответ на это уведомление в чате MAX уйдёт в эту же переписку от имени получателя
    if (mid) await ctx.store.setReplyTarget(mid, { threadId: th.id, as: toOwner ? "owner" : "guest" });
    if (toOwner) th.notifiedOwnerAt = t;
    else th.notifiedGuestAt = t;
    await ctx.store.saveThread(th);
  }
  return { text, masked };
}

/** Сообщения переписки глазами одной стороны: без очищенной ею истории, удалённые — без текста */
async function messagesFor(ctx: Ctx, th: ChatThread, uid: number) {
  const cleared = (th.ownerId === uid ? th.clearedOwnerAt : th.clearedGuestAt) ?? 0;
  return (await ctx.store.listChatMessages(th.id))
    .filter((m) => m.createdAt > cleared)
    .map((m) => ({ id: m.id, from: m.from, createdAt: m.createdAt, text: m.deletedAt ? "" : m.text, deleted: !!m.deletedAt }));
}

async function threadView(ctx: Ctx, th: ChatThread, uid: number) {
  const l = await ctx.store.getListing(th.listingId);
  const role = th.ownerId === uid ? "owner" : "guest";
  const other = await ctx.store.getUser(role === "owner" ? th.guestId : th.ownerId);
  return {
    id: th.id,
    listingId: th.listingId,
    title: l ? listingTitle(l) : "Объявление удалено",
    locality: l?.locality ?? "",
    photo: l?.photos[0]?.url ?? null,
    role,
    // Хозяину — имя гостя; гостю — просто «Хозяин» (имя хозяина не раскрываем до брони)
    otherName: role === "owner" ? (other?.name ?? "Гость") : "Хозяин",
    unread: role === "owner" ? th.unreadOwner : th.unreadGuest,
    lastText: th.lastText,
    updatedAt: th.updatedAt,
  };
}

/** Срок бесплатной отмены прошёл: сегодня позже, чем «заезд минус N дней» */
const isLateCancel = (b: Booking, l: Listing | undefined, t: number) =>
  !!l && l.cancelDays > 0 && todaySamara(t) > addDays(b.checkIn, -l.cancelDays);

/** Поля анкеты, после правки которых объявление снова идёт к модератору */
const CONTENT_FIELDS = ["type", "locality", "district", "address", "flat", "rooms", "area", "floor", "guests", "beds", "description", "rules", "amenities", "photos"] as const;

/** Разбор анкеты хозяина: берём только известные поля и в разумных пределах */
function applyForm(l: Listing, f: any) {
  if (PLACE_TYPES.some((t) => t.id === f?.type)) l.type = f.type;
  if (typeof f?.locality === "string") l.locality = str(f.locality, 60);
  if (typeof f?.district === "string") l.district = str(f.district, 60);
  if (typeof f?.address === "string") l.address = str(f.address, 200);
  if (typeof f?.flat === "string") l.flat = str(f.flat, 120);
  if (typeof f?.showPhone === "boolean") l.showPhone = f.showPhone;
  if (f?.rooms !== undefined) l.rooms = int(f.rooms, 1, 10, 1);
  if (f?.area !== undefined) l.area = intOrNull(f.area, 5, 1000);
  if (f?.floor !== undefined) l.floor = intOrNull(f.floor, -1, 100);
  if (f?.guests !== undefined) l.guests = int(f.guests, 1, 20, 2);
  if (f?.beds !== undefined) l.beds = int(f.beds, 1, 20, 1);
  if (f?.priceWeekday !== undefined) l.priceWeekday = int(f.priceWeekday, 0, 500_000, 0);
  if (f?.priceWeekend !== undefined) l.priceWeekend = int(f.priceWeekend, 0, 500_000, 0);
  if (f?.minNights !== undefined) l.minNights = int(f.minNights, 1, 30, 1);
  if (f?.deposit !== undefined) l.deposit = int(f.deposit, 0, 500_000, 0);
  if (TIME_RE.test(f?.checkIn ?? "")) l.checkIn = f.checkIn;
  if (TIME_RE.test(f?.checkOut ?? "")) l.checkOut = f.checkOut;
  if (f?.rules && typeof f.rules === "object") {
    l.rules = { pets: !!f.rules.pets, smoking: !!f.rules.smoking, kids: !!f.rules.kids, parties: !!f.rules.parties };
  }
  if (Array.isArray(f?.amenities)) l.amenities = f.amenities.filter((a: unknown) => typeof a === "string" && AMENITIES.includes(a));
  if (typeof f?.description === "string") l.description = str(f.description, 3000);
  if (CANCEL_OPTIONS.some((o) => o.days === Number(f?.cancelDays))) l.cancelDays = Number(f.cancelDays);
}

function newListing(ownerId: number, t: number): Listing {
  return {
    id: randomUUID().slice(0, 8),
    ownerId,
    status: "draft",
    type: "flat",
    locality: "Самара",
    district: "",
    address: "",
    rooms: 1,
    area: null,
    floor: null,
    guests: 2,
    beds: 1,
    priceWeekday: 0,
    priceWeekend: 0,
    minNights: 1,
    deposit: 0,
    checkIn: "14:00",
    checkOut: "12:00",
    rules: { pets: false, smoking: false, kids: true, parties: false },
    amenities: [],
    description: "",
    photos: [],
    closed: [],
    cancelDays: 0,
    createdAt: t,
    updatedAt: t,
  };
}

// --- бронь: решения хозяина и отмены ------------------------------------------

async function decide(ctx: Ctx, b: Booking, accept: boolean): Promise<string> {
  const l = await ctx.store.getListing(b.listingId);
  if (!l) return "Объявление не найдено.";
  if (b.status !== "requested") return "На этот запрос уже ответили.";
  b.status = accept ? "confirmed" : "declined";
  b.decidedAt = now(ctx);
  await ctx.store.saveBooking(b);
  await editAll(ctx, `b-${b.id}`, requestDecided(b, l));
  if (accept) {
    const owner = await ctx.store.getUser(l.ownerId);
    await send(ctx, b.guestId, confirmedToGuest(b, l, owner?.phone ?? null));
    return "Бронь принята. Телефон гостя в сообщении.";
  }
  await send(ctx, b.guestId, notConfirmedToGuest(b, l, appButton(ctx, "Найти другое жильё")));
  return "Запрос отклонён.";
}

async function cancel(ctx: Ctx, b: Booking, by: "guest" | "owner") {
  const l = await ctx.store.getListing(b.listingId);
  // Подтверждённую бронь гость отменил позже срока бесплатной отмены — отмечаем (пока без штрафа, оплата у хозяина)
  if (by === "guest" && b.status === "confirmed" && isLateCancel(b, l, now(ctx))) {
    b.lateCancel = true;
    // Поздняя отмена подводит хозяина так же, как «не приехал»
    const g = await ctx.store.getUser(b.guestId);
    if (g) {
      g.strikes = (g.strikes ?? 0) + 1;
      await ctx.store.saveUser(g);
    }
  }
  b.status = "cancelled";
  b.cancelledBy = by;
  b.decidedAt = now(ctx);
  await ctx.store.saveBooking(b);
  if (!l) return;
  await editAll(ctx, `b-${b.id}`, requestDecided(b, l));
  await send(ctx, by === "guest" ? b.ownerId : b.guestId, cancelledToOther(b, l, by === "guest"));
}

/** Бронь для экранов приложения: телефон и адрес — только после подтверждения */
async function bookingView(ctx: Ctx, b: Booking, forOwner: boolean) {
  const l = await ctx.store.getListing(b.listingId);
  const confirmed = b.status === "confirmed";
  const other = confirmed ? await ctx.store.getUser(forOwner ? b.guestId : b.ownerId) : undefined;
  return {
    id: b.id,
    listingId: b.listingId,
    title: l ? listingTitle(l) : "Объявление удалено",
    locality: l?.locality ?? "",
    photo: l?.photos[0]?.url ?? null,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    guests: b.guests,
    total: b.total,
    status: b.status,
    cancelledBy: b.cancelledBy ?? null,
    decideBy: b.decideBy,
    comment: forOwner ? b.comment : undefined,
    guestName: forOwner ? b.guestName : undefined,
    address: confirmed && l && !forOwner ? fullAddress(l) : null,
    lateCancel: !!b.lateCancel,
    cancelDays: l?.cancelDays ?? 0,
    // Можно оценить: жил (подтверждено, выезд был) и ещё не оценивал
    canReview: !forOwner && confirmed && b.checkOut <= todaySamara(now(ctx)) && !b.reviewed,
    deposit: l?.deposit ?? 0,
    checkInTime: l?.checkIn ?? null,
    phone: confirmed ? (forOwner ? b.guestPhone : (other?.phone ?? null)) : null,
  };
}

// --- маршруты API -------------------------------------------------------------------

/** meta.ip — адрес, с которого пришёл запрос (для лимитов на вход в админку) */
export async function handleApi(ctx: Ctx, path: string, body: any, meta: { ip?: string } = {}): Promise<Res> {
  void meta;
  const a = auth(ctx, body);
  if ("status" in a) return a;
  const { init, uid } = a;
  const t = now(ctx);
  const user = await userOf(ctx, uid, init);
  if (user.blocked) return fail(403, "blocked");

  // Свои объявления хозяина: чужое — 404, как будто его нет
  const ownListing = async (id: unknown) => {
    const l = await ctx.store.getListing(str(id, 16));
    return l && l.ownerId === uid && l.status !== "deleted" ? l : undefined;
  };

  switch (path) {
    case "/demo/code": {
      // Только демо-версия: бота там нет, поэтому код команды вводят в приложении. В облаке этого пути нет
      if (!ctx.config.demo && !ctx.config.allowBrowser) return fail(404, "unknown");
      if (limited(`acode:${uid}`, 5)) return fail(429, "too many");
      const r = await tryCode(ctx, uid, user.name, str(body?.code, 64));
      return r ? ok(r) : fail(400, "bad code");
    }

    case "/me":
      return ok({
        user: { id: uid, name: user.name, phone: user.phone, consent: user.consentAt != null },
        admin: await isAdmin(ctx, uid),
        demo: !!ctx.config.demo || ctx.config.allowBrowser,
        bot: ctx.config.botUsername ?? null,
        owner: await isOwner(ctx, uid),
        host: await hostStatusOf(ctx, user),
        hostNote: user.hostStatus === "rejected" ? (user.hostApp?.note ?? null) : null,
        // Бронировать нельзя после двух «не приехал» или поздних отмен
        bookingBanned: (user.strikes ?? 0) >= BOOKING_LIMITS.strikes,
        // Непрочитанные сообщения — для значка на вкладке «Моё»
        unread: (await ctx.store.listThreads(uid)).reduce((s, th) => s + (th.ownerId === uid ? th.unreadOwner : th.unreadGuest), 0),
        localities: LOCALITIES,
        districts: DISTRICTS,
        amenities: AMENITIES,
      });

    case "/phone": {
      // Номер из окна MAX «Поделиться номером» (или руками в браузере) + отдельное согласие (152-ФЗ)
      if (body?.consent !== true) return fail(400, "consent required");
      const phone = str(body?.phone, 16);
      if (!PHONE_RE.test(phone)) return fail(400, "bad phone");
      if (limited(`ph:${uid}`, 10)) return fail(429, "too many");
      // Номер из окна MAX приходит с подписью: проверяем её. Совпала и номер тот же — номер подтверждён
      let verified = false;
      if (body?.contact) {
        const r = checkContact(body.contact, ctx.config.botToken);
        const sameNumber = String((body.contact as any).phone ?? (body.contact as any).phone_number ?? "").replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10);
        verified = r.verified && sameNumber;
        // Для наладки: какая схема подписи подошла и какие поля прислал MAX — без цифр номера
        await ctx.store.kvSet("contactcheck:last", { at: t, verified, scheme: r.scheme, fields: r.fields, sameNumber });
      }
      user.phone = phone;
      user.phoneVerified = verified;
      user.consentAt = t;
      await ctx.store.saveUser(user);
      return ok({ ok: true, verified });
    }

    // --- гость ---------------------------------------------------------------------

    case "/search": {
      const locality = str(body?.locality, 60);
      const guests = int(body?.guests, 1, 20, 1);
      const priceMax = body?.priceMax ? int(body.priceMax, 0, 500_000, 0) : 0;
      const rooms = body?.rooms ? int(body.rooms, 1, 10, 1) : 0;
      const pets = body?.pets === true;
      const kids = body?.kids === true;
      const need: string[] = (Array.isArray(body?.amenities) ? body.amenities : []).filter((a: unknown) => typeof a === "string" && AMENITIES.includes(a));
      const sort = ["price", "rating", "new"].includes(body?.sort) ? body.sort : "price";
      const range = isDate(body?.checkIn) && isDate(body?.checkOut) ? { checkIn: body.checkIn as string, checkOut: body.checkOut as string } : undefined;
      const [listings, bookings] = await Promise.all([ctx.store.listListings({ status: ["active"] }), range ? ctx.store.listBookings({ status: HOLDING }) : []]);
      const cards = listings
        .filter((l) => (!locality || l.locality === locality) && l.guests >= guests && (!rooms || l.rooms >= rooms))
        .filter((l) => (!pets || l.rules.pets) && (!kids || l.rules.kids) && need.every((a) => l.amenities.includes(a)))
        // На выбранные даты — только свободное: «объявления сразу схватываются» и честно показывают занятость
        .filter((l) => !range || !checkRange(l, bookings.filter((b) => b.listingId === l.id), range.checkIn, range.checkOut, t))
        .map((l) => card(l, range))
        .filter((c) => !priceMax || (c.total != null && c.nights ? c.total / c.nights : c.priceFrom) <= priceMax)
        .sort((x, y) =>
          sort === "rating"
            ? (y.stars ?? 0) - (x.stars ?? 0) || y.reviews - x.reviews
            : sort === "new"
              ? y.createdAt - x.createdAt
              : (x.total ?? x.priceFrom) - (y.total ?? y.priceFrom),
        );
      return ok({ cards });
    }

    case "/listing": {
      const l = await ctx.store.getListing(str(body?.id, 16));
      // Гость видит только опубликованное; хозяин и модератор — своё в любом статусе (предпросмотр)
      if (!l || l.status === "deleted" || (l.status !== "active" && l.ownerId !== uid && !(await isAdmin(ctx, uid)))) return fail(404, "not found");
      const [bookings, reviews] = await Promise.all([ctx.store.listBookings({ listingId: l.id, status: HOLDING }), ctx.store.listReviews(l.id)]);
      // Просмотры: один человек — один просмотр в сутки; хозяин себя не накручивает
      if (l.status === "active" && l.ownerId !== uid && !(await ctx.store.seenRecently(`view:${l.id}:${uid}:${todaySamara(t)}`, 26 * 3600_000))) await ctx.store.bumpStat(l.id, "views", 1);
      // Номер хозяина — только если он сам разрешил показывать его до брони
      // и не больше 30 раз в час на человека — чтобы номера хозяев не собирали пачкой
      const hostPhone = l.showPhone && l.ownerId !== uid && !limited(`hp:${uid}`, 30) ? ((await ctx.store.getUser(l.ownerId))?.phone ?? null) : null;
      return ok({ listing: { ...publicListing(l, bookings, reviews, !!user.favorites?.includes(l.id), t), hostPhone }, own: l.ownerId === uid });
    }

    case "/chat/open": {
      // Гость открывает переписку с хозяином по объявлению: одна на пару «гость + объявление»
      const l = await ctx.store.getListing(str(body?.listingId, 16));
      if (!l || l.status !== "active") return fail(404, "not found");
      if (l.ownerId === uid) return fail(400, "own listing");
      let th = await ctx.store.findThread(l.id, uid);
      if (!th) {
        th = { id: randomUUID().slice(0, 8), listingId: l.id, guestId: uid, ownerId: l.ownerId, createdAt: t, updatedAt: t, unreadGuest: 0, unreadOwner: 0, lastText: "" };
        await ctx.store.saveThread(th);
      }
      return ok({ thread: await threadView(ctx, th, uid), messages: await messagesFor(ctx, th, uid) });
    }

    case "/chat/hide": {
      // Удалить переписку у себя. У собеседника она остаётся; напишет снова — вернётся с новыми сообщениями
      const th = await ctx.store.getThread(str(body?.id, 16));
      if (!th || (th.guestId !== uid && th.ownerId !== uid)) return fail(404, "not found");
      if (th.ownerId === uid) {
        th.clearedOwnerAt = t;
        th.unreadOwner = 0;
      } else {
        th.clearedGuestAt = t;
        th.unreadGuest = 0;
      }
      await ctx.store.saveThread(th);
      return ok({ ok: true });
    }

    case "/chat/delete": {
      // Удалить своё сообщение у обеих сторон. Чужое удалить нельзя
      const th = await ctx.store.getThread(str(body?.id, 16));
      if (!th || (th.guestId !== uid && th.ownerId !== uid)) return fail(404, "not found");
      const role = th.ownerId === uid ? "owner" : "guest";
      const mid = str(body?.messageId, 16);
      const m = (await ctx.store.listChatMessages(th.id)).find((x) => x.id === mid);
      if (!m || m.from !== role) return fail(404, "not found");
      await ctx.store.markChatMessageDeleted(th.id, m.id, t);
      const last = (await ctx.store.listChatMessages(th.id, 1))[0];
      if (last?.id === m.id) {
        th.lastText = "Сообщение удалено";
        await ctx.store.saveThread(th);
      }
      // Уведомление собеседнику в чате MAX тоже правим, чтобы текст не остался там
      const notified = await ctx.store.kvGet<string>(`cmid:${m.id}`);
      if (notified) await ctx.max.edit(notified, { text: "Сообщение удалено" }).catch(() => {});
      return ok({ ok: true });
    }

    case "/chat/thread": {
      const th = await ctx.store.getThread(str(body?.id, 16));
      if (!th || (th.guestId !== uid && th.ownerId !== uid)) return fail(404, "not found");
      // Открыл — прочитал
      if (th.ownerId === uid && th.unreadOwner) th.unreadOwner = 0;
      else if (th.guestId === uid && th.unreadGuest) th.unreadGuest = 0;
      await ctx.store.saveThread(th);
      return ok({ thread: await threadView(ctx, th, uid), messages: await messagesFor(ctx, th, uid) });
    }

    case "/chat/send": {
      const th = await ctx.store.getThread(str(body?.id, 16));
      if (!th || (th.guestId !== uid && th.ownerId !== uid)) return fail(404, "not found");
      const r = await postChat(ctx, th, th.ownerId === uid ? "owner" : "guest", str(body?.text, 1000), str(body?.key, 40));
      return typeof r === "string" ? fail(r === "too many" ? 429 : 400, r) : ok(r);
    }

    case "/chat/list": {
      const list = await ctx.store.listThreads(uid);
      // Пустые переписки (открыл и ничего не написал) не показываем
      // Пустые и удалённые у себя (если после удаления ничего нового не пришло) не показываем
      const visible = list.filter((th) => th.lastText && th.updatedAt > ((th.ownerId === uid ? th.clearedOwnerAt : th.clearedGuestAt) ?? 0));
      return ok({ threads: await Promise.all(visible.slice(0, 100).map((th) => threadView(ctx, th, uid))) });
    }

    case "/booking/hide": {
      // Убрать бронь из своего списка. Действующую (ждёт ответа или впереди) — сначала отменить
      const b = await ctx.store.getBooking(str(body?.id, 16));
      if (!b || (b.guestId !== uid && b.ownerId !== uid)) return fail(404, "not found");
      const active = b.status === "requested" || (b.status === "confirmed" && b.checkOut > todaySamara(t));
      if (active) return fail(400, "active booking");
      if (b.guestId === uid) b.hiddenGuest = true;
      if (b.ownerId === uid) b.hiddenOwner = true;
      await ctx.store.saveBooking(b);
      return ok({ ok: true });
    }

    case "/host/noshow": {
      // Хозяин отмечает, что гость не приехал: бронь закрывается, гостю — предупреждение
      const b = await ctx.store.getBooking(str(body?.id, 16));
      if (!b || b.ownerId !== uid) return fail(404, "not found");
      if (b.status !== "confirmed" || b.checkIn > todaySamara(t)) return fail(400, "too early");
      b.status = "noshow";
      b.decidedAt = t;
      await ctx.store.saveBooking(b);
      const g = await ctx.store.getUser(b.guestId);
      if (g) {
        g.strikes = (g.strikes ?? 0) + 1;
        await ctx.store.saveUser(g);
        const left = BOOKING_LIMITS.strikes - g.strikes;
        await send(ctx, g.id, {
          text:
            left > 0
              ? `Хозяин отметил, что вы не приехали по брони ${b.checkIn}. Если планы меняются, отменяйте бронь заранее: после ещё одного такого случая бронирование станет недоступно.`
              : `Хозяин отметил, что вы не приехали по брони ${b.checkIn}. Бронирование на площадке для вас закрыто. Если это ошибка, напишите сюда.`,
        });
      }
      return ok({ ok: true });
    }

    case "/host/apply": {
      // Заявка «хочу сдавать»: модератор смотрит и решает. Без одобрения объявления размещать нельзя
      if (!user.phone || !user.consentAt) return fail(400, "phone required");
      const status = await hostStatusOf(ctx, user);
      if (status === "approved" || status === "pending") return fail(409, "already applied");
      if (limited(`ha:${uid}`, 3)) return fail(429, "too many");
      const name = str(body?.name, 80);
      const city = str(body?.city, 60);
      if (name.length < 2 || !city) return fail(400, "incomplete");
      user.hostApp = {
        name,
        city,
        about: str(body?.about, 500),
        at: t,
      };
      user.hostStatus = "pending";
      await ctx.store.saveUser(user);
      await notifyAdmins(ctx, hostAppToAdmins(user, await hostHintsOf(ctx, user)), `h-${uid}`);
      return ok({ host: "pending" });
    }

    case "/host/photo-upload": {
      // Фото прямо из приложения: телефон уже сжал его и убрал метаданные (в том числе геометку)
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      if (limited(`up:${uid}`, 60)) return fail(429, "too many");
      if (l.photos.length >= MAX_PHOTOS) return fail(400, "too many photos");
      const b64 = typeof body?.data === "string" ? body.data.replace(/^data:image\/jpeg;base64,/, "") : "";
      const buf = Buffer.from(b64, "base64");
      // Только настоящий JPEG и не больше 2,5 МБ: подменённый файл не пройдёт
      if (buf.length < 1000 || buf.length > 2_500_000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return fail(400, "bad image");
      const url = await ctx.store.savePhoto(buf);
      l.photos.push({ url, ...jpegSize(buf) });
      l.updatedAt = t;
      if (l.status === "active") l.checked = l.botChecked = false;
      await ctx.store.saveListing(l);
      return ok({ listing: l, missing: missingForSubmit(l) });
    }

    case "/admin/applications": {
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const list = await ctx.store.listHostApplicants("pending");
      // К каждой заявке — подсказки бота: решает человек, но думать за всё ему не нужно
      return ok({ applications: await Promise.all(list.map(async (u) => ({ id: u.id, phone: u.phone, ...u.hostApp!, hints: await hostHintsOf(ctx, u) }))) });
    }

    case "/admin/application": {
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const r = await decideHost(ctx, Number(body?.id), body?.ok === true, str(body?.note, 300) || "Заявка не подходит под правила площадки.", uid);
      return r ? fail(400, r) : ok({ ok: true });
    }

    case "/favorite": {
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l) return fail(404, "not found");
      const set = new Set(user.favorites ?? []);
      const was = set.has(l.id);
      if (body?.on === true) set.add(l.id);
      else set.delete(l.id);
      user.favorites = [...set].slice(-100);
      await ctx.store.saveUser(user);
      // Счётчик «в избранном» — только при настоящем изменении, повторное нажатие не накручивает
      if (set.has(l.id) !== was && l.ownerId !== uid) await ctx.store.bumpStat(l.id, "favs", set.has(l.id) ? 1 : -1);
      return ok({ favorite: set.has(l.id) });
    }

    case "/favorites": {
      const list = await Promise.all((user.favorites ?? []).map((id) => ctx.store.getListing(id)));
      return ok({ cards: list.filter((l): l is Listing => !!l && l.status === "active").map((l) => card(l)) });
    }

    case "/review": {
      // Оценить может только гость, который действительно жил: подтверждённая бронь, выезд уже был, один раз
      const b = await ctx.store.getBooking(str(body?.bookingId, 16));
      if (!b || b.guestId !== uid) return fail(404, "not found");
      const r = await addReview(ctx, b, int(body?.stars, 1, 5, 5), str(body?.text, 1000));
      return r === true ? ok({ ok: true }) : fail(400, r);
    }

    case "/complaint": {
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l || l.ownerId === uid) return fail(404, "not found");
      if (limited(`cp:${uid}`, 5)) return fail(429, "too many");
      const reason = COMPLAINT_REASONS.find((r) => r.id === body?.reason) ?? COMPLAINT_REASONS[COMPLAINT_REASONS.length - 1];
      const c: Complaint = { id: randomUUID().slice(0, 8), listingId: l.id, userId: uid, reason: reason.id, text: str(body?.text, 500), createdAt: t };
      await ctx.store.saveComplaint(c);
      const count = (await ctx.store.listComplaints({ listingId: l.id, open: true })).length;
      await notifyAdmins(ctx, complaintToAdmins(c, l, reason.title, count), `c-${c.id}`);
      return ok({ ok: true });
    }

    case "/quote": {
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l || l.status !== "active") return fail(404, "not found");
      const bookings = await ctx.store.listBookings({ listingId: l.id, status: HOLDING });
      const problem = checkRange(l, bookings, body?.checkIn, body?.checkOut, t);
      if (problem) return ok({ problem });
      return ok(price(l, body.checkIn, body.checkOut));
    }

    case "/book": {
      if (!user.phone || !user.consentAt) return fail(400, "phone required");
      if (limited(`bk:${uid}`, 10)) return fail(429, "too many");
      // Защита от ложных броней: кто дважды не приехал или отменил в последний момент — больше не бронирует
      if ((user.strikes ?? 0) >= BOOKING_LIMITS.strikes) return fail(403, "booking banned");
      // И не держит даты у многих хозяев сразу: не больше трёх запросов, ждущих ответа
      if ((await ctx.store.listBookings({ guestId: uid, status: ["requested"] })).length >= BOOKING_LIMITS.activeRequests) return fail(409, "too many requests");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l || l.status !== "active") return fail(404, "not found");
      if (l.ownerId === uid) return fail(400, "own listing");
      const guests = int(body?.guests, 1, 20, 1);
      if (guests > l.guests) return fail(400, "too many guests");
      const checkIn = body?.checkIn;
      const checkOut = body?.checkOut;
      // Повтор той же отправки (ответ потерялся по дороге, приложение отправило ещё раз) — это успех, а не ошибка
      const clientKey = str(body?.key, 40);
      const mine = await ctx.store.listBookings({ listingId: l.id, guestId: uid, status: ["requested"] });
      const same = clientKey && mine.find((x) => x.clientKey === clientKey);
      if (same) return ok({ booking: await bookingView(ctx, same, false) });
      // Один активный запрос на одно жильё от одного человека — без спама хозяину
      if (mine.length) return fail(409, "already requested", { bookingId: mine[0].id });
      const p = isDate(checkIn) && isDate(checkOut) ? price(l, checkIn, checkOut) : { nights: 0, total: 0 };
      const b: Booking = {
        id: randomUUID().slice(0, 8),
        listingId: l.id,
        ownerId: l.ownerId,
        guestId: uid,
        guestName: user.name,
        guestPhone: user.phone,
        checkIn,
        checkOut,
        guests,
        nights: p.nights,
        total: p.total,
        comment: str(body?.comment, 500),
        status: "requested",
        createdAt: t,
        decideBy: decideDeadline(t, ctx.config.decideHours),
        ...(clientKey ? { clientKey } : {}),
      };
      let problem: string | null = null;
      // Проверка дат и запись — одним действием хранилища, чтобы два гостя не заняли одни даты
      const created = await ctx.store.createBookingIfFree(b, (fresh, bookings) => {
        problem = fresh.status !== "active" ? "not_active" : checkRange(fresh, bookings, checkIn, checkOut, t);
        return problem === null;
      });
      if (!created) return fail(409, problem ?? "busy", { problem });
      await send(ctx, l.ownerId, requestToOwner(b, l), `b-${b.id}`);
      return ok({ booking: await bookingView(ctx, b, false) });
    }

    case "/my/bookings": {
      const list = (await ctx.store.listBookings({ guestId: uid })).filter((b) => !b.hiddenGuest);
      return ok({ bookings: await Promise.all(list.slice(0, 50).map((b) => bookingView(ctx, b, false))) });
    }

    case "/booking/cancel": {
      const b = await ctx.store.getBooking(str(body?.id, 16));
      if (!b || (b.guestId !== uid && b.ownerId !== uid)) return fail(404, "not found");
      const by = b.guestId === uid ? "guest" : "owner";
      // Гость отменяет запрос или бронь до заезда; хозяин — только подтверждённую (запрос он отклоняет)
      const can = by === "guest" ? HOLDING.includes(b.status) : b.status === "confirmed";
      if (!can || b.checkIn < todaySamara(t)) return fail(400, "cannot cancel");
      await cancel(ctx, b, by);
      return ok({ ok: true });
    }

    // --- хозяин ----------------------------------------------------------------------

    case "/host/listings": {
      const [listings, bookings] = await Promise.all([ctx.store.listListings({ ownerId: uid }), ctx.store.listBookings({ ownerId: uid, status: ["requested"] })]);
      const stats = await ctx.store.getStats(listings.filter((l) => l.status !== "deleted").map((l) => l.id));
      return ok({
        listings: listings.filter((l) => l.status !== "deleted").map((l) => ({
          id: l.id,
          title: listingTitle(l),
          locality: l.locality,
          status: l.status,
          moderatorNote: l.moderatorNote ?? null,
          photo: l.photos[0]?.url ?? null,
          priceFrom: Math.min(l.priceWeekday, l.priceWeekend),
          requests: bookings.filter((b) => b.listingId === l.id).length,
          views: stats[l.id]?.views ?? 0,
          favs: stats[l.id]?.favs ?? 0,
        })),
      });
    }

    case "/host/listing": {
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      return ok({ listing: l, missing: missingForSubmit(l) });
    }

    case "/host/save": {
      if (!user.phone || !user.consentAt) return fail(400, "phone required");
      if ((await hostStatusOf(ctx, user)) !== "approved") return fail(403, "not host");
      if (limited(`sv:${uid}`, 120)) return fail(429, "too many");
      let l = body?.id ? await ownListing(body.id) : undefined;
      if (body?.id && !l) return fail(404, "not found");
      if (!l) {
        if ((await ctx.store.listListings({ ownerId: uid })).length >= 20) return fail(400, "too many listings");
        l = newListing(uid, t);
      }
      if (l.status === "blocked") return fail(403, "blocked");
      // Телефоны, ссылки и «пишите в WhatsApp» — главный путь мошенников мимо площадки. Не сохраняем
      if (hasContacts(str(body?.form?.description, 3000)) || hasContacts(str(body?.form?.address, 200)) || hasContacts(str(body?.form?.flat, 120))) return fail(400, "contacts");
      const before = JSON.stringify(CONTENT_FIELDS.map((k) => l![k]));
      applyForm(l, body?.form);
      const contentChanged = before !== JSON.stringify(CONTENT_FIELDS.map((k) => l![k]));
      l.updatedAt = t;
      // Опубликованное с новым содержимым — бот проверяет снова (подозрительное скрывается до проверки).
      // Цены — без проверки, кроме резкого снижения: это приём «приманки» после того, как объявление одобрили
      const bait = !!l.approvedPrice && Math.min(l.priceWeekday, l.priceWeekend) < l.approvedPrice * 0.6;
      if (l.status === "active" && (contentChanged || bait)) await publishOrHold(ctx, l, user.phone, true);
      else await ctx.store.saveListing(l);
      return ok({ listing: l, missing: missingForSubmit(l) });
    }

    case "/host/photos-request": {
      // Фото проще прислать в чат бота, чем грузить в мини-приложение: бот запоминает, к какому объявлению они
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      user.photosFor = l.id;
      await ctx.store.saveUser(user);
      await send(ctx, uid, {
        text: `Пришлите сюда фото для «${listingTitle(l)}», до ${MAX_PHOTOS} штук. Первое фото будет обложкой. Когда закончите, нажмите «Готово».`,
        buttons: [[{ type: "callback", text: "Готово", payload: "ph:done" }]],
      });
      return ok({ sent: true });
    }

    case "/host/photos": {
      // Удалить или переставить фото: приходит новый порядок индексов
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      const order: unknown[] = Array.isArray(body?.order) ? body.order : [];
      const next = order.map((i) => l.photos[Number(i)]).filter((p): p is Photo => !!p);
      l.photos = [...new Map(next.map((p) => [p.url, p])).values()];
      l.updatedAt = t;
      // Удалили или переставили фото — новое лицо объявления, модератор посмотрит ещё раз
      if (l.status === "active") l.checked = l.botChecked = false;
      await ctx.store.saveListing(l);
      return ok({ listing: l, missing: missingForSubmit(l) });
    }

    case "/host/submit": {
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      if (!["draft", "rejected", "paused"].includes(l.status)) return fail(400, "bad status");
      if ((await hostStatusOf(ctx, user)) !== "approved") return fail(403, "not host");
      const missing = missingForSubmit(l);
      if (missing.length) return fail(400, "incomplete", { missing });
      l.submittedAt = t;
      l.updatedAt = t;
      const live = await publishOrHold(ctx, l, user.phone, l.status !== "draft");
      await send(ctx, uid, live ? publishedToOwner(l) : heldToOwner(l));
      return ok({ listing: l, live });
    }

    case "/host/delete": {
      // Удалить своё объявление. Подтверждённые будущие брони сначала нужно отменить (гости рассчитывают на жильё),
      // ждущие ответа запросы отклоняются сами и гостям приходит сообщение
      const l = await ownListing(body?.id);
      if (!l || l.status === "deleted") return fail(404, "not found");
      if (l.status === "blocked") return fail(400, "bad status");
      const today = todaySamara(t);
      const all = await ctx.store.listBookings({ listingId: l.id, status: ["requested", "confirmed"] });
      if (all.some((b) => b.status === "confirmed" && b.checkOut > today)) return fail(409, "has bookings");
      for (const b of all.filter((x) => x.status === "requested")) await decide(ctx, b, false);
      l.status = "deleted";
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      return ok({ ok: true });
    }

    case "/host/pause": {
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      if (body?.paused && l.status === "active") l.status = "paused";
      // Снятое хозяином возвращается сразу, без повторной проверки: содержимое не менялось
      else if (!body?.paused && l.status === "paused") l.status = "active";
      else return fail(400, "bad status");
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      return ok({ listing: l });
    }

    case "/host/calendar": {
      const l = await ownListing(body?.id);
      if (!l) return fail(404, "not found");
      const today = todaySamara(t);
      const close = (Array.isArray(body?.close) ? body.close : []).filter(isDate);
      const open = new Set((Array.isArray(body?.open) ? body.open : []).filter(isDate));
      // Прошлые даты не храним — календарь не разрастается
      l.closed = [...new Set([...l.closed, ...close])].filter((d) => d >= today && !open.has(d)).sort().slice(0, 400);
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      const bookings = await ctx.store.listBookings({ listingId: l.id, status: HOLDING });
      return ok({ closed: l.closed, booked: [...busyNights({ closed: [] }, bookings)].sort() });
    }

    case "/host/bookings": {
      const list = (await ctx.store.listBookings({ ownerId: uid })).filter((b) => !b.hiddenOwner);
      return ok({ bookings: await Promise.all(list.slice(0, 100).map((b) => bookingView(ctx, b, true))) });
    }

    case "/host/decide": {
      const b = await ctx.store.getBooking(str(body?.id, 16));
      if (!b || b.ownerId !== uid) return fail(404, "not found");
      const text = await decide(ctx, b, body?.accept === true);
      return ok({ message: text, booking: await bookingView(ctx, b, true) });
    }

    // --- модератор ------------------------------------------------------------------

    case "/admin/pending": {
      // К проверке: ждущие до показа и уже опубликованные, которые модератор ещё не смотрел
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const list = (await ctx.store.listListings({ status: ["pending", "active"] })).filter((l) => l.status === "pending" || !l.checked);
      const complaints = await ctx.store.listComplaints({ open: true });
      const withTitles = await Promise.all(
        complaints.slice(0, 50).map(async (c) => {
          const l = await ctx.store.getListing(c.listingId);
          return { ...c, title: l ? `${listingTitle(l)}, ${l.locality}` : "удалено", ownerId: l?.ownerId ?? null, reasonTitle: COMPLAINT_REASONS.find((r) => r.id === c.reason)?.title ?? c.reason };
        }),
      );
      return ok({ listings: list.map((l) => ({ ...l, title: listingTitle(l), held: l.botReasons ?? suspicion(l) })), complaints: withTitles });
    }

    case "/admin/complaint": {
      // Решение по жалобе: hide — скрыть объявление; ban — заблокировать хозяина; ok — всё в порядке
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      // Заблокировать человека может только главный; модератор — скрыть объявление или закрыть жалобу
      if (body?.action === "ban" && !(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const r = await resolveComplaint(ctx, str(body?.id, 16), body?.action, uid);
      return r ? fail(400, r) : ok({ ok: true });
    }

    case "/admin/complaints/clear": {
      // Очистить все открытые жалобы разом (после разбора или если это спам)
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const open = await ctx.store.listComplaints({ open: true });
      for (const c of open) await ctx.store.saveComplaint({ ...c, resolved: true, dismissed: true });
      await audit(ctx, uid, "очистил жалобы", String(open.length));
      return ok({ cleared: open.length });
    }

    case "/admin/moderate": {
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l) return fail(404, "not found");
      const reason = str(body?.reason, 16);
      const note = str(body?.note, 500);
      const r = await moderate(ctx, l, body?.ok === true, note || REJECT_REASONS[reason] || REJECT_REASONS.other, uid);
      return r ? fail(400, r) : ok({ listing: l });
    }

    case "/admin/block": {
      // Снять опубликованное объявление (жалоба, обман). Хозяин видит причину
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l) return fail(404, "not found");
      l.status = "blocked";
      l.moderatorNote = str(body?.note, 500) || REJECT_REASONS.fraud;
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      await send(ctx, l.ownerId, { text: `Объявление «${listingTitle(l)}» снято модератором.\n${l.moderatorNote}` });
      await audit(ctx, uid, "снял объявление", `${listingTitle(l)}, ${l.locality} (${l.id})`, l.moderatorNote);
      return ok({ listing: l });
    }
    case "/admin/restore": {
      // Вернуть снятое или отклонённое объявление в поиск (ошиблись или хозяин исправил)
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l || !["blocked", "rejected"].includes(l.status)) return fail(400, "bad status");
      if ((await ctx.store.getUser(l.ownerId))?.blocked) return fail(400, "owner blocked");
      l.status = "active";
      l.checked = true;
      l.moderatorNote = undefined;
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      await send(ctx, l.ownerId, { text: `Объявление «${listingTitle(l)}» снова в поиске.` });
      await audit(ctx, uid, "вернул объявление в поиск", `${listingTitle(l)}, ${l.locality} (${l.id})`);
      return ok({ listing: l });
    }

    case "/admin/listings": {
      // Все объявления площадки: фильтр по статусу и поиск по городу, адресу, номеру
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const status = ["draft", "pending", "active", "rejected", "paused", "blocked", "deleted"].includes(body?.status) ? [body.status] : undefined;
      const q = str(body?.q, 60).toLowerCase();
      const list = (await ctx.store.listListings({ status })).filter((l) => !q || `${l.locality} ${l.district} ${l.address} ${l.id}`.toLowerCase().includes(q)).slice(0, 100);
      return ok({
        listings: list.map((l) => ({ id: l.id, title: listingTitle(l), locality: l.locality, address: l.address, status: l.status, ownerId: l.ownerId, photo: l.photos[0]?.url ?? null, checked: !!l.checked, botChecked: !!l.botChecked, updatedAt: l.updatedAt })),
      });
    }

    case "/admin/users": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      // Тестовые люди (проверка облака, демо — номера от 900 000 000) в настоящем боте не показываем
      const users = (await ctx.store.searchUsers(str(body?.q, 60), 60)).filter((u) => ctx.config.demo || u.id < 900_000_000).slice(0, 50);
      const staff = await ctx.store.getStaff();
      const rows = await Promise.all(
        users.map(async (u) => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          blocked: !!u.blocked,
          createdAt: u.createdAt,
          role: staff.find((m) => m.id === u.id)?.role ?? null,
          phoneVerified: !!u.phoneVerified,
          listings: (await ctx.store.listListings({ ownerId: u.id })).length,
          bookings: (await ctx.store.listBookings({ guestId: u.id })).length,
        })),
      );
      return ok({ users: rows });
    }

    case "/admin/user/block": {
      // Заблокировать (обман) или разблокировать человека. Себя и главных — нельзя
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const target = Number(body?.id);
      if (!target || target === uid) return fail(400, "bad user");
      if ((await ctx.store.getStaff()).some((m) => m.id === target && m.role === "owner")) return fail(400, "owner");
      const u = await ctx.store.getUser(target);
      if (!u) return fail(404, "not found");
      if (body?.blocked === true) {
        const note = str(body?.note, 300);
        await banUser(ctx, target, note || "Заблокирован модератором.");
        // Заблокированный не может оставаться модератором
        await ctx.store.saveStaff((await ctx.store.getStaff()).filter((m) => m.id !== target));
        await audit(ctx, uid, "заблокировал человека", `${u.name ?? "без имени"} (${target})`, note || undefined);
      } else {
        u.blocked = false;
        await ctx.store.saveUser(u);
        await audit(ctx, uid, "разблокировал человека", `${u.name ?? "без имени"} (${target})`);
      }
      return ok({ ok: true });
    }

    case "/admin/staff": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const staff = await ctx.store.getStaff();
      const rows = await Promise.all(
        staff.map(async (m) => {
          const u = await ctx.store.getUser(m.id);
          return { id: m.id, role: m.role, name: u?.name ?? null, phone: u?.phone ?? null, addedAt: m.addedAt };
        }),
      );
      return ok({ staff: rows, owner: await isOwner(ctx, uid) });
    }

    case "/admin/listing/delete": {
      // Главный удаляет любое объявление. Ждущие запросы отклоняются, подтверждённые брони отменяются с сообщением гостю
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l || l.status === "deleted") return fail(404, "not found");
      for (const b of await ctx.store.listBookings({ listingId: l.id, status: ["requested", "confirmed"] })) {
        if (b.status === "requested") await decide(ctx, b, false);
        else if (b.checkOut > todaySamara(t)) await cancel(ctx, b, "owner");
      }
      l.status = "deleted";
      l.moderatorNote = str(body?.note, 300) || "Удалено администратором площадки.";
      l.updatedAt = t;
      await ctx.store.saveListing(l);
      await send(ctx, l.ownerId, { text: `Объявление «${listingTitle(l)}» удалено администратором.\n${l.moderatorNote}` });
      await audit(ctx, uid, "удалил объявление", `${listingTitle(l)}, ${l.locality} (${l.id})`, l.moderatorNote);
      return ok({ ok: true });
    }

    case "/admin/listing/purge": {
      // Стереть насовсем уже удалённое объявление (только главный). Активное сначала удаляют обычным способом
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const l = await ctx.store.getListing(str(body?.id, 16));
      if (!l) return fail(404, "not found");
      if (l.status !== "deleted") return fail(400, "bad status");
      await ctx.store.purgeListing(l.id);
      await audit(ctx, uid, "стёр объявление насовсем", `${listingTitle(l)}, ${l.locality} (${l.id})`);
      return ok({ ok: true });
    }

    case "/admin/booking/cancel": {
      // Главный отменяет любую бронь (спор, обман). Обе стороны получают сообщение
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const b = await ctx.store.getBooking(str(body?.id, 16));
      if (!b || !["requested", "confirmed"].includes(b.status)) return fail(400, "cannot cancel");
      const note = str(body?.note, 300) || "Бронь отменена администратором площадки.";
      if (b.status === "requested") await decide(ctx, b, false);
      else await cancel(ctx, b, "owner");
      await send(ctx, b.guestId, { text: note });
      await send(ctx, b.ownerId, { text: note });
      await audit(ctx, uid, "отменил бронь", `${b.id}`, note);
      return ok({ ok: true });
    }

    case "/admin/modcode": {
      // Код модераторов: главный видит его и может сменить (если код утёк — старый перестаёт работать сразу)
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      if (body?.rotate === true) {
        if (limited(`mc:${uid}`, 20)) return fail(429, "too many");
        const code = randomUUID().replace(/-/g, "").slice(0, 12);
        await ctx.store.kvSet("modcode", code);
        await audit(ctx, uid, "сменил код модераторов", "");
      }
      return ok({ code: await modCodeOf(ctx) });
    }

    case "/admin/staff/remove": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const target = Number(body?.id);
      const staff = await ctx.store.getStaff();
      const m = staff.find((x) => x.id === target);
      if (!m) return fail(404, "not found");
      // Последнего главного не убрать — иначе площадка останется без управления
      if (m.role === "owner" && staff.filter((x) => x.role === "owner").length <= 1) return fail(400, "last owner");
      await ctx.store.saveStaff(staff.filter((x) => x.id !== target));
      const u = await ctx.store.getUser(target);
      await audit(ctx, uid, m.role === "owner" ? "снял главного" : "снял модератора", `${u?.name ?? "без имени"} (${target})`);
      await send(ctx, target, { text: "Вы больше не в команде площадки." });
      return ok({ ok: true });
    }

    case "/admin/bookings": {
      // Все запросы на бронь и ближайшие подтверждённые — чтобы команда видела, что происходит, и могла помочь
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const today = todaySamara(t);
      const list = (await ctx.store.listBookings({ status: ["requested", "confirmed"] }))
        .filter((b) => b.status === "requested" || b.checkOut >= today)
        .sort((x, y) => (x.status === y.status ? y.createdAt - x.createdAt : x.status === "requested" ? -1 : 1))
        .slice(0, 100);
      const rows = await Promise.all(
        list.map(async (b) => {
          const [l, owner] = await Promise.all([ctx.store.getListing(b.listingId), ctx.store.getUser(b.ownerId)]);
          return {
            id: b.id,
            listingId: b.listingId,
            title: l ? listingTitle(l) : "объявление удалено",
            locality: l?.locality ?? "",
            address: l?.address ?? "",
            checkIn: b.checkIn,
            checkOut: b.checkOut,
            guests: b.guests,
            total: b.total,
            status: b.status,
            createdAt: b.createdAt,
            decideBy: b.decideBy,
            guestName: b.guestName,
            guestPhone: b.guestPhone,
            ownerName: owner?.name ?? null,
            ownerPhone: owner?.phone ?? null,
          };
        }),
      );
      return ok({ bookings: rows });
    }

    case "/admin/stats": {
      if (!(await isAdmin(ctx, uid))) return fail(403, "forbidden");
      const [listings, bookings, users, complaints] = await Promise.all([ctx.store.listListings(), ctx.store.listBookings(), ctx.store.countUsers(), ctx.store.listComplaints({ open: true })]);
      const by = (arr: { status: string }[]) => arr.reduce<Record<string, number>>((acc, x) => ((acc[x.status] = (acc[x.status] ?? 0) + 1), acc), {});
      const weekAgo = t - 7 * 86_400_000;
      return ok({
        users,
        listings: by(listings),
        bookings: by(bookings),
        bookingsWeek: bookings.filter((b) => b.createdAt > weekAgo).length,
        confirmedSum: bookings.filter((b) => b.status === "confirmed").reduce((sum, b) => sum + b.total, 0),
        openComplaints: complaints.length,
        pendingHosts: (await ctx.store.listHostApplicants("pending")).length,
      });
    }

    case "/admin/audit": {
      if (!(await isOwner(ctx, uid))) return fail(403, "forbidden");
      const entries = await ctx.store.listAudit(100);
      const names = new Map<number, string>();
      for (const e of entries) if (!names.has(e.by)) names.set(e.by, e.by === BOT_ID ? "Бот" : ((await ctx.store.getUser(e.by))?.name ?? String(e.by)));
      return ok({ entries: entries.map((e) => ({ ...e, byName: names.get(e.by) })) });
    }
  }
  return fail(404, "unknown");
}

/**
 * Решение модератора. Ждущее проверки — одобрить или отклонить; уже опубликованное и непросмотренное —
 * «всё хорошо» или скрыть. null — готово, строка — почему нельзя
 */
async function moderate(ctx: Ctx, l: Listing, approve: boolean, note: string, by?: number): Promise<string | null> {
  const wasLive = l.status === "active";
  if (!(l.status === "pending" || (wasLive && !l.checked))) return "already moderated";
  l.status = approve ? "active" : "rejected";
  l.checked = approve;
  if (approve) l.approvedPrice = Math.min(l.priceWeekday, l.priceWeekend);
  l.moderatorNote = approve ? undefined : note;
  l.updatedAt = now(ctx);
  await ctx.store.saveListing(l);
  await editAll(ctx, `l-${l.id}`, { text: `${listingTitle(l)}, ${l.locality}\n${approve ? "Проверено, в поиске" : `${wasLive ? "Скрыто" : "Отклонено"}: ${note}`}` });
  // Опубликованному «всё хорошо» хозяину не пишем — для него ничего не изменилось
  if (!(approve && wasLive)) await send(ctx, l.ownerId, moderatedToOwner(l, wasLive));
  if (by != null) await audit(ctx, by, approve ? "одобрил объявление" : wasLive ? "скрыл объявление" : "отклонил объявление", `${listingTitle(l)}, ${l.locality} (${l.id})`, approve ? undefined : note);
  return null;
}

/** Решение по заявке «хочу сдавать». null — готово, строка — почему нельзя */
async function decideHost(ctx: Ctx, userId: number, approve: boolean, note: string, by: number): Promise<string | null> {
  const u = await ctx.store.getUser(userId);
  if (!u?.hostApp) return "not found";
  if (u.hostStatus !== "pending") return "already decided";
  u.hostStatus = approve ? "approved" : "rejected";
  if (!approve) u.hostApp = { ...u.hostApp, note };
  await ctx.store.saveUser(u);
  await editAll(ctx, `h-${u.id}`, { text: `Заявка на размещение: ${u.hostApp.name}, ${u.hostApp.city}\n${approve ? "Принята" : `Отказано: ${note}`}` });
  await send(ctx, u.id, hostDecisionToUser(approve, note, appButton(ctx, approve ? "Разместить объявление" : "Открыть приложение", "host")));
  await audit(ctx, by, approve ? "принял заявку хозяина" : "отказал в заявке хозяина", `${u.hostApp.name} (${u.id})`, approve ? undefined : note);
  return null;
}

/** Оценка гостя. true — сохранено, строка — почему нельзя */
async function addReview(ctx: Ctx, b: Booking, stars: number, text: string): Promise<true | string> {
  if (b.status !== "confirmed" || b.checkOut > todaySamara(now(ctx))) return "not stayed";
  if (b.reviewed) return "already reviewed";
  const l = await ctx.store.getListing(b.listingId);
  if (!l) return "not found";
  b.reviewed = true;
  await ctx.store.saveBooking(b);
  const guest = await ctx.store.getUser(b.guestId);
  // Текст отзыва — тоже без контактов и ссылок
  const clean = hasContacts(text) ? "" : text;
  await ctx.store.saveReview({ id: randomUUID().slice(0, 8), listingId: l.id, bookingId: b.id, guestId: b.guestId, guestName: guest?.name ?? null, stars, text: clean, createdAt: now(ctx) });
  l.rating = { sum: (l.rating?.sum ?? 0) + stars, count: (l.rating?.count ?? 0) + 1 };
  await ctx.store.saveListing(l);
  return true;
}

/** Заблокировать человека (обман): его объявления снимаются, его запросы на бронь отменяются */
async function banUser(ctx: Ctx, userId: number, note: string) {
  const u = await ctx.store.getUser(userId);
  if (u) {
    u.blocked = true;
    await ctx.store.saveUser(u);
  }
  for (const l of await ctx.store.listListings({ ownerId: userId })) {
    if (l.status === "blocked") continue;
    l.status = "blocked";
    l.moderatorNote = note;
    l.updatedAt = now(ctx);
    await ctx.store.saveListing(l);
    // Гостям с подтверждёнными бронями — предупреждение: жильё снято
    for (const b of await ctx.store.listBookings({ listingId: l.id, status: HOLDING })) await cancel(ctx, b, "owner");
  }
  for (const b of await ctx.store.listBookings({ guestId: userId, status: ["requested"] })) await cancel(ctx, b, "guest");
}

async function resolveComplaint(ctx: Ctx, complaintId: string, action: unknown, by?: number): Promise<string | null> {
  const c = (await ctx.store.listComplaints({})).find((x) => x.id === complaintId);
  if (!c) return "not found";
  if (c.resolved) return "already resolved";
  const l = await ctx.store.getListing(c.listingId);
  c.resolved = true;
  // «Удалить» — жалоба пустая или ложная: убираем из списка и не считаем против хозяина
  if (action === "dismiss") c.dismissed = true;
  await ctx.store.saveComplaint(c);
  if (l && action === "hide" && l.status === "active") {
    l.status = "blocked";
    l.moderatorNote = "Скрыто после жалобы гостя.";
    l.updatedAt = now(ctx);
    await ctx.store.saveListing(l);
    await send(ctx, l.ownerId, { text: `Объявление «${listingTitle(l)}» скрыто модератором после жалобы гостя. Если это ошибка, напишите сюда.` });
  }
  if (l && action === "ban") await banUser(ctx, l.ownerId, "Хозяин заблокирован модератором.");
  const verdict = action === "hide" ? "Объявление скрыто" : action === "ban" ? "Хозяин заблокирован" : action === "dismiss" ? "Жалоба удалена" : "Всё в порядке";
  await editAll(ctx, `c-${c.id}`, { text: `Жалоба на «${l ? listingTitle(l) : "объявление"}»\n${verdict}` });
  if (by != null) await audit(ctx, by, `жалоба: ${verdict.toLowerCase()}`, l ? `${listingTitle(l)}, ${l.locality} (${l.id})` : c.listingId);
  return null;
}

// --- вебхук MAX (события бота) ---------------------------------------------------

export async function handleWebhook(ctx: Ctx, secretHeader: string | undefined, update: any): Promise<Res> {
  if (!ctx.config.webhookSecret || !secretHeader || !safeEq(secretHeader, ctx.config.webhookSecret)) return fail(401, "bad secret");
  await processUpdate(ctx, update);
  return ok({ ok: true });
}

/** Фото из сообщения MAX: вложения type=image с payload.url и payload.token */
function photosOf(msg: any): Photo[] {
  return (msg?.body?.attachments ?? [])
    .filter((x: any) => x?.type === "image" && typeof x?.payload?.url === "string")
    .map((x: any) => ({ url: String(x.payload.url), token: typeof x.payload.token === "string" ? x.payload.token : undefined }));
}

export async function processUpdate(ctx: Ctx, update: any) {
  const type = update?.update_type;

  const hello = async (uid: number) => {
    if (await ctx.store.seenRecently(`hello-${uid}`, 30_000)) return;
    const buttons = ctx.config.botUsername
      ? [...(appButton(ctx, "Найти жильё") ?? []), ...(appButton(ctx, "Сдать квартиру", "host") ?? [])]
      : undefined;
    await send(ctx, uid, {
      text: "Здравствуйте! Здесь можно снять квартиру посуточно в Самаре и области или сдать свою. Размещение бесплатное.",
      buttons,
    });
  };

  const photosDone = async (u: User) => {
    const l = u.photosFor ? await ctx.store.getListing(u.photosFor) : undefined;
    u.photosFor = null;
    await ctx.store.saveUser(u);
    return l ? `Фото сохранены: ${l.photos.length}. Вернитесь в приложение, чтобы отправить объявление на проверку.` : "Готово.";
  };

  if (type === "bot_started") {
    const uid = update?.user?.user_id;
    if (uid) await hello(uid);
  }

  if (type === "message_created") {
    const msg = update?.message;
    const uid: number | undefined = msg?.sender?.user_id;
    if (!uid) return;
    const text: string = (msg?.body?.text ?? "").trim();
    const u = await ctx.store.getUser(uid);
    const photos = photosOf(msg);

    if (/^\/start(\s|$)/i.test(text)) return hello(uid);

    // Код команды: «/admin <код>», «/mod <код>» или просто сам код одним словом (латиница и цифры, от 8 знаков).
    // Не больше 5 попыток в час — код не перебрать
    const codeMsg = text.match(/^\/(?:admin|mod)\s+(\S+)$/i)?.[1] ?? (/^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : null);
    if (codeMsg && (ctx.config.adminCode || (await modCodeOf(ctx)))) {
      if (limited(`acode:${uid}`, 5)) return;
      const r = await tryCode(ctx, uid, u?.name ?? msg?.sender?.name ?? null, codeMsg);
      if (!r) {
        // Отвечаем только на явную команду, иначе обычное слово латиницей выглядело бы как «неверный пароль»
        if (text.startsWith("/")) await send(ctx, uid, { text: "Код не подходит." });
        return;
      }
      await send(ctx, uid, {
        text:
          r.role === "owner"
            ? "Готово: вы главный. Полный доступ к админке: объявления, брони, люди, команда, коды. Новые объявления и жалобы будут приходить сюда."
            : "Готово: вы модератор. В приложении появилась вкладка «Модератор»: проверка объявлений, заявки хозяев, жалобы.",
        buttons: appButton(ctx, "Открыть админку", "admin"),
      });
      return;
    }
    // Кнопка в админку для команды
    if (/^\/(?:panel|admin)$/i.test(text)) {
      if (!(await isAdmin(ctx, uid))) return;
      await send(ctx, uid, { text: "Админка — вкладка внизу мини-приложения.", buttons: appButton(ctx, "Открыть админку", "admin") });
      return;
    }
    if (u?.photosFor && photos.length) {
      if (limited(`photo:${uid}`, 120)) return;
      const l = await ctx.store.getListing(u.photosFor);
      if (!l || l.ownerId !== uid) return;
      const room = MAX_PHOTOS - l.photos.length;
      l.photos.push(...photos.slice(0, Math.max(0, room)));
      l.updatedAt = now(ctx);
      // Новое фото у опубликованного — модератор посмотрит его, объявление остаётся в поиске
      if (l.status === "active") l.checked = l.botChecked = false;
      await ctx.store.saveListing(l);
      // Несколько фото одним сообщением — один ответ; по одному — отвечаем на каждое, это нормально
      await send(ctx, uid, {
        text: room <= 0 ? `Уже ${MAX_PHOTOS} фото, больше не помещается.` : `Фото добавлено, всего ${l.photos.length}.`,
        buttons: [[{ type: "callback", text: "Готово", payload: "ph:done" }]],
      });
      return;
    }
    if (u?.photosFor && /^готово$/i.test(text)) {
      await send(ctx, uid, { text: await photosDone(u) });
      return;
    }
    // «Ответить» на уведомление о сообщении — ответ уходит в ту же переписку
    const repliedMid = msg?.link?.type === "reply" ? msg?.link?.message?.mid : undefined;
    const target = repliedMid ? await ctx.store.getReplyTarget(repliedMid) : undefined;
    if (target && text) {
      const th = await ctx.store.getThread(target.threadId);
      const mine = th && (target.as === "owner" ? th.ownerId === uid : th.guestId === uid);
      if (!th || !mine || u?.blocked) return;
      const r = await postChat(ctx, th, target.as, text);
      await send(ctx, uid, { text: typeof r === "string" ? "Не получилось отправить." : r.masked ? "Отправлено. Контакты в сообщениях скрываются: номер появится после подтверждения брони." : "Отправлено." });
      return;
    }
    if (text && !text.startsWith("/")) {
      await send(ctx, uid, {
        text: "Это бот площадки. Жильё ищется и сдаётся в приложении, а запросы на бронь и ответы хозяев приходят сюда.",
        buttons: appButton(ctx, "Открыть приложение"),
      });
    }
  }

  if (type === "message_callback") {
    const cb = update?.callback;
    const uid: number | undefined = cb?.user?.user_id;
    if (!uid) return;
    const [kind, action, id, extra] = String(cb?.payload ?? "").split(":");
    const answer = (n: string) => ctx.max.answerCallback(cb.callback_id, n).catch((e) => ctx.log(`answer: ${(e as Error).message}`));

    if (kind === "ph") {
      const u = await ctx.store.getUser(uid);
      return answer(u ? await photosDone(u) : "Готово.");
    }

    if (kind === "bk") {
      const b = await ctx.store.getBooking(id ?? "");
      if (!b || b.ownerId !== uid) return answer("Запрос не найден.");
      return answer(await decide(ctx, b, action === "ok"));
    }

    if (kind === "mod") {
      if (!(await isAdmin(ctx, uid))) return answer("Нет прав.");
      const l = await ctx.store.getListing(id ?? "");
      if (!l) return answer("Объявление не найдено.");
      const r = await moderate(ctx, l, action === "ok", REJECT_REASONS[extra ?? ""] ?? REJECT_REASONS.other, uid);
      return answer(r ? "Уже решено." : action === "ok" ? "Готово, объявление в поиске." : "Скрыто, хозяин получил причину.");
    }

    // Заявка хозяина: ha:ok:<человек>, ha:no:<человек>
    if (kind === "ha") {
      if (!(await isAdmin(ctx, uid))) return answer("Нет прав.");
      const r = await decideHost(ctx, Number(action === "ok" || action === "no" ? id : 0), action === "ok", "Заявка не подходит под правила площадки.", uid);
      return answer(r ? "Уже решено." : action === "ok" ? "Принято, человек может размещать объявления." : "Отказано, человеку отправлен ответ.");
    }

    // Оценка звёздами прямо в чате после выезда: rv:<бронь>:<1–5>
    if (kind === "rv") {
      const b = await ctx.store.getBooking(action ?? "");
      if (!b || b.guestId !== uid) return answer("Бронь не найдена.");
      const r = await addReview(ctx, b, int(id, 1, 5, 5), "");
      return answer(r === true ? "Спасибо за оценку! Отзыв словами можно оставить в приложении, в «Моём»." : "Оценка уже есть.");
    }

    // Жалобы: adm:hide:<объявление>:<жалоба>, adm:ok:<жалоба>, adm:ban:<хозяин>:<жалоба>
    if (kind === "adm") {
      if (!(await isAdmin(ctx, uid))) return answer("Нет прав.");
      if (action === "ban" && !(await isOwner(ctx, uid))) return answer("Блокировать людей может только главный.");
      const complaintId = action === "ok" ? id : extra;
      const r = await resolveComplaint(ctx, complaintId ?? "", action, uid);
      return answer(r ? "Уже решено." : action === "hide" ? "Объявление скрыто." : action === "ban" ? "Хозяин заблокирован, его объявления сняты." : "Жалоба закрыта.");
    }
  }
}

// --- таймер: раз в минуту ---------------------------------------------------------

export async function sweep(ctx: Ctx) {
  const t = now(ctx);
  const tomorrow = addDays(todaySamara(t), 1);
  for (const b of await ctx.store.listBookings({ status: HOLDING })) {
    try {
      const l = await ctx.store.getListing(b.listingId);
      if (!l) continue;
      // Хозяин не ответил вовремя — запрос отменяется, даты освобождаются
      if (b.status === "requested" && t > b.decideBy) {
        b.status = "expired";
        b.decidedAt = t;
        await ctx.store.saveBooking(b);
        await editAll(ctx, `b-${b.id}`, requestDecided(b, l));
        await send(ctx, b.guestId, notConfirmedToGuest(b, l, appButton(ctx, "Найти другое жильё")));
        continue;
      }
      // День выезда наступил — просим гостя оценить (один раз)
      if (b.status === "confirmed" && b.checkOut <= todaySamara(t) && !b.reviewAsked && !b.reviewed) {
        b.reviewAsked = true;
        await ctx.store.saveBooking(b);
        await send(ctx, b.guestId, reviewAsk(b, l));
        continue;
      }
      // За день до заезда — напоминание обоим
      if (b.status === "confirmed" && b.checkIn === tomorrow && !b.reminded) {
        b.reminded = true;
        await ctx.store.saveBooking(b);
        const [guest, owner] = await Promise.all([ctx.store.getUser(b.guestId), ctx.store.getUser(b.ownerId)]);
        await send(ctx, b.guestId, reminder(b, l, true, owner?.phone ?? null));
        await send(ctx, b.ownerId, reminder(b, l, false, guest?.phone ?? null));
      }
    } catch (e) {
      ctx.log(`sweep ${b.id}: ${(e as Error).message}`);
    }
  }
}
