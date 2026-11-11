// Самопроверка сервера без MAX и без сети: npm run selftest
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRange, price, todaySamara, addDays } from "../shared/dates.ts";
import { decideDeadline, handleApi, handleWebhook, processUpdate, sweep, type Ctx } from "./handlers.ts";
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
  config: { botToken: token, adminCode: "code1", webhookSecret: "s", allowBrowser: false, decideHours: 3, botUsername: "test_bot", moderation: "pre" },
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
check("без фото отправить нельзя", (await call("/host/submit", HOST, { id: L })).json.missing?.includes("фото (минимум 3)"));
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
  check("хозяину: «опубликовано и уже в поиске»", lastTo(HOST2)?.text.includes("уже в поиске") === true);
  check("бот проверил сам: отметка «проверено ботом», модератора не дёргаем", (await ctx.store.getListing(L2))?.botChecked === true && sent.filter((m) => m.to === ADMIN).length === toAdminBefore);
  check("сразу находится в поиске", (await call("/search", GUEST, { locality: "Самара" })).json.cards.some((c: any) => c.id === L2));
  const before = sent.length;
  await processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: ADMIN }, payload: `mod:ok:${L2}` } });
  check("одобренное ботом не висит в «Проверке» и хозяину лишнего не пишем", (await ctx.store.getListing(L2))?.checked === true && sent.length === before);

  // Подозрительная цена — ждёт проверки, в поиск не попадает
  const HOST3 = 120;
  await call("/phone", HOST3, { phone: "+79270000120", consent: true });
await approveHost(HOST3);
  const L3 = (await call("/host/save", HOST3, { form: { ...form, priceWeekday: 500, priceWeekend: 500 } })).json.listing.id as string;
  await call("/host/photos-request", HOST3, { id: L3 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST3 }, body: { text: "", attachments: [img(31), img(32), img(33)] } } });
  const sub3 = (await call("/host/submit", HOST3, { id: L3 })).json;
  check("цена 500 ₽ — подозрительно, ждёт проверки", sub3.live === false && (await ctx.store.getListing(L3))?.status === "pending");
  check("модератору видна причина", lastTo(ADMIN)?.text.includes("слишком низкая цена") === true);
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
  check("жалоба пришла модератору с кнопками", cmsg?.text.startsWith("Жалоба на объявление") === true && cmsg.buttons.some((b) => b.startsWith(`adm:hide:${L2}`)));
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
  const note = lastTo(HOST4);
  check("хозяину пришло уведомление с вопросом и кнопкой", !!note?.text.startsWith("Вопрос от гостя") && note.buttons.some((b) => b.includes("startapp=chat_")));
  check("в уведомлении хозяину номер тоже скрыт", !note?.text.includes("555"));
  check("у хозяина 1 непрочитанное", (await call("/me", HOST4)).json.unread === 1);

  // Хозяин отвечает прямо в чате MAX — «Ответить» на уведомление
  const noteMid = `m${sent.indexOf(note!) + 1}`;
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST4 }, body: { text: "Да, можно, встречу у подъезда" }, link: { type: "reply", message: { mid: noteMid } } } });
  const msgs = (await call("/chat/thread", GUEST, { id: TH })).json.messages;
  check("ответ хозяина из чата MAX попал в переписку", msgs.length === 2 && msgs[1].from === "owner" && msgs[1].text.includes("встречу"));
  check("гостю пришёл ответ хозяина", lastTo(GUEST)?.text.startsWith("Ответ хозяина") === true);
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
  const L5 = (await call("/host/save", HOST5, { form: { ...form, address: "ул. Луговая, 3", description: `${form.description} ${"ул. Луговая, 3"}` } })).json.listing.id as string;
  await call("/host/photos-request", HOST5, { id: L5 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST5 }, body: { text: "", attachments: [img(51), img(52), img(53)] } } });
  await call("/host/submit", HOST5, { id: L5 });
  const TH5 = (await call("/chat/open", GUEST2, { listingId: L5 })).json.thread.id as string;
  const wakes = () => sent.filter((s) => s.to === HOST5 && s.text.startsWith("Вопрос от гостя")).length;
  await call("/chat/send", GUEST2, { id: TH5, text: "Добрый вечер" });
  await call("/chat/send", GUEST2, { id: TH5, text: "Свободно на выходные?" });
  await call("/chat/send", GUEST2, { id: TH5, text: "И парковка есть?" });
  check("3 сообщения подряд — хозяина будим один раз", wakes() === 1);
  check("но все 3 сообщения сохранены", (await call("/chat/thread", HOST5, { id: TH5 })).json.messages.length === 3);
  clock += 3 * 60_000;
  await call("/chat/send", GUEST2, { id: TH5, text: "Ответьте, пожалуйста" });
  check("прочитал и прошло 2 минуты — новое сообщение снова будит", wakes() === 2);
  clock = Date.parse("2026-11-10T12:00:00+04:00");
}

// --- Админка: главный, модераторы, люди, журнал --------------------------------------
{
  const MOD = 150;
  await call("/phone", MOD, { phone: "+79270000150", consent: true });
  check("первый вошедший по коду — главный", (await call("/me", ADMIN)).json.owner === true);
  check("клиент не видит команду", (await call("/admin/staff", GUEST)).status === 403);
  check("клиент не назначает модераторов", (await call("/admin/staff/invite", GUEST)).status === 403);
  // Злоумышленник вписал себе номер будущего модератора — по номеру больше никого не назначают, только по приглашению
  await call("/phone", 666, { phone: "+79270000150", consent: true });
  const inv = await call("/admin/staff/invite", ADMIN);
  check("главный получил одноразовый код приглашения", inv.status === 200 && /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(inv.json.code));
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: MOD }, body: { text: `/join ${inv.json.code.toLowerCase()}` } } });
  check("по коду из своего MAX человек стал модератором", (await ctx.store.getAdmins()).includes(MOD) && !(await ctx.store.getAdmins()).includes(666));
  check("модератору пришло сообщение с кнопкой админки", lastTo(MOD)?.text.startsWith("Готово: вы модератор") === true);
  check("главному сообщили, кто принял приглашение", lastTo(ADMIN)?.text.includes("принял приглашение") === true);
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 666 }, body: { text: `/join ${inv.json.code}` } } });
  check("код одноразовый: второй раз не сработал", !(await ctx.store.getAdmins()).includes(666) && lastTo(666)?.text.startsWith("Приглашение не подходит") === true);
  check("модератор видит админку, но не главный", (await call("/me", MOD)).json.admin === true && (await call("/me", MOD)).json.owner === false);
  check("модератор не приглашает других", (await call("/admin/staff/invite", MOD)).status === 403);
  check("модератор не снимает главного", (await call("/admin/staff/remove", MOD, { id: ADMIN })).status === 403);
  check("последнего главного не снять", (await call("/admin/staff/remove", ADMIN, { id: ADMIN })).json.error === "last owner");

  // Модератор работает: решение попадает в журнал под его именем
  const HOST6 = 160;
  await call("/phone", HOST6, { phone: "+79270000160", consent: true });
await approveHost(HOST6);
  const L6 = (await call("/host/save", HOST6, { form: { ...form, address: "ул. Полевая, 9", description: `${form.description} ${"ул. Полевая, 9"}`, priceWeekday: 500, priceWeekend: 600 } })).json.listing.id as string;
  await call("/host/photos-request", HOST6, { id: L6 });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: HOST6 }, body: { text: "", attachments: [img(61), img(62), img(63)] } } });
  await call("/host/submit", HOST6, { id: L6 });
  check("подозрительное: бот отправил модератору с причиной", lastTo(MOD)?.text.includes("ждёт проверки (слишком низкая цена") === true);
  await call("/admin/moderate", MOD, { id: L6, ok: false, reason: "photos" });
  const log = (await call("/admin/audit", ADMIN)).json.entries;
  check("в журнале: модератор отклонил объявление", log[0]?.by === MOD && log[0]?.action === "отклонил объявление" && log[0]?.byName === "U150");
  await call("/admin/restore", MOD, { id: L6 });
  check("модератор вернул объявление в поиск", (await ctx.store.getListing(L6))?.status === "active");

  // Люди: поиск и блокировка
  const found = (await call("/admin/users", MOD, { q: "0000160" })).json.users;
  check("поиск человека по номеру", found.length === 1 && found[0].id === HOST6 && found[0].listings === 1);
  check("модератор не заблокирует главного", (await call("/admin/user/block", MOD, { id: ADMIN, blocked: true })).json.error === "owner");
  check("себя заблокировать нельзя", (await call("/admin/user/block", MOD, { id: MOD, blocked: true })).json.error === "bad user");
  await call("/admin/user/block", MOD, { id: HOST6, blocked: true, note: "Чужие фото" });
  check("блокировка: человек и его объявления сняты", (await ctx.store.getUser(HOST6))?.blocked === true && (await ctx.store.getListing(L6))?.status === "blocked");
  const TH6 = (await ctx.store.listThreads(HOST6))[0];
  check("заблокированному нельзя вернуть объявление", (await call("/admin/restore", MOD, { id: L6 })).json.error === "owner blocked");
  await call("/admin/user/block", MOD, { id: HOST6, blocked: false });
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
  const L7 = (await call("/host/save", NEWBIE, { form: { ...form, address: "ул. Новая, 1", description: `${form.description} ${"ул. Новая, 1"}` } })).json.listing?.id as string;
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
    const id = (await call("/host/save", HG, { form: { ...form, address: `ул. Лимитная, ${n}`, description: `${form.description} Лимитная ${n}` } })).json.listing.id as string;
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

// --- Отдельная админка: вход кодом через бота ---------------------------------------------
{
  const api = async (path: string, body: object = {}) => (await handleApi(ctx, path, body)) as { status: number; json: any };
  const say = (uid: number, text: string) => processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: uid }, body: { text } } });
  const press = (uid: number, payload: string) => processUpdate(ctx, { update_type: "message_callback", callback: { callback_id: "c", user: { user_id: uid }, payload } });
  const check1 = (l: any) => api("/admin/login/check", { id: l.id, secret: l.secret });

  const s1 = (await api("/admin/login/start", { device: "Windows, Chrome" })).json;
  check("админка: код из 6 цифр", /^\d{6}$/.test(s1.code));
  check("админка: до подтверждения ключа нет", (await check1(s1)).json.state === "waiting");
  await say(GUEST, s1.code);
  check("админка: не из команды — код не принят", lastTo(GUEST)?.text.startsWith("Код не подходит") === true);
  await say(ADMIN, `/login ${s1.code}`);
  const ask = lastTo(ADMIN);
  check("админка: бот спросил «Это вы?» с устройством и кнопками", !!ask?.text.includes("Windows, Chrome") && !!ask?.buttons.includes(`al:y:${s1.id}`));
  check("админка: с чужим секретом ключ не получить", (await api("/admin/login/check", { id: s1.id, secret: "чужой" })).json.state === "expired");
  await press(GUEST, `al:y:${s1.id}`);
  check("админка: «Да» не из команды не срабатывает", (await check1(s1)).json.state === "asked");
  await press(ADMIN, `al:y:${s1.id}`);
  const got = (await check1(s1)).json;
  check("админка: после «Да» страница получила ключ", got.state === "approved" && typeof got.token === "string");
  check("админка: ключ выдаётся один раз", (await check1(s1)).json.token === undefined);
  const tk = got.token as string;
  check("админка: по ключу открывается", (await api("/admin/stats", { adminToken: tk })).status === 200);
  check("админка: по ключу видно, что это главный", (await api("/me", { adminToken: tk })).json.owner === true);
  check("админка: ключом нельзя бронировать или писать", (await api("/book", { adminToken: tk, id: "x" })).status === 403);
  check("админка: выдуманный ключ — отказ", (await api("/admin/stats", { adminToken: "nope" })).status === 401);
  check("админка: заявки хозяев и брони видны", (await api("/admin/applications", { adminToken: tk })).status === 200 && (await api("/admin/bookings", { adminToken: tk })).json.bookings.length > 0);
  check("админка: брони не видны гостю", (await call("/admin/bookings", GUEST)).status === 403);

  const s2 = (await api("/admin/login/start", { device: "Android, MAX" })).json;
  await say(ADMIN, s2.code);
  await press(ADMIN, `al:n:${s2.id}`);
  check("админка: «Нет» в боте — вход отменён", (await check1(s2)).json.state === "denied");

  const s3 = (await api("/admin/login/start", { device: "Mac, Safari" })).json;
  clock += 6 * 60_000;
  await say(ADMIN, s3.code);
  check("админка: через 5 минут код устарел", lastTo(ADMIN)?.text.startsWith("Код не подходит") === true);

  // Модератора убрали из команды — его ключ сразу перестаёт работать
  const M2 = 155;
  await call("/phone", M2, { phone: "+79270000155", consent: true });
  await ctx.store.saveStaff([...(await ctx.store.getStaff()), { id: M2, role: "moderator", addedBy: ADMIN, addedAt: clock }]);
  const s4 = (await api("/admin/login/start", { device: "Windows, Edge" })).json;
  await say(M2, s4.code);
  await press(M2, `al:y:${s4.id}`);
  const tk2 = (await check1(s4)).json.token as string;
  check("админка: модератор вошёл", (await api("/admin/stats", { adminToken: tk2 })).status === 200);
  await ctx.store.saveStaff((await ctx.store.getStaff()).filter((x) => x.id !== M2));
  check("админка: убрали из команды — ключ не работает", (await api("/admin/stats", { adminToken: tk2 })).status === 401);

  await say(ADMIN, "/logout_all");
  check("админка: /logout_all — вход закрыт на всех устройствах", (await api("/admin/stats", { adminToken: tk })).status === 401);
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
  check("автопроверка: описание как у чужого объявления — к модератору", copy.status === "pending" && !!copy.botReasons?.includes("описание совпадает с чужим объявлением"));
  const noHouse = await submit({ address: "ул. Победы", description: "Светлая однушка на Победы, рядом метро и парк, новая мебель, быстрый интернет." }, 3);
  check("автопроверка: без номера дома — к модератору", noHouse.status === "pending" && !!noHouse.botReasons?.includes("в адресе нет номера дома"));
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
  // Вход в админку: один адрес не может выбрать все коды и закрыть вход команде
  let blocked = 0;
  for (let i = 0; i < 35; i++) if ((await api("/admin/login/start", { device: "x" }, "6.6.6.6")).status === 429) blocked++;
  check("вход в админку: один адрес ограничен (30 в час)", blocked === 5);
  check("а с другого адреса вход работает", (await api("/admin/login/start", { device: "x" }, "7.7.7.7")).status === 200);
  // Код главного не перебрать через бота
  const before = (await ctx.store.getStaff()).length;
  for (let i = 0; i < 8; i++) await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 777 }, body: { text: `/admin guess${i}` } } });
  await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 777 }, body: { text: "/admin code1" } } });
  check("код главного: после 5 попыток даже верный не принимается", (await ctx.store.getStaff()).length === before);
  check("неверные попытки видны в журнале", (await call("/admin/audit", ADMIN)).json.entries.some((e: any) => e.action === "неверный код главного"));
  // Ключом админки нельзя действовать от имени человека
  check("чужой ключ админки — отказ даже на /me", (await api("/me", { adminToken: "a".repeat(43) })).status === 401);
  // Вебхук бота без секрета не принимает события (иначе можно было бы «нажать кнопку» от имени главного)
  check("вебхук без секрета — отказ", (await handleWebhook(ctx, undefined, { update_type: "message_callback", callback: { user: { user_id: ADMIN }, payload: "al:y:x" } })).status === 401);
  check("вебхук с неверным секретом — отказ", (await handleWebhook(ctx, "wrong", {})).status === 401);
}

console.log(failed ? `\nОшибок: ${failed}` : "\nВсё в порядке");
process.exit(failed ? 1 : 0);
