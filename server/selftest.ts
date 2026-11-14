// Самопроверка сервера без MAX и без сети: npm run selftest
import type { Listing } from "../shared/types.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRange, price, todaySamara, addDays } from "../shared/dates.ts";
import { decideDeadline, handleApi, handleWebhook, processUpdate, sweep, wakeUnread, type Ctx } from "./handlers.ts";
import { signedInit } from "./selftest-init.ts";
import { docStore, memoryTable } from "./doc-store.ts";
import { fileStore } from "./store.ts";

let failed = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
  if (!cond) failed++;
};

// --- даты и цены -------------------------------------------------------------------
{
  // 2026-11-13 — пятница: ночи пт и сб по цене выходных
  const p = price({ priceWeekday: 2000, priceWeekend: 3000 }, "2026-11-12", "2026-11-16");
  check("4 ночи чт–вс: 2000 + 3000 + 3000 + 2000", p.nights === 4 && p.total === 10000);
  const base = { closed: ["2026-12-05"], minNights: 2 };
  const now = Date.parse("2026-11-10T12:00:00+04:00");
  check("занятая закрытая дата", checkRange(base, [], "2026-12-04", "2026-12-06", now) === "busy");
  check("выезд в закрытую дату — можно (ночь не занимает)", checkRange(base, [], "2026-12-03", "2026-12-05", now) === null);
  check("меньше минимума ночей", checkRange(base, [], "2026-12-10", "2026-12-11", now) === "too_short");
  check("прошлая дата", checkRange(base, [], "2026-11-01", "2026-11-04", now) === "past");
  check("выезд раньше заезда", checkRange(base, [], "2026-12-10", "2026-12-08", now) === "bad_dates");
  check("ночной запрос в 23:30 — ответить до 11:00 утра", decideDeadline(Date.parse("2026-11-10T23:30:00+04:00"), 3) === Date.parse("2026-11-11T11:00:00+04:00"));
  check("дневной запрос — 3 часа", decideDeadline(Date.parse("2026-11-10T13:00:00+04:00"), 3) === Date.parse("2026-11-10T16:00:00+04:00"));
  check("запрос в 20:00 (срок выпал бы на 23:00) — до 11:00 утра", decideDeadline(Date.parse("2026-11-10T20:00:00+04:00"), 3) === Date.parse("2026-11-11T11:00:00+04:00"));
}

// --- сервер ---------------------------------------------------------------------------
const token = "test-token";
const sent: { to: number; text: string; buttons: string[]; images: number }[] = [];
let clock = Date.parse("2026-11-10T12:00:00+04:00");
const ctx: Ctx = {
  // STORE=doc — те же проверки на облачном хранилище (таблица документов в памяти вместо YDB)
  store: process.env.STORE === "doc" ? docStore(memoryTable()) : fileStore(join(mkdtempSync(join(tmpdir(), "arenda-test-")), "db.json")),
  config: { botToken: token, adminCode: "code1", modCode: "moder-code-1", webhookSecret: "s", allowBrowser: false, decideHours: 3, botUsername: "test_bot", moderation: "pre" },
  log: () => {},
  now: () => clock,
  max: {
    async send(to, m) {
      sent.push({ to, text: m.text, buttons: (m.buttons ?? []).flat().map((b) => b.payload ?? b.url ?? ""), images: m.images?.length ?? 0 });
      return `m${sent.length}`;
    },
    async edit() {},
    async answerCallback() {},
    async subscribe() {},
    async me() {
      return {};
    },
    async updates() {
      return { updates: [] };
    },
  },
};
const call = async (path: string, uid: number, body: object = {}) => {
  const r = await handleApi(ctx, path, { ...body, initData: signedInit(token, uid, `U${uid}`) });
  return r as { status: number; json: any };
};
/** Тестовые хозяева: заявка «хочу сдавать» уже одобрена (саму заявку проверяем отдельно ниже) */
const approveHost = async (uid: number) => {
  const u = await ctx.store.getUser(uid);
  if (u) await ctx.store.saveUser({ ...u, hostStatus: "approved" });
};
const lastTo = (uid: number) => [...sent].reverse().find((s) => s.to === uid);

const HOST = 100;
const GUEST = 200;
const GUEST2 = 300;
const ADMIN = 1;

check("без MAX — отказ", (await handleApi(ctx, "/me", {})).status === 401);
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: ADMIN }, body: { text: "/admin code1" } } });
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 9 }, body: { text: "/admin wrong" } } });
check("/admin с верным кодом — модератор, с неверным — нет", JSON.stringify(await ctx.store.getAdmins()) === "[1]");

// Хозяин: без номера сохранить нельзя
check("анкета без номера — отказ", (await call("/host/save", HOST, { form: {} })).status === 400);
check("номер без согласия — отказ", (await call("/phone", HOST, { phone: "+79270000100" })).status === 400);
await call("/phone", HOST, { phone: "+79270000100", consent: true });
await approveHost(HOST);
const form = {
  type: "flat",
  locality: "Самара",
  district: "Ленинский",
  address: "ул. Молодогвардейская, 10",
  flat: "кв. 5",
  rooms: 1,
  area: 38,
  floor: 4,
  guests: 3,
  beds: 2,
  priceWeekday: 2500,
  priceWeekend: 3000,
  minNights: 1,
  deposit: 2000,
  checkIn: "14:00",
  checkOut: "12:00",
  rules: { pets: false, smoking: false, kids: true, parties: false },
  amenities: ["Wi-Fi", "Холодильник", "Взлом"],
  description: "Уютная квартира в центре, рядом набережная. Всё для жизни, чистое бельё.",
};
const saved = (await call("/host/save", HOST, { form })).json;
const L = saved.listing.id as string;
check("черновик сохранён, чужое удобство отброшено", saved.listing.status === "draft" && !saved.listing.amenities.includes("Взлом"));
check("без фото отправить нельзя", (await call("/host/submit", HOST, { id: L })).json.missing?.includes("фото (минимум 2)"));
check("чужой хозяин не видит черновик", (await call("/host/listing", GUEST, { id: L })).status === 404);

// Фото через чат бота
await call("/host/photos-request", HOST, { id: L });
check("бот попросил фото с кнопкой «Готово»", lastTo(HOST)?.buttons.includes("ph:done") === true);
const img = (n: number) => ({ type: "image", payload: { url: `https://i.oneme.ru/i?r=${n}`, token: `t${n}` } });
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST }, body: { text: "", attachments: [img(1), img(2)] } } });
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST }, body: { text: "", attachments: [img(3)] } } });
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: GUEST }, body: { text: "", attachments: [img(9)] } } });
check("3 фото хозяина в объявлении, чужое не попало", (await ctx.store.getListing(L))?.photos.length === 3);
await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: HOST }, payload: "ph:done" } });
check("после «Готово» фото больше не принимаются", (await ctx.store.getUser(HOST))?.photosFor === null);

// На модерацию
const sub = await call("/host/submit", HOST, { id: L });
check("отправлено на модерацию", sub.json.listing?.status === "pending");
const modMsg = lastTo(ADMIN);
check("модератору пришло объявление с фото и кнопками", !!modMsg && modMsg.images === 3 && modMsg.buttons.includes(`mod:ok:${L}`));
check("до одобрения в поиске нет", (await call("/search", GUEST, { locality: "Самара" })).json.cards.length === 0);
await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: 9 }, payload: `mod:ok:${L}` } });
check("не модератор одобрить не может", (await ctx.store.getListing(L))?.status === "pending");
await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `mod:ok:${L}` } });
check("модератор одобрил — объявление в поиске", (await ctx.store.getListing(L))?.status === "active");
check("хозяину сообщили", lastTo(HOST)?.text.includes("прошло проверку") === true);

// Гость ищет и смотрит
const d1 = addDays(todaySamara(clock), 3);
const d3 = addDays(d1, 2);
const found = (await call("/search", GUEST, { locality: "Самара", checkIn: d1, checkOut: d3, guests: 2 })).json.cards;
check("в поиске есть, с суммой за даты", found.length === 1 && found[0].nights === 2 && found[0].total > 0);
check("на 4 гостей не находится (вмещает 3)", (await call("/search", GUEST, { guests: 4 })).json.cards.length === 0);
const pub = (await call("/listing", GUEST, { id: L })).json.listing;
check("гость видит улицу и дом, но не квартиру и не id хозяина", pub.address === "ул. Молодогвардейская, 10" && !("flat" in pub) && !("ownerId" in pub));

// Бронь
check("бронь без номера — отказ", (await call("/book", GUEST, { id: L, checkIn: d1, checkOut: d3, guests: 2 })).status === 400);
await call("/phone", GUEST, { phone: "+79270000200", consent: true });
await call("/phone", GUEST2, { phone: "+79270000300", consent: true });
check("хозяин не бронирует своё", (await call("/book", HOST, { id: L, checkIn: d1, checkOut: d3, guests: 1 })).status === 400);
const bk = await call("/book", GUEST, { id: L, checkIn: d1, checkOut: d3, guests: 2, comment: "Приедем вечером" });
const B = bk.json.booking?.id as string;
check("запрос на бронь создан", bk.status === 200 && bk.json.booking.status === "requested");
check("хозяину пришёл запрос с кнопками", lastTo(HOST)?.buttons.includes(`bk:ok:${B}`) === true);
check("в запросе хозяину нет телефона гостя", !lastTo(HOST)?.text.includes("927 000-02-00"));
check("повторный запрос того же гостя — отказ", (await call("/book", GUEST, { id: L, checkIn: d1, checkOut: d3, guests: 2 })).status === 409);
check("другой гость на те же даты — занято", (await call("/book", GUEST2, { id: L, checkIn: addDays(d1, 1), checkOut: addDays(d3, 1), guests: 1 })).json.problem === "busy");
check("в поиске на эти даты уже нет", (await call("/search", GUEST2, { checkIn: d1, checkOut: d3 })).json.cards.length === 0);

await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST2 }, payload: `bk:ok:${B}` } });
check("чужой не может принять бронь", (await ctx.store.getBooking(B))?.status === "requested");
await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: HOST }, payload: `bk:ok:${B}` } });
check("хозяин принял — бронь подтверждена", (await ctx.store.getBooking(B))?.status === "confirmed");
check("гость получил адрес и телефон хозяина", !!lastTo(GUEST)?.text.includes("Молодогвардейская") && !!lastTo(GUEST)?.text.includes("927 000-01-00"));
const myB = (await call("/my/bookings", GUEST)).json.bookings[0];
check("в «Моих бронях» адрес и телефон после подтверждения", myB.address?.includes("Молодогвардейская") && myB.phone === "+79270000100");
const hostB = (await call("/host/bookings", HOST)).json.bookings[0];
check("хозяин видит телефон гостя после подтверждения", hostB.phone === "+79270000200");

// Напоминание за день
clock = Date.parse(`${addDays(d1, -1)}T10:00:00+04:00`);
await sweep(ctx);
check("за день до заезда — напоминание обоим", lastTo(GUEST)?.text.startsWith("Завтра заезд") === true && lastTo(HOST)?.text.startsWith("Завтра заезжает") === true);
const nRem = sent.length;
await sweep(ctx);
check("напоминание не дублируется", sent.length === nRem);
// Часы обратно: подпись MAX действует час, а мы «прыгали» на дни вперёд
clock = Date.parse("2026-11-10T12:00:00+04:00");

// Отмена гостем — даты освобождаются
check("чужой не отменит", (await call("/booking/cancel", GUEST2, { id: B })).status === 404);
await call("/booking/cancel", GUEST, { id: B });
check("гость отменил — хозяину сообщили", (await ctx.store.getBooking(B))?.status === "cancelled" && lastTo(HOST)?.text.startsWith("Гость отменил") === true);
const b2 = await call("/book", GUEST2, { id: L, checkIn: d1, checkOut: d3, guests: 1 });
check("после отмены даты снова можно забронировать", b2.status === 200);

// Хозяин не ответил — запрос отменяется сам
const B2 = b2.json.booking.id as string;
clock = (await ctx.store.getBooking(B2))!.decideBy + 60_000;
await sweep(ctx);
clock = Date.parse("2026-11-10T12:00:00+04:00");
check("нет ответа вовремя — запрос отменён", (await ctx.store.getBooking(B2))?.status === "expired");
check("гостю предложили искать другое", lastTo(GUEST2)?.text.includes("не успел ответить") === true);
clock = Date.parse("2026-11-10T12:00:00+04:00");

// Календарь хозяина
await call("/host/calendar", HOST, { id: L, close: [d1, "2020-01-01", "мусор"] });
check("закрытая хозяином дата сохранилась, прошлая и мусор отброшены", JSON.stringify((await ctx.store.getListing(L))?.closed) === JSON.stringify([d1]));
check("закрытая дата — занято для гостя", (await call("/quote", GUEST, { id: L, checkIn: d1, checkOut: d3 })).json.problem === "busy");

// Правка опубликованного: цена — без модерации, описание — снова к модератору
await call("/host/save", HOST, { id: L, form: { priceWeekday: 2700 } });
check("цена поменялась без модерации", (await ctx.store.getListing(L))?.status === "active");
await call("/host/save", HOST, { id: L, form: { description: form.description + " Есть парковка во дворе." } });
check("новое описание — снова на проверку", (await ctx.store.getListing(L))?.status === "pending" && lastTo(ADMIN)?.text.startsWith("Объявление изменено") === true);
await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `mod:no:${L}:photos` } });
check("отклонено с причиной, хозяин её получил", (await ctx.store.getListing(L))?.status === "rejected" && lastTo(HOST)?.text.includes("фото получше") === true);
check("клиент не может модерировать", (await call("/admin/moderate", GUEST, { id: L, ok: true })).status === 403);

// --- Публикация сразу (проверка после), защита от обмана, отзывы, избранное ------------------
ctx.config.moderation = "post";
{
  const HOST2 = 110;
  await call("/phone", HOST2, { phone: "+79270000110", consent: true });
await approveHost(HOST2);
  check("телефон в описании — не сохраняется", (await call("/host/save", HOST2, { form: { ...form, description: "Звоните 8 927 111-22-33, отвечу быстро и покажу квартиру" } })).json.error === "contacts");
  check("«пишите в WhatsApp» — не сохраняется", (await call("/host/save", HOST2, { form: { ...form, description: "Квартира в центре, все вопросы пишите в вотсап, отвечу быстро" } })).json.error === "contacts");
  check("ссылка в описании — не сохраняется", (await call("/host/save", HOST2, { form: { ...form, description: "Подробнее с фото смотрите на сайте kvartira-samara.ru пожалуйста" } })).json.error === "contacts");
  const s2 = (await call("/host/save", HOST2, { form: { ...form, address: "ул. Ленинская, 5", cancelDays: 3 } })).json;
  const L2 = s2.listing.id as string;
  check("правило отмены «за 3 дня» сохранилось", s2.listing.cancelDays === 3);
  await call("/host/photos-request", HOST2, { id: L2 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST2 }, body: { text: "", attachments: [img(21), img(22), img(23)] } } });
  const toAdminBefore = sent.filter((m) => m.to === ADMIN).length;
  const sub2 = (await call("/host/submit", HOST2, { id: L2 })).json;
  check("без подозрений — сразу в поиске", sub2.live === true && (await ctx.store.getListing(L2))?.status === "active");
  check("хозяину в личку не пишем — статус виден в приложении", lastTo(HOST2)?.text.includes("уже в поиске") !== true);
  check("бот проверил сам: отметка «проверено ботом», модератора не дёргаем", (await ctx.store.getListing(L2))?.botChecked === true && sent.filter((m) => m.to === ADMIN).length === toAdminBefore);
  check("сразу находится в поиске", (await call("/search", GUEST, { locality: "Самара" })).json.cards.some((c: any) => c.id === L2));
  const before = sent.length;
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `mod:ok:${L2}` } });
  check("одобренное ботом не висит в «Проверке» и хозяину лишнего не пишем", (await ctx.store.getListing(L2))?.checked === true && sent.length === before);

  // Подозрительная цена — ждёт проверки, в поиск не попадает
  const HOST3 = 120;
  await call("/phone", HOST3, { phone: "+79270000120", consent: true });
await approveHost(HOST3);
  const L3 = (await call("/host/save", HOST3, { form: { ...form, priceWeekday: 300, priceWeekend: 300 } })).json.listing.id as string;
  await call("/host/photos-request", HOST3, { id: L3 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST3 }, body: { text: "", attachments: [img(31), img(32), img(33)] } } });
  const sub3 = (await call("/host/submit", HOST3, { id: L3 })).json;
  check("цена 500 ₽ — подозрительно, ждёт проверки", sub3.live === false && (await ctx.store.getListing(L3))?.status === "pending");
  check("модератору видна причина", lastTo(ADMIN)?.text.includes("нереально низкая цена") === true);
  check("подозрительного нет в поиске", !(await call("/search", GUEST, {})).json.cards.some((c: any) => c.id === L3));

  // Избранное
  await call("/favorite", GUEST, { id: L2, on: true });
  check("избранное: добавилось", (await call("/favorites", GUEST)).json.cards.some((c: any) => c.id === L2));
  check("в карточке видно «в избранном»", (await call("/listing", GUEST, { id: L2 })).json.listing.favorite === true);
  await call("/favorite", GUEST, { id: L2, on: false });
  check("избранное: убралось", (await call("/favorites", GUEST)).json.cards.length === 0);

  // Поздняя отмена: бесплатно за 3 дня, а гость отменяет за 1
  const dIn = addDays(todaySamara(clock), 1);
  const bk2 = (await call("/book", GUEST, { id: L2, checkIn: dIn, checkOut: addDays(dIn, 2), guests: 1 })).json.booking.id as string;
  await call("/host/decide", HOST2, { id: bk2, accept: true });
  await call("/booking/cancel", GUEST, { id: bk2 });
  check("отмена позже срока — отмечена, хозяин узнал", (await ctx.store.getBooking(bk2))?.lateCancel === true && lastTo(HOST2)?.text.includes("позже срока") === true);

  // Отзыв: после выезда бот просит оценку, звёзды прямо в чате
  const dIn2 = addDays(todaySamara(clock), 2);
  const bk3 = (await call("/book", GUEST, { id: L2, checkIn: dIn2, checkOut: addDays(dIn2, 1), guests: 1 })).json.booking.id as string;
  await call("/host/decide", HOST2, { id: bk3, accept: true });
  check("до выезда оценить нельзя", (await call("/review", GUEST, { bookingId: bk3, stars: 5 })).status === 400);
  clock = Date.parse(`${addDays(dIn2, 1)}T13:00:00+04:00`);
  await sweep(ctx);
  check("после выезда бот попросил оценку кнопками", lastTo(GUEST)?.buttons.includes(`rv:${bk3}:5`) === true);
  // Кнопки в чате нажимают уже после выезда — часы пока не возвращаем (кнопкам подпись MAX не нужна)
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST2 }, payload: `rv:${bk3}:1` } });
  check("чужой не оценит чужую бронь", !(await ctx.store.getListing(L2))?.rating);
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST }, payload: `rv:${bk3}:5` } });
  check("оценка 5 сохранилась в рейтинге", (await ctx.store.getListing(L2))?.rating?.count === 1 && (await ctx.store.getListing(L2))?.rating?.sum === 5);
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST }, payload: `rv:${bk3}:1` } });
  check("второй раз оценить нельзя", (await ctx.store.getListing(L2))?.rating?.count === 1);
  clock = Date.parse("2026-11-10T12:00:00+04:00");
  check("в поиске видно звёзды", (await call("/search", GUEST, { sort: "rating" })).json.cards[0]?.stars === 5);

  // Жалоба → скрыть; жалоба → заблокировать хозяина
  check("на своё жаловаться нельзя", (await call("/complaint", HOST2, { id: L2, reason: "fake" })).status === 404);
  await call("/complaint", GUEST, { id: L2, reason: "prepay", text: "Просит перевести 3000 на карту" });
  const cmsg = lastTo(ADMIN);
  check("жалоба пришла модератору с кнопками", cmsg?.text.startsWith("Жалоба") === true && cmsg.buttons.some((b) => b.startsWith(`adm:hide:${L2}`)) && cmsg.buttons.some((b) => b.includes(`startapp=l_${L2}`)));
  const cid = cmsg!.buttons.find((b) => b.startsWith("adm:ok:"))!.split(":")[2];
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST }, payload: `adm:hide:${L2}:${cid}` } });
  check("не модератор жалобу не решит", (await ctx.store.getListing(L2))?.status === "active");
  check("клиент не видит жалобы через API", (await call("/admin/pending", GUEST)).status === 403);
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `adm:ban:${HOST2}:${cid}` } });
  check("хозяин заблокирован, объявление снято", (await ctx.store.getUser(HOST2))?.blocked === true && (await ctx.store.getListing(L2))?.status === "blocked");
  check("заблокированный не может ничего делать", (await call("/host/listings", HOST2)).status === 403);
  check("снятого нет в поиске", !(await call("/search", GUEST, {})).json.cards.some((c: any) => c.id === L2));

  // Доступ к чужому (OWASP API1: чужие объекты по id)
  check("чужое объявление не править", [403, 404].includes((await call("/host/save", GUEST, { id: L3, form: { priceWeekday: 1 } })).status));
  check("чужой календарь не трогать", (await call("/host/calendar", GUEST, { id: L3, close: [dIn] })).status === 404);
  check("чужие фото не удалять", (await call("/host/photos", GUEST, { id: L3, order: [] })).status === 404);
  check("чужую бронь не отменить и не принять", (await call("/host/decide", GUEST2, { id: bk3, accept: false })).status === 404);
  check("чужой отзыв не оставить", (await call("/review", GUEST2, { bookingId: bk3, stars: 1 })).status === 404);
  check("по чужому id в карточке нет квартиры", !("flat" in ((await call("/listing", GUEST, { id: L3 })).json.listing ?? {})));
}

// --- Переписка гостя с хозяином до брони ---------------------------------------------
{
  const HOST4 = 130;
  await call("/phone", HOST4, { phone: "+79270000130", consent: true });
await approveHost(HOST4);
  // Своё описание: одинаковый текст у разных хозяев бот отправляет модератору (это проверяется ниже)
  const L4 = (await call("/host/save", HOST4, { form: { ...form, address: "ул. Садовая, 7", description: "Студия у Струкачёвского парка, свежий ремонт, рядом остановка, магазин и аптека. Заселение по звонку." } })).json.listing.id as string;
  await call("/host/photos-request", HOST4, { id: L4 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST4 }, body: { text: "", attachments: [img(41), img(42), img(43)] } } });
  await call("/host/submit", HOST4, { id: L4 });

  check("хозяин не пишет сам себе", (await call("/chat/open", HOST4, { listingId: L4 })).status === 400);
  const op = (await call("/chat/open", GUEST, { listingId: L4 })).json;
  const TH = op.thread.id as string;
  check("переписка открыта, гость видит «Хозяин», а не имя", op.thread.otherName === "Хозяин" && op.messages.length === 0);
  check("повторное открытие — та же переписка", (await call("/chat/open", GUEST, { listingId: L4 })).json.thread.id === TH);
  check("пустая переписка не видна в списке", (await call("/chat/list", HOST4)).json.threads.length === 0);

  const s1 = (await call("/chat/send", GUEST, { id: TH, text: "Здравствуйте! Можно заехать в 22:00? Мой номер 8 927 555-66-77" })).json;
  check("номер в сообщении скрыт", s1.masked === true && !s1.text.includes("555") && s1.text.includes("[скрыто]"));
  check("сразу в личку MAX не пишем", !lastTo(HOST4)?.text.startsWith("Сообщение от гостя"));
  const base4 = clock;
  clock += 31 * 60_000;
  await wakeUnread(ctx, clock);
  const note = lastTo(HOST4);
  check("не прочитал 30 минут — пришло напоминание с вопросом и кнопкой", !!note?.text.startsWith("Сообщение от гостя") && note.buttons.some((b) => b.includes("startapp=chat_")));
  check("в уведомлении хозяину номер тоже скрыт", !note?.text.includes("555"));
  check("у хозяина 1 непрочитанное", (await call("/me", HOST4)).json.unread === 1);

  // Хозяин отвечает прямо в чате MAX — «Ответить» на уведомление
  const noteMid = `m${sent.indexOf(note!) + 1}`;
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST4 }, body: { text: "Да, можно, встречу у подъезда" }, link: { type: "reply", message: { mid: noteMid } } } });
  clock += 31 * 60_000;
  await wakeUnread(ctx, clock);
  check("гостю через 30 минут пришёл ответ хозяина", lastTo(GUEST)?.text.startsWith("Ответ хозяина") === true);
  const msgs = (await call("/chat/thread", GUEST, { id: TH })).json.messages;
  check("ответ хозяина из чата MAX попал в переписку", msgs.length === 2 && msgs[1].from === "owner" && msgs[1].text.includes("встречу"));
  check("ответ из MAX без лишнего «Отправлено»", lastTo(HOST4)?.text !== "Отправлено.");
  clock = base4;
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: GUEST2 }, body: { text: "Влезаю в чужую переписку" }, link: { type: "reply", message: { mid: noteMid } } } });
  check("чужой «ответ» на уведомление не попадает в переписку", (await call("/chat/thread", GUEST, { id: TH })).json.messages.length === 2);

  check("чужой не читает переписку", (await call("/chat/thread", GUEST2, { id: TH })).status === 404);
  check("чужой не пишет в переписку", (await call("/chat/send", GUEST2, { id: TH, text: "спам" })).status === 404);
  await call("/chat/thread", HOST4, { id: TH });
  check("открыл — прочитано", (await call("/me", HOST4)).json.unread === 0);
  const hl = (await call("/chat/list", HOST4)).json.threads;
  check("хозяин видит переписку в списке с именем гостя", hl.length === 1 && hl[0].role === "owner" && hl[0].otherName === "U200");
  check("пустое сообщение не отправляется", (await call("/chat/send", GUEST, { id: TH, text: "   " })).status === 400);
}

// --- Переписка: без спама уведомлениями, заблокированному не написать -------------------
{
  const HOST5 = 140;
  await call("/phone", HOST5, { phone: "+79270000140", consent: true });
await approveHost(HOST5);
  const L5 = (await call("/host/save", HOST5, { form: { ...form, address: "ул. Луговая, 3", description: `Жильё по адресу ${"ул. Луговая, 3"}, тихо` } })).json.listing.id as string;
  await call("/host/photos-request", HOST5, { id: L5 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST5 }, body: { text: "", attachments: [img(51), img(52), img(53)] } } });
  await call("/host/submit", HOST5, { id: L5 });
  const TH5 = (await call("/chat/open", GUEST2, { listingId: L5 })).json.thread.id as string;
  const wakes = () => sent.filter((s) => s.to === HOST5 && s.text.startsWith("Сообщение от гостя")).length;
  await call("/chat/send", GUEST2, { id: TH5, text: "Добрый вечер" });
  await call("/chat/send", GUEST2, { id: TH5, text: "Свободно на выходные?" });
  await call("/chat/send", GUEST2, { id: TH5, text: "И парковка есть?" });
  clock += 10 * 60_000;
  await wakeUnread(ctx, clock);
  check("10 минут — ещё не будим", wakes() === 0);
  clock += 21 * 60_000;
  await wakeUnread(ctx, clock);
  check("3 сообщения подряд — одно напоминание через 30 минут", wakes() === 1 && lastTo(HOST5)!.text.includes("непрочитанных: 3"));
  await wakeUnread(ctx, clock + 60 * 60_000);
  check("повторно то же не шлём", wakes() === 1);
  check("но все 3 сообщения сохранены", (await call("/chat/thread", HOST5, { id: TH5 })).json.messages.length === 3);
  await call("/chat/send", GUEST2, { id: TH5, text: "Ответьте, пожалуйста" });
  await call("/chat/thread", HOST5, { id: TH5 });
  clock += 31 * 60_000;
  await wakeUnread(ctx, clock);
  check("прочитал в приложении — напоминания нет", wakes() === 1);
  await call("/chat/send", GUEST2, { id: TH5, text: "Так есть парковка?" });
  clock += 31 * 60_000;
  await wakeUnread(ctx, clock);
  check("новое непрочитанное — снова одно напоминание", wakes() === 2);
  clock = Date.parse("2026-11-10T12:00:00+04:00");
}

// --- Админка: главный, модераторы, люди, журнал --------------------------------------
{
  const MOD = 150;
  await call("/phone", MOD, { phone: "+79270000150", consent: true });
  check("первый вошедший по коду — главный", (await call("/me", ADMIN)).json.owner === true);
  check("клиент не видит команду", (await call("/admin/staff", GUEST)).status === 403);
  const say = (uid: number, text: string) => processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: uid }, body: { text } } });
  check("у простого человека админки нет", (await call("/me", GUEST)).json.admin === false && (await call("/admin/pending", GUEST)).status === 403);
  // Как в калькуляторе: прислал боту код модераторов — открылась админка с ограниченными правами
  await say(MOD, "moder-code-1");
  check("код модераторов боту (просто текстом) — человек модератор", (await ctx.store.getAdmins()).includes(MOD));
  check("модератору пришло «вы модератор» с кнопкой админки", lastTo(MOD)?.text.startsWith("Готово: вы модератор") === true && !!lastTo(MOD)?.buttons.some((b) => b.includes("startapp=admin")));
  check("главному пришло сообщение о новом модераторе", lastTo(ADMIN)?.text.startsWith("Новый модератор по коду") === true);
  check("модератор видит админку, но не главный", (await call("/me", MOD)).json.admin === true && (await call("/me", MOD)).json.owner === false);
  check("модератору недоступны люди, команда, история, коды", (await call("/admin/users", MOD)).status === 403 && (await call("/admin/staff", MOD)).status === 403 && (await call("/admin/audit", MOD)).status === 403 && (await call("/admin/modcode", MOD)).status === 403);
  // Главный меняет код модераторов — старый перестаёт работать
  const mc = (await call("/admin/modcode", ADMIN, { rotate: true })).json.code as string;
  check("главный сменил код модераторов", typeof mc === "string" && mc.length >= 8 && mc !== "moder-code-1");
  await say(666, "moder-code-1");
  check("старый код модераторов больше не работает", !(await ctx.store.getAdmins()).includes(666));
  await say(667, `/mod ${mc}`);
  check("новый код работает", (await ctx.store.getAdmins()).includes(667));
  await call("/admin/staff/remove", ADMIN, { id: 667 });
  check("модератор не снимает главного", (await call("/admin/staff/remove", MOD, { id: ADMIN })).status === 403);
  check("последнего главного не снять", (await call("/admin/staff/remove", ADMIN, { id: ADMIN })).json.error === "last owner");

  // Модератор работает: решение попадает в журнал под его именем
  const HOST6 = 160;
  await call("/phone", HOST6, { phone: "+79270000160", consent: true });
await approveHost(HOST6);
  const L6 = (await call("/host/save", HOST6, { form: { ...form, address: "ул. Полевая, 9", description: `Жильё по адресу ${"ул. Полевая, 9"}, тихо`, priceWeekday: 300, priceWeekend: 400 } })).json.listing.id as string;
  await call("/host/photos-request", HOST6, { id: L6 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST6 }, body: { text: "", attachments: [img(61), img(62), img(63)] } } });
  await call("/host/submit", HOST6, { id: L6 });
  check("подозрительное: бот отправил модератору с причиной", lastTo(MOD)?.text.includes("ждёт проверки (нереально низкая цена") === true);
  await call("/admin/moderate", MOD, { id: L6, ok: false, reason: "photos" });
  const log = (await call("/admin/audit", ADMIN)).json.entries;
  check("в журнале: модератор отклонил объявление", log[0]?.by === MOD && log[0]?.action === "отклонил объявление" && log[0]?.byName === "U150");
  check("модератор не возвращает отклонённое — только главный", (await call("/admin/restore", MOD, { id: L6 })).status === 403);
  await call("/admin/restore", ADMIN, { id: L6 });
  check("главный вернул объявление в поиск", (await ctx.store.getListing(L6))?.status === "active");

  // Люди: поиск и блокировка
  const found = (await call("/admin/users", ADMIN, { q: "0000160" })).json.users;
  check("поиск человека по номеру", found.length === 1 && found[0].id === HOST6 && found[0].listings === 1);
  check("модератор не блокирует людей вообще", (await call("/admin/user/block", MOD, { id: HOST6, blocked: true })).status === 403);
  check("себя заблокировать нельзя", (await call("/admin/user/block", ADMIN, { id: ADMIN, blocked: true })).json.error === "bad user");
  await call("/admin/user/block", ADMIN, { id: HOST6, blocked: true, note: "Чужие фото" });
  check("блокировка: человек и его объявления сняты", (await ctx.store.getUser(HOST6))?.blocked === true && (await ctx.store.getListing(L6))?.status === "blocked");
  const TH6 = (await ctx.store.listThreads(HOST6))[0];
  check("заблокированному нельзя вернуть объявление", (await call("/admin/restore", ADMIN, { id: L6 })).json.error === "owner blocked");
  await call("/admin/user/block", ADMIN, { id: HOST6, blocked: false });
  check("разблокировка вернула доступ", (await call("/host/listings", HOST6)).status === 200);
  check("переписок у заблокированного не было — проверка не упала", TH6 === undefined);

  const st = (await call("/admin/stats", MOD)).json;
  check("цифры: люди, объявления, брони", st.users > 5 && st.listings.active >= 1 && typeof st.bookingsWeek === "number");
  await call("/admin/staff/remove", ADMIN, { id: MOD });
  check("главный снял модератора — доступ закрыт", (await call("/admin/stats", MOD)).status === 403);
}

// --- Заявка «хочу сдавать», лимиты против ложных броней, фото из приложения -------------------
{
  const NEWBIE = 170;
  await call("/phone", NEWBIE, { phone: "+79270000170", consent: true });
  check("без одобренной заявки объявление не создать", (await call("/host/save", NEWBIE, { form })).json.error === "not host");
  check("статус «нет заявки»", (await call("/me", NEWBIE)).json.host === "none");
  check("заявка без имени — отказ", (await call("/host/apply", NEWBIE, { name: "", city: "Самара" })).status === 400);
  await call("/host/apply", NEWBIE, { name: "Ольга Петрова", city: "Самара", about: "Две квартиры в центре" });
  check("заявка подана, ждёт решения", (await call("/me", NEWBIE)).json.host === "pending");
  const appMsg = lastTo(ADMIN);
  check("модератору пришла заявка с кнопками «Принять» и «Отказать»", !!appMsg?.text.startsWith("Заявка на размещение") && appMsg.buttons.includes(`ha:ok:${NEWBIE}`) && appMsg.buttons.includes(`ha:no:${NEWBIE}`));
  check("повторно подать нельзя, пока ждёт", (await call("/host/apply", NEWBIE, { name: "Ольга", city: "Самара" })).status === 409);
  check("клиент не видит заявки", (await call("/admin/applications", GUEST)).status === 403);
  check("заявка в списке у модератора", (await call("/admin/applications", ADMIN)).json.applications.some((a: any) => a.id === NEWBIE && a.name === "Ольга Петрова"));
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: GUEST }, payload: `ha:ok:${NEWBIE}` } });
  check("не модератор не примет заявку", (await call("/me", NEWBIE)).json.host === "pending");
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `ha:ok:${NEWBIE}` } });
  check("модератор принял — можно размещать", (await call("/me", NEWBIE)).json.host === "approved" && lastTo(NEWBIE)?.text.startsWith("Заявка одобрена") === true);
  const L7 = (await call("/host/save", NEWBIE, { form: { ...form, address: "ул. Новая, 1", description: `Жильё по адресу ${"ул. Новая, 1"}, тихо` } })).json.listing?.id as string;
  check("после одобрения черновик создаётся", !!L7);

  // Фото прямо из приложения
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]).toString("base64");
  const up = await call("/host/photo-upload", NEWBIE, { id: L7, data: `data:image/jpeg;base64,${jpeg}` });
  check("фото из приложения сохранилось", up.status === 200 && up.json.listing.photos.length === 1 && up.json.listing.photos[0].url.startsWith("/api/photos/"));
  check("не JPEG (подмена) — отказ", (await call("/host/photo-upload", NEWBIE, { id: L7, data: Buffer.from("<script>alert(1)</script>".repeat(80)).toString("base64") })).json.error === "bad image");
  check("в чужое объявление фото не загрузить", (await call("/host/photo-upload", GUEST, { id: L7, data: jpeg })).status === 404);
  const name = up.json.listing.photos[0].url.split("/").pop();
  check("фото читается по имени", !!(await ctx.store.readPhoto(name)));
  check("путь с ../ не читается", !(await ctx.store.readPhoto("../db.json")));

  // Отказ в заявке
  const NEWBIE2 = 171;
  await call("/phone", NEWBIE2, { phone: "+79270000171", consent: true });
  await call("/host/apply", NEWBIE2, { name: "Иван", city: "Тольятти" });
  await call("/admin/application", ADMIN, { id: NEWBIE2, ok: false, note: "Нужны фото документов на квартиру." });
  const me2 = (await call("/me", NEWBIE2)).json;
  check("отказ: статус и причина видны человеку", me2.host === "rejected" && me2.hostNote === "Нужны фото документов на квартиру.");
  check("после отказа можно подать снова", (await call("/host/apply", NEWBIE2, { name: "Иван Сидоров", city: "Тольятти" })).status === 200);

  // Лимит запросов: не больше трёх, ждущих ответа
  const G = 180;
  await call("/phone", G, { phone: "+79270000180", consent: true });
  // Отдельный хозяин с четырьмя опубликованными объявлениями — чтобы было куда слать запросы
  const HG = 190;
  await call("/phone", HG, { phone: "+79270000190", consent: true });
  await approveHost(HG);
  const actives = [];
  for (const n of [1, 2, 3, 4]) {
    const id = (await call("/host/save", HG, { form: { ...form, address: `ул. Лимитная, ${n}`, description: `Лимитная ${n}: светло, тихо` } })).json.listing.id as string;
    await call("/host/photos-request", HG, { id });
    await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HG }, body: { text: "", attachments: [img(70 + n * 3), img(71 + n * 3), img(72 + n * 3)] } } });
    await call("/host/submit", HG, { id });
    actives.push((await ctx.store.getListing(id))!);
  }
  const day = addDays(todaySamara(clock), 40);
  const codes: number[] = [];
  for (const [i, l] of actives.entries()) {
    const r = await call("/book", G, { id: l.id, checkIn: addDays(day, i * 3), checkOut: addDays(day, i * 3 + 1), guests: 1 });
    codes.push(r.status);
    if (r.status !== 200 && i < 3) console.log("  отладка:", l.id, l.minNights, JSON.stringify(r.json));
  }
  check("4-й одновременный запрос — отказ (лимит 3)", actives.length === 4 && codes.slice(0, 3).every((c) => c === 200) && codes[3] === 409);
  check("бронь дальше чем на 180 дней — нельзя", (await call("/quote", G, { id: actives[0].id, checkIn: addDays(todaySamara(clock), 200), checkOut: addDays(todaySamara(clock), 201) })).json.problem === "too_far");

  // «Гость не приехал» дважды — бронировать больше нельзя
  const G2 = 181;
  await call("/phone", G2, { phone: "+79270000181", consent: true });
  const target = actives[3];
  for (const k of [0, 1]) {
    const dIn = addDays(todaySamara(clock), 60 + k * 5);
    const b = (await call("/book", G2, { id: target.id, checkIn: dIn, checkOut: addDays(dIn, 1), guests: 1 })).json.booking.id as string;
    await call("/host/decide", target.ownerId, { id: b, accept: true });
    check(`«не приехал» до заезда отметить нельзя (${k + 1})`, (await call("/host/noshow", target.ownerId, { id: b })).json.error === "too early");
    // Заезд «уже был»: сдвигаем бронь в прошлое (часы не трогаем — подпись MAX живёт час)
    const past = addDays(todaySamara(clock), -1 - k * 3);
    await ctx.store.saveBooking({ ...(await ctx.store.getBooking(b))!, checkIn: past, checkOut: addDays(past, 1), reviewAsked: true });
    const r = await call("/host/noshow", target.ownerId, { id: b });
    check(`хозяин отметил «не приехал» (${k + 1})`, r.status === 200 && (await ctx.store.getBooking(b))?.status === "noshow");
  }
  check("гостю два предупреждения — бронирование закрыто", (await call("/me", G2)).json.bookingBanned === true);
  check("и новая бронь не проходит", (await call("/book", G2, { id: actives[2].id, checkIn: addDays(todaySamara(clock), 90), checkOut: addDays(todaySamara(clock), 91), guests: 1 })).json.error === "booking banned");
  check("чужой не отметит «не приехал»", (await call("/host/noshow", GUEST, { id: "nope" })).status === 404);

  // Удалить бронь из списка: действующую нельзя, завершённую можно
  const mine = (await call("/my/bookings", G)).json.bookings;
  check("ждущую ответа бронь удалить нельзя — сначала отменить", (await call("/booking/hide", G, { id: mine[0].id })).json.error === "active booking");
  await call("/booking/cancel", G, { id: mine[0].id });
  await call("/booking/hide", G, { id: mine[0].id });
  check("отменённая бронь убрана из списка", !(await call("/my/bookings", G)).json.bookings.some((b: any) => b.id === mine[0].id));
}

// --- Повтор отправки: связь мигнула, приложение отправило ещё раз -----------------------
{
  const G3 = 182;
  await call("/phone", G3, { phone: "+79270000182", consent: true });
  const target = (await ctx.store.listListings({ status: ["active"] })).find((l) => l.ownerId !== G3)!;
  const dIn = addDays(todaySamara(clock), 120);
  const p = { id: target.id, checkIn: dIn, checkOut: addDays(dIn, 1), guests: 1, key: "try-1" };
  const toOwner = () => sent.filter((m) => m.to === target.ownerId).length;
  const before = toOwner();
  const a = await call("/book", G3, p);
  const b = await call("/book", G3, p);
  check("повтор брони с той же меткой — та же бронь, а не ошибка", a.status === 200 && b.status === 200 && a.json.booking.id === b.json.booking.id);
  check("хозяину ушёл один запрос, а не два", toOwner() === before + 1);
  check("новая попытка на то же жильё — «уже отправили»", (await call("/book", G3, { ...p, key: "try-2" })).json.error === "already requested");
  const th = (await call("/chat/open", G3, { listingId: target.id })).json.thread.id as string;
  await call("/chat/send", G3, { id: th, text: "Здравствуйте, парковка есть?", key: "msg-1" });
  await call("/chat/send", G3, { id: th, text: "Здравствуйте, парковка есть?", key: "msg-1" });
  const msgs = (await call("/chat/thread", G3, { id: th })).json.messages;
  check("повтор сообщения с той же меткой — без дубля", msgs.filter((m: any) => m.text === "Здравствуйте, парковка есть?").length === 1);
}

// --- Главный может всё: удалить любое объявление, отменить любую бронь ----------------------
{
  const actives = (await ctx.store.listListings({ status: ["active"] })).filter((l) => l.ownerId !== ADMIN);
  const target = actives[0];
  const G9 = 184;
  await call("/phone", G9, { phone: "+79270000184", consent: true });
  const d = addDays(todaySamara(clock), 150);
  const bk = (await call("/book", G9, { id: target.id, checkIn: d, checkOut: addDays(d, 1), guests: 1 })).json.booking.id as string;
  check("брони: модератору не видны, главному видны", (await call("/admin/bookings", 150)).status === 403 && (await call("/admin/bookings", ADMIN)).json.bookings.some((b: any) => b.id === bk));
  check("главный отменил чужую бронь", (await call("/admin/booking/cancel", ADMIN, { id: bk, note: "Проверка" })).status === 200 && ["declined", "cancelled"].includes((await ctx.store.getBooking(bk))!.status));
  check("простой человек чужую бронь не отменит через админку", (await call("/admin/booking/cancel", GUEST, { id: bk })).status === 403);
  check("модератор не удаляет объявления", (await call("/admin/listing/delete", 150, { id: target.id })).status === 403);
  check("главный удалил чужое объявление", (await call("/admin/listing/delete", ADMIN, { id: target.id, note: "Тест" })).status === 200 && (await ctx.store.getListing(target.id))?.status === "deleted");
}

// --- Автопроверка ботом ------------------------------------------------------------------
{
  const H7 = 171;
  await call("/phone", H7, { phone: "+79270000171", consent: true });
  await approveHost(H7);
  const submit = async (f: object, n: number) => {
    const id = (await call("/host/save", H7, { form: { ...form, ...f } })).json.listing.id as string;
    await call("/host/photos-request", H7, { id });
    await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: H7 }, body: { text: "", attachments: [img(200 + n * 3), img(201 + n * 3), img(202 + n * 3)] } } });
    await call("/host/submit", H7, { id });
    return (await ctx.store.getListing(id))!;
  };
  const prepay = await submit({ address: "ул. Победы, 5", description: "Уютная квартира в центре, всё есть для жизни. Бронь только по предоплате, пишите." }, 1);
  check("автопроверка: просят предоплату — к модератору", prepay.status === "pending" && !!prepay.botReasons?.some((r) => r.includes("предоплату")));
  const copy = await submit({ address: "ул. Победы, 7" }, 2);
  check("автопроверка: описание скопировано из чужого объявления — к модератору", copy.status === "pending" && !!copy.botReasons?.includes("описание скопировано из чужого объявления"));
  const noHouse = await submit({ address: "ул. Победы", description: "Светлая однушка на Победы, рядом метро и парк, новая мебель, быстрый интернет." }, 3);
  check("автопроверка: мелочи (нет номера дома) — не повод держать объявление", noHouse.status === "active");
  const clean = await submit({ address: "ул. Победы, 11", description: "Однушка на Победы, 11: тихий двор, рядом метро и парк, новая мебель, быстрый интернет." }, 4);
  check("автопроверка: всё чисто — сразу в поиске с отметкой бота", clean.status === "active" && clean.botChecked === true && clean.checked === true);
  const pending = (await call("/admin/pending", ADMIN)).json.listings;
  check("автопроверка: модератор видит причины бота", pending.some((l: any) => l.id === prepay.id && l.held.length > 0));
  check("автопроверка: в журнале «Бот»", (await call("/admin/audit", ADMIN)).json.entries.some((e: any) => e.byName === "Бот"));
}

// --- Удаление: объявление, переписка, сообщение ------------------------------------------
{
  const H8 = 172;
  const G8 = 183;
  await call("/phone", H8, { phone: "+79270000172", consent: true });
  await call("/phone", G8, { phone: "+79270000183", consent: true });
  await approveHost(H8);
  const mk = async (addr: string, n: number) => {
    const id = (await call("/host/save", H8, { form: { ...form, address: addr, description: `Квартира ${addr}, тихо и чисто` } })).json.listing.id as string;
    await call("/host/photos-request", H8, { id });
    await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: H8 }, body: { text: "", attachments: [img(300 + n * 3), img(301 + n * 3), img(302 + n * 3)] } } });
    await call("/host/submit", H8, { id });
    return id;
  };
  const LA = await mk("ул. Удалённая, 1", 1);
  const LB = await mk("ул. Удалённая, 2", 2);
  check("короткое описание из пары слов — можно публиковать", (await ctx.store.getListing(LA))?.status === "active");

  // Ждущий запрос при удалении отклоняется, гостю приходит сообщение
  const d = addDays(todaySamara(clock), 30);
  const req = (await call("/book", G8, { id: LA, checkIn: d, checkOut: addDays(d, 1), guests: 1 })).json.booking.id as string;
  check("чужое объявление не удалить", (await call("/host/delete", G8, { id: LA })).status === 404);
  check("своё объявление удалено", (await call("/host/delete", H8, { id: LA })).status === 200 && (await ctx.store.getListing(LA))?.status === "deleted");
  check("ждущий запрос отклонился сам", (await ctx.store.getBooking(req))?.status === "declined");
  check("удалённого нет в поиске, в карточке и у хозяина", !(await call("/search", G8, {})).json.cards.some((c: any) => c.id === LA) && (await call("/listing", G8, { id: LA })).status === 404 && !(await call("/host/listings", H8)).json.listings.some((l: any) => l.id === LA));

  // С подтверждённой будущей бронью удалить нельзя
  const conf = (await call("/book", G8, { id: LB, checkIn: d, checkOut: addDays(d, 2), guests: 1 })).json.booking.id as string;
  await call("/host/decide", H8, { id: conf, accept: true });
  check("с подтверждённой бронью удалить нельзя — сначала отменить", (await call("/host/delete", H8, { id: LB })).json.error === "has bookings");

  // Переписка
  const th = (await call("/chat/open", G8, { listingId: LB })).json.thread.id as string;
  await call("/chat/send", G8, { id: th, text: "Первое" });
  await call("/chat/send", G8, { id: th, text: "Переведите на карту 4276" });
  let msgs = (await call("/chat/thread", G8, { id: th })).json.messages;
  const mine = msgs[msgs.length - 1].id as string;
  check("чужое сообщение удалить нельзя", (await call("/chat/delete", H8, { id: th, messageId: mine })).status === 404);
  check("своё сообщение удалено", (await call("/chat/delete", G8, { id: th, messageId: mine })).status === 200);
  msgs = (await call("/chat/thread", H8, { id: th })).json.messages;
  const gone = msgs.find((m: any) => m.id === mine);
  check("у собеседника — «удалено», без текста", gone?.deleted === true && gone?.text === "");
  check("текст остался в базе для разбора жалоб", (await ctx.store.listChatMessages(th)).some((m) => m.id === mine && m.text.length > 0 && m.deletedAt));
  check("в списке переписок последняя строка — «Сообщение удалено»", (await call("/chat/list", H8)).json.threads.find((x: any) => x.id === th)?.lastText === "Сообщение удалено");

  check("чужую переписку не удалить", (await call("/chat/hide", GUEST, { id: th })).status === 404);
  await call("/chat/hide", G8, { id: th });
  check("удалённая переписка пропала из списка у гостя", !(await call("/chat/list", G8)).json.threads.some((x: any) => x.id === th));
  check("а у хозяина осталась", (await call("/chat/list", H8)).json.threads.some((x: any) => x.id === th));
  clock += 1000;
  await call("/chat/send", H8, { id: th, text: "Здравствуйте!" });
  const back = (await call("/chat/thread", G8, { id: th })).json.messages;
  check("хозяин написал снова — переписка вернулась только с новым", (await call("/chat/list", G8)).json.threads.some((x: any) => x.id === th) && back.length === 1 && back[0].text === "Здравствуйте!");
}

// --- Защита: типовые атаки на API и бота -------------------------------------------------
{
  const api = async (path: string, body: object = {}, ip = "1.2.3.4") => (await handleApi(ctx, path, body, { ip })) as { status: number; json: any };
  // Служебные имена JavaScript вместо id не находят служебные объекты
  for (const id of ["__proto__", "constructor", "toString"]) {
    check(`id «${id}» — просто «не найдено»`, (await call("/listing", ADMIN, { id })).status === 404 && (await call("/book", GUEST, { id, checkIn: "2026-12-01", checkOut: "2026-12-02", guests: 1 })).status === 404);
  }
  // Без подписи MAX ничего нельзя (в бою allowBrowser выключен)
  check("без подписи MAX — отказ", (await api("/me")).status === 401 && (await api("/admin/stats")).status === 401);
  check("поддельная подпись MAX — отказ", (await api("/me", { initData: signedInit("чужой-токен", ADMIN, "Admin") })).status === 401);
  // Лишние поля в анкете (mass assignment) игнорируются: статус, хозяин, отметка проверки
  const HX = 173;
  await call("/phone", HX, { phone: "+79270000173", consent: true });
  await approveHost(HX);
  const sv = (await call("/host/save", HX, { form: { ...form, address: "ул. Атакующая, 1", status: "active", ownerId: ADMIN, checked: true, botChecked: true, id: "evil" } })).json.listing;
  check("через анкету не сделать себя проверенным, чужим или активным", sv.status === "draft" && sv.ownerId === HX && !sv.checked && !sv.botChecked && sv.id !== "evil");
  // Демо-путь ввода кода в приложении закрыт в боевом режиме
  check("ввод кода в приложении в бою недоступен", (await call("/demo/code", GUEST, { code: "code1" })).status === 404);
  // Номер «демо-человека» из браузера в бою не принимается: без подписи MAX — отказ
  check("демо-номер без подписи MAX — отказ", (await api("/me", { demoUser: 900000001 })).status === 401);
  // Код главного не перебрать через бота
  const before = (await ctx.store.getStaff()).length;
  for (let i = 0; i < 8; i++) await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 777 }, body: { text: `/admin guess${i}` } } });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 777 }, body: { text: "/admin code1" } } });
  check("код главного: после 5 попыток даже верный не принимается", (await ctx.store.getStaff()).length === before);
  check("неверные попытки видны в журнале", (await call("/admin/audit", ADMIN)).json.entries.some((e: any) => e.action === "неверный код команды"));
  // Обычное сообщение латиницей не считается паролем и не тратит попытки
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 778 }, body: { text: "hello" } } });
  check("короткое слово латиницей — не попытка кода", !(await call("/admin/audit", ADMIN)).json.entries.some((e: any) => e.target.includes("(778)")));
  // Вебхук бота без секрета не принимает события (иначе можно было бы «нажать кнопку» от имени главного)
  check("вебхук без секрета — отказ", (await handleWebhook(ctx, undefined, { update_type: "message_callback", callback: { user: { user_id: ADMIN }, payload: "adm:ban:1:x" } })).status === 401);
  check("вебхук с неверным секретом — отказ", (await handleWebhook(ctx, "wrong", {})).status === 401);
}

// --- Бот-проверяльщик: новые правила для объявлений и подсказки к заявкам хозяев ----------------
{
  const H9 = 174;
  const H10 = 175;
  for (const [h, ph] of [[H9, "+79270000174"], [H10, "+79270000175"]] as const) {
    await call("/phone", h, { phone: ph, consent: true });
    await approveHost(h);
  }
  let n = 0;
  const submit = async (host: number, f: object) => {
    n++;
    const id = (await call("/host/save", host, { form: { ...form, ...f } })).json.listing.id as string;
    await call("/host/photos-request", host, { id });
    await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: host }, body: { text: "", attachments: [img(400 + n * 3), img(401 + n * 3), img(402 + n * 3)] } } });
    await call("/host/submit", host, { id });
    return (await ctx.store.getListing(id))!;
  };
  const has = (l: Listing, part: string) => !!l.botReasons?.some((r) => r.includes(part));
  const a = await submit(H9, { address: "ул. Двойная, 8", flat: "кв. 12", description: "Свой уголок у Волги" });
  check("бот: чистое объявление — сразу в поиске", a.status === "active" && a.botChecked === true);
  const b = await submit(H10, { address: "Двойная ул., д. 8", flat: "кв 12", description: "Квартира у реки, уютно" });
  check("бот: ту же квартиру сдаёт другой хозяин — к модератору", b.status === "pending" && has(b, "уже сдаёт другой хозяин"));
  const c = await submit(H10, { address: "ул. Цифр, 1", description: "Студия у парка", type: "flat", rooms: 3, area: 20 });
  check("бот: странная площадь — не нарушение, публикуется", c.status === "active");
  const d = await submit(H10, { address: "ул. Гостей, 2", description: "Много места для всех", guests: 10, beds: 2 });
  check("бот: много гостей — не нарушение, публикуется", d.status === "active");
  const e = await submit(H10, { address: "ул. Крика, 3", description: "СДАМ СРОЧНО ЛУЧШАЯ КВАРТИРА ГОРОДА!!!!!" });
  check("бот: капс и «!!!» — не нарушение, публикуется", e.status === "active");
  // Приманка: прошли проверку, потом резко снизили цену
  await call("/host/save", H9, { id: a.id, form: { priceWeekday: 1000, priceWeekend: 1100 } });
  await call("/host/submit", H9, { id: a.id });
  const a2 = (await ctx.store.getListing(a.id))!;
  check("бот: цену снизили больше чем вдвое после проверки — к модератору", a2.status === "pending" && has(a2, "больше чем вдвое"));

  // Заявка «хочу сдавать»: решает человек, бот подсказывает
  const HA = 176;
  const TW = 177;
  await call("/phone", TW, { phone: "+79270000176", consent: true });
  await ctx.store.saveUser({ ...(await ctx.store.getUser(TW))!, blocked: true });
  await call("/phone", HA, { phone: "+79270000176", consent: true });
  await call("/host/apply", HA, { name: "Ivan 89270000000", city: "Москва", about: "предоплата 50% обязательно" });
  const app = (await call("/admin/applications", ADMIN)).json.applications.find((x: any) => x.id === HA);
  const flags = (app?.hints.flags ?? []).join(" | ");
  check("заявка: бот отметил номер заблокированного", flags.includes("был у заблокированного"));
  check("заявка: бот отметил просьбу о предоплате", flags.includes("предоплат") && !flags.includes("странное имя"));
  check("заявка: модератору в чат пришли подсказки бота", lastTo(ADMIN)?.text.includes("Бот: проверьте") === true);
  check("заявка не одобряется ботом сама — ждёт человека", (await ctx.store.getUser(HA))?.hostStatus === "pending");
}

// --- Правки 13.11: 2 фото, описание необязательно, удаление и очистка жалоб ----------------------
{
  const HQ = 178;
  await call("/phone", HQ, { phone: "+79270000178", consent: true });
  await approveHost(HQ);
  const id = (await call("/host/save", HQ, { form: { ...form, address: "ул. Двухфоточная, 2", description: "" } })).json.listing.id as string;
  await call("/host/photos-request", HQ, { id });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HQ }, body: { text: "", attachments: [img(500), img(501)] } } });
  const r = (await call("/host/submit", HQ, { id })).json;
  check("2 фото и без описания — можно опубликовать", r.live === true || (await ctx.store.getListing(id))?.status === "active");
  // Жалобы: удалить одну, очистить все
  const G = 185;
  await call("/phone", G, { phone: "+79270000185", consent: true });
  await call("/complaint", G, { id, reason: "fake", text: "фейк" });
  await call("/complaint", 186, { id, reason: "prepay", text: "" });
  const open1 = (await call("/admin/pending", ADMIN)).json.complaints.filter((c: any) => c.listingId === id);
  check("жалобы пришли в админку", open1.length >= 1);
  await call("/admin/complaint", ADMIN, { id: open1[0].id, action: "dismiss" });
  const after = (await call("/admin/pending", ADMIN)).json.complaints.filter((c: any) => c.listingId === id);
  check("удалённая жалоба пропала из списка", !after.some((c: any) => c.id === open1[0].id));
  const cl = (await call("/admin/complaints/clear", ADMIN)).json;
  check("«Очистить все» убрал остальные", typeof cl.cleared === "number" && (await call("/admin/pending", ADMIN)).json.complaints.length === 0);
  check("удалённые жалобы не считаются против хозяина", (await ctx.store.listComplaints({})).filter((c) => c.listingId === id).every((c) => c.dismissed));
  check("простой человек жалобы не очистит", (await call("/admin/complaints/clear", GUEST)).status === 403);
}

// --- Одобренный хозяин — обычный пользователь: может сдавать, но без прав команды --------------
{
  const HN = 179;
  await call("/phone", HN, { phone: "+79270000179", consent: true });
  await call("/host/apply", HN, { name: "Обычный Хозяин", city: "Самара", about: "" });
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `ha:ok:${HN}` } });
  const me = (await call("/me", HN)).json;
  check("одобренный хозяин может сдавать", me.host === "approved" && (await call("/host/save", HN, { form: { ...form, address: "ул. Обычная, 1" } })).status === 200);
  check("но не модератор и не главный — вкладки админки нет", me.admin === false && me.owner === false);
  const adminRoutes = ["/admin/pending", "/admin/applications", "/admin/bookings", "/admin/listings", "/admin/users", "/admin/stats", "/admin/staff", "/admin/audit", "/admin/modcode", "/admin/complaints/clear"];
  const codes = await Promise.all(adminRoutes.map(async (p) => (await call(p, HN)).status));
  check("ни один раздел админки ему не доступен", codes.every((c) => c === 403));
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: HN }, payload: `ha:ok:${HN + 1}` } });
  check("кнопки модератора в боте он тоже нажать не может", (await ctx.store.getUser(HN + 1))?.hostStatus !== "approved");
}

// --- 13.11 вечер: стереть удалённое, подтверждение номера через MAX ----------------------------
{
  const { createHmac } = await import("node:crypto");
  // Номер из окна MAX с подписью (схема как у данных запуска) — подтверждён; руками или с чужой подписью — нет
  const PV = 187;
  const authDate = Math.floor(Date.now() / 1000);
  const phone = "+79270000187";
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(`auth_date=${authDate}\nphone=${phone}`).digest("hex");
  const r1 = (await call("/phone", PV, { phone, consent: true, contact: { phone, authDate, hash } })).json;
  check("номер из MAX с верной подписью — подтверждён", r1.verified === true && (await ctx.store.getUser(PV))?.phoneVerified === true);
  const r2 = (await call("/phone", PV, { phone, consent: true, contact: { phone, authDate, hash: "00".repeat(32) } })).json;
  check("подделанная подпись — не подтверждён", r2.verified === false && (await ctx.store.getUser(PV))?.phoneVerified === false);
  const r3 = (await call("/phone", PV, { phone: "+79270000999", consent: true, contact: { phone, authDate, hash } })).json;
  check("подпись от другого номера — не подтверждён", r3.verified === false);
  check("введённый руками — не подтверждён", (await call("/phone", PV, { phone, consent: true })).json.verified === false);

  // Стереть насовсем: только уже удалённое и только главный
  const HP = 188;
  await call("/phone", HP, { phone: "+79270000188", consent: true });
  await approveHost(HP);
  const id = (await call("/host/save", HP, { form: { ...form, address: "ул. Стираемая, 1" } })).json.listing.id as string;
  check("неудалённое стереть нельзя", (await call("/admin/listing/purge", ADMIN, { id })).json.error === "bad status");
  await call("/host/delete", HP, { id });
  check("модератор стереть не может", (await call("/admin/listing/purge", 150, { id })).status === 403);
  check("главный стёр удалённое насовсем", (await call("/admin/listing/purge", ADMIN, { id })).status === 200 && (await ctx.store.getListing(id)) === undefined);
}

// --- 13.11: номер в объявлении по выбору хозяина, просмотры и избранное ----------------------------
{
  const H9 = 189;
  const G9 = 190;
  const G10 = 191;
  await call("/phone", H9, { phone: "+79270000189", consent: true });
  await approveHost(H9);
  await call("/phone", G9, { phone: "+79270000190", consent: true });
  const id = (await call("/host/save", H9, { form: { ...form, address: "ул. Счётная, 9", description: "Светлая студия у парка, рядом остановка" } })).json.listing.id as string;
  await call("/host/photos-request", H9, { id });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: H9 }, body: { text: "", attachments: [img(951), img(952)] } } });
  await call("/host/submit", H9, { id });
  check("счётчики: объявление опубликовано", (await ctx.store.getListing(id))?.status === "active");

  // Номер: по умолчанию скрыт, хозяин включил — виден гостю, но не попадает в поиск
  check("номер хозяина по умолчанию скрыт", (await call("/listing", G9, { id })).json.listing.hostPhone === null);
  await call("/host/save", H9, { id, form: { ...form, address: "ул. Счётная, 9", description: "Светлая студия у парка, рядом остановка", showPhone: true } });
  check("хозяин разрешил — гость видит номер", (await call("/listing", G9, { id })).json.listing.hostPhone === "+79270000189");
  check("флаг showPhone наружу не уходит", !("showPhone" in (await call("/listing", G9, { id })).json.listing));
  check("в поиске номера нет", !JSON.stringify((await call("/search", G9, {})).json).includes("79270000189"));

  // Просмотры: один человек — один раз в сутки, хозяин не считается
  for (let i = 0; i < 3; i++) await call("/listing", G10, { id });
  await call("/listing", H9, { id });
  const row = (await call("/host/listings", H9)).json.listings.find((l: any) => l.id === id);
  check("просмотры: двое разных = 2 (повторы и хозяин не считаются)", row.views === 2);

  // Избранное: повторное «добавить» не накручивает, убрал — минус
  await call("/favorite", G9, { id, on: true });
  await call("/favorite", G9, { id, on: true });
  await call("/favorite", G10, { id, on: true });
  check("в избранном: 2 человека", (await call("/host/listings", H9)).json.listings.find((l: any) => l.id === id).favs === 2);
  await call("/favorite", G10, { id, on: false });
  await call("/favorite", G10, { id, on: false });
  check("убрали из избранного — 1, ниже нуля не уходит", (await call("/host/listings", H9)).json.listings.find((l: any) => l.id === id).favs === 1);
  check("чужой не видит счётчики хозяина", !(await call("/host/listings", G9)).json.listings?.some?.((l: any) => l.id === id));
  check("в /me есть ник бота для ссылки «Поделиться»", (await call("/me", G9)).json.bot === "test_bot");
}

// --- 13.11: защита денег — номер карты и просьбы о переводе в переписке скрываются ----------------
{
  const { maskContacts: mc } = await import("../shared/trust.ts");
  check("номер карты группами скрыт", mc("карта 4276 3801 2345 6787").text === "карта [скрыто]");
  check("номер карты слитно скрыт", mc("2202206312345676").masked);
  check("«скиньте на карту» и СБП скрыты", mc("скиньте на карту").text === "[скрыто]" && mc("по СБП 500").masked);
  check("обычное сообщение с цифрами не трогаем", !mc("заезд 12.12, нас 2, цена 3500, 3 ночи").masked);
}

// --- 14.11: защита от схем с Авито и посуточных сайтов; история; календарь пачкой --------------
{
  const H10 = 192;
  const G11 = 193;
  await call("/phone", H10, { phone: "+79270000192", consent: true });
  await approveHost(H10);
  const id = (await call("/host/save", H10, { form: { ...form, address: "ул. Осторожная, 3", description: "Тёплая квартира у набережной, свежий ремонт" } })).json.listing.id as string;
  await call("/host/photos-request", H10, { id });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: H10 }, body: { text: "", attachments: [img(961), img(962)] } } });
  await call("/host/submit", H10, { id });

  // «Назовите код из СМС» и «оплата по ссылке» — у получателя предупреждение и в приложении, и в уведомлении MAX
  const th = (await call("/chat/open", G11, { listingId: id })).json.thread.id as string;
  await call("/chat/send", G11, { id: th, text: "Чтобы подтвердить бронь, назовите код из СМС" });
  const base16 = clock;
  clock += 31 * 60_000;
  await wakeUnread(ctx, clock);
  clock = base16;
  check("в напоминании MAX — «ОСТОРОЖНО»", (lastTo(H10)?.text ?? "").includes("ОСТОРОЖНО"));
  const msgs = (await call("/chat/thread", H10, { id: th })).json.messages;
  check("тревожное сообщение помечено для хозяина", msgs.some((m: any) => m.risky === true));
  await call("/chat/send", G11, { id: th, text: "Свободно на выходные? Нас двое" });
  check("обычный вопрос без предупреждения", !(await call("/chat/thread", H10, { id: th })).json.messages.find((m: any) => m.text.startsWith("Свободно")).risky);
  await call("/chat/send", H10, { id: th, text: "Оплата тут: avito-oplata точка ru, или 8 9 2 7 1 2 3 4 5 6 7" });
  const last = (await call("/chat/thread", G11, { id: th })).json.messages.at(-1);
  check("сайт «точка ru» и номер вразбивку скрыты", !last.text.includes("avito") && !last.text.includes("8 9 2 7"));

  // Имя «Служба безопасности» — не показываем
  await handleApi(ctx, "/me", { initData: signedInit(token, 194, "Служба безопасности") });
  check("имя «Служба безопасности» скрыто", (await ctx.store.getUser(194))?.name === null);

  // Календарь: несколько дней одним запросом, открыть и закрыть сразу
  const d1 = addDays(todaySamara(clock), 40);
  const d2 = addDays(d1, 1);
  const c1 = (await call("/host/calendar", H10, { id, close: [d1, d2], open: [] })).json;
  check("календарь: два дня закрыты одним запросом", c1.closed.includes(d1) && c1.closed.includes(d2));
  const c2 = (await call("/host/calendar", H10, { id, close: [], open: [d1] })).json;
  check("календарь: день снова открыт, второй остался закрыт", !c2.closed.includes(d1) && c2.closed.includes(d2));

  // История: удалить одну запись может только главный
  const entries = (await call("/admin/audit", ADMIN)).json.entries;
  const victim = entries[0];
  check("у записей истории есть id", typeof victim?.id === "string");
  check("модератор запись не удалит", (await call("/admin/audit/delete", 150, { id: victim.id })).status === 403);
  check("главный удалил одну запись", (await call("/admin/audit/delete", ADMIN, { id: victim.id })).status === 200 && !(await call("/admin/audit", ADMIN)).json.entries.some((e: any) => e.id === victim.id));
  check("остальные записи на месте", (await call("/admin/audit", ADMIN)).json.entries.length >= Math.min(entries.length - 1, 99));
}

// --- 14.11: снятое объявление хозяин исправляет; удаление людей; стирание снятых -----------------
{
  const HB = 192;
  const GB = 193;
  await call("/phone", HB, { phone: "+79270000192", consent: true });
  await approveHost(HB);
  await call("/phone", GB, { phone: "+79270000193", consent: true });
  const id = (await call("/host/save", HB, { form: { ...form, address: "ул. Снятая, 3" } })).json.listing.id as string;
  await call("/host/photos-request", HB, { id });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HB }, body: { text: "", attachments: [img(961), img(962)] } } });
  await call("/host/submit", HB, { id });
  await call("/admin/block", ADMIN, { id, note: "Фото не совпадают с адресом" });
  check("снято: хозяин видит причину", (await call("/host/listing", HB, { id })).json.listing.moderatorNote === "Фото не совпадают с адресом");
  check("снятое хозяин может исправить", (await call("/host/save", HB, { id, form: { ...form, address: "ул. Снятая, 3", description: "Новые фото, всё совпадает" } })).status === 200);
  check("после правки всё ещё снято (не в поиске)", (await ctx.store.getListing(id))?.status === "blocked");
  const re = (await call("/host/submit", HB, { id })).json;
  const after = await ctx.store.getListing(id);
  check("снятое после отправки — на проверке у человека, не в поиске", re.live === false && after?.status === "pending" && after?.checked === false);
  check("модератор видит прежнюю причину", (after?.botReasons ?? []).some((r) => r.includes("Фото не совпадают")));

  // Хозяин удаляет своё снятое объявление
  await call("/admin/block", ADMIN, { id, note: "Снова не то" });
  check("хозяин удалил снятое", (await call("/host/delete", HB, { id })).status === 200 && (await ctx.store.getListing(id))?.status === "deleted");

  // Главный стирает снятое насовсем сразу, без «удалить» перед этим
  const id2 = (await call("/host/save", HB, { form: { ...form, address: "ул. Снятая, 5" } })).json.listing.id as string;
  await call("/admin/block", ADMIN, { id: id2, note: "Обман" });
  check("снятое стирается насовсем сразу", (await call("/admin/listing/purge", ADMIN, { id: id2 })).status === 200 && (await ctx.store.getListing(id2)) === undefined);

  // Удалить человека: модератор не может, себя и главного нельзя
  check("модератор людей не удаляет", (await call("/admin/user/delete", 150, { id: GB })).status === 403);
  check("себя удалить нельзя", (await call("/admin/user/delete", ADMIN, { id: ADMIN })).json.error === "bad user");
  // Без блокировки: данных не остаётся, в «Людях» не видно, вернулся — как новый
  check("удалили человека", (await call("/admin/user/delete", ADMIN, { id: GB })).status === 200);
  const gone = await ctx.store.getUser(GB);
  check("удалённый: ни имени, ни номера", gone?.name === null && gone?.phone === null && !!gone?.deletedAt && !gone?.blocked);
  check("удалённого нет в «Людях»", !(await call("/admin/users", ADMIN, { q: "" })).json.users.some((u: any) => u.id === GB));
  await call("/me", GB, {});
  check("вернулся — снова обычный человек", !(await ctx.store.getUser(GB))?.deletedAt);

  // С блокировкой: объявления стёрты, номер остался для проверки, зайти нельзя
  const id3 = (await call("/host/save", HB, { form: { ...form, address: "ул. Снятая, 7" } })).json.listing.id as string;
  check("заблокировали и удалили хозяина", (await call("/admin/user/delete", ADMIN, { id: HB, block: true, note: "Мошенник" })).status === 200);
  const hb = await ctx.store.getUser(HB);
  check("у заблокированного остались только номер и отметка", hb?.blocked === true && hb?.phone === "+79270000192" && hb?.name === null);
  check("его объявления стёрты насовсем", (await ctx.store.getListing(id3)) === undefined);
  check("заблокированный и удалённый не может работать", (await call("/host/listings", HB)).status === 403);
  check("второй раз удалить нельзя", (await call("/admin/user/delete", ADMIN, { id: HB })).status === 404);
}

console.log(failed ? `\nОшибок: ${failed}` : "\nВсё в порядке");
process.exit(failed ? 1 : 0);
