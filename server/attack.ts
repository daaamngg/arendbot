// Атака на своё приложение в песочнице: npm run attack
// Бот поднимается на тестовой базе в памяти (без облака, без MAX, без сети). Создаются «жертвы» — хозяин с квартирой
// и гость с бронями, перепиской, отзывом и обращением, — и «злоумышленник», который пробует всё, что умеет:
// чужие объекты (OWASP API1), подделку входа (API2), лишние поля (API3), перегрузку (API4), админские пути (API5),
// обман логики брони, одновременные запросы (гонки) и обход скрытия контактов.
// Итог — список дыр; каждая найденная должна стать проверкой в selftest и исправлением в коде.
import { createHmac } from "node:crypto";
import { addDays, todaySamara } from "../shared/dates.ts";
import { maskContacts } from "../shared/trust.ts";
import { handleApi, handleWebhook, processUpdate, type Ctx } from "./handlers.ts";
import { docStore, memoryTable } from "./doc-store.ts";
import { signedInit } from "./selftest-init.ts";

const token = "attack-token";
const table = memoryTable();
const holes: string[] = [];
let passed = 0;
const expect = (name: string, ok: boolean) => {
  if (ok) passed++;
  else holes.push(name);
};
const ctx: Ctx = {
  store: docStore(table),
  config: { botToken: token, adminCode: "owner-code-1", modCode: "moder-code-1", webhookSecret: "hook-secret", allowBrowser: false, decideHours: 3, botUsername: "b", moderation: "post" },
  log: () => {},
  max: {
    async send() {
      return `m${Math.random()}`;
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
const call = async (path: string, uid: number, body: object = {}) => (await handleApi(ctx, path, { ...body, initData: signedInit(token, uid, `U${uid}`) })) as { status: number; json: any };
const raw = async (path: string, body: object) => (await handleApi(ctx, path, body)) as { status: number; json: any };
const bot = (update: object) => processUpdate(ctx, update);
const img = (n: number) => ({ type: "image", payload: { url: `https://i.oneme.ru/i?r=${n}` } });

const OWNER = 1;
const MOD = 2;
const VHOST = 500; // хозяин-жертва
const VGUEST = 600; // гость-жертва
const EVIL = 666; // злоумышленник (тоже одобренный хозяин)
const EVIL2 = 667;

// --- подготовка --------------------------------------------------------------------------
await bot({ update_type: "message_created", message: { sender: { user_id: OWNER }, body: { text: "/admin owner-code-1" } } });
await bot({ update_type: "message_created", message: { sender: { user_id: MOD }, body: { text: "/mod moder-code-1" } } });
const form = {
  type: "flat",
  locality: "Самара",
  district: "Ленинский",
  address: "ул. Жертвенная, 1",
  flat: "кв. 7, домофон 7К",
  rooms: 1,
  guests: 4,
  beds: 2,
  priceWeekday: 3000,
  priceWeekend: 3500,
  minNights: 1,
  checkIn: "14:00",
  checkOut: "12:00",
  rules: { pets: false, smoking: false, kids: true, parties: false },
  amenities: ["Wi-Fi"],
  description: "Светлая квартира жертвы у парка, тихий двор и парковка рядом",
};
const host = async (uid: number, address: string, n: number) => {
  await call("/phone", uid, { phone: `+7927000${String(uid).padStart(4, "0")}`, consent: true });
  const u = await ctx.store.getUser(uid);
  await ctx.store.saveUser({ ...u!, hostStatus: "approved" });
  const id = (await call("/host/save", uid, { form: { ...form, address, description: `${form.description} ${n}` } })).json.listing.id as string;
  await call("/host/photos-request", uid, { id });
  await bot({ update_type: "message_created", message: { sender: { user_id: uid }, body: { text: "", attachments: [img(n), img(n + 1)] } } });
  await call("/host/submit", uid, { id });
  return id;
};
const LV = await host(VHOST, "ул. Жертвенная, 1", 10);
const LE = await host(EVIL, "ул. Злая, 13", 20);
for (const g of [VGUEST, EVIL, EVIL2]) await call("/phone", g, { phone: `+7927111${String(g).padStart(4, "0")}`, consent: true });
const today = todaySamara(Date.now());
const d = (n: number) => addDays(today, n);
const B1 = (await call("/book", VGUEST, { id: LV, checkIn: d(10), checkOut: d(12), guests: 2, comment: "жду" })).json.booking.id as string; // ждёт ответа
const B2 = (await call("/book", VGUEST, { id: LV, checkIn: d(20), checkOut: d(22), guests: 2 })).json?.booking?.id as string;
await call("/host/decide", VHOST, { id: B2, accept: true }); // подтверждена
// Прошлая подтверждённая бронь для отзыва
const B3 = "pastbk01";
await ctx.store.saveBooking({ id: B3, listingId: LV, ownerId: VHOST, guestId: VGUEST, guestName: "Гость", guestPhone: null, checkIn: d(-5), checkOut: d(-3), guests: 1, nights: 2, total: 6000, comment: "", status: "confirmed", createdAt: Date.now(), decideBy: Date.now() } as any);
const T = (await call("/chat/open", VGUEST, { listingId: LV })).json.thread.id as string;
const M = (await call("/chat/send", VGUEST, { id: T, text: "Здравствуйте, парковка есть?" })).json;
const msgId = (await call("/chat/thread", VGUEST, { id: T })).json.messages[0].id as string;
await call("/review", VGUEST, { bookingId: B3, stars: 4, text: "Хорошо" });
const R = (await call("/listing", VGUEST, { id: LV })).json.listing.reviewList[0]?.id as string;
const TK = (await call("/support/send", VGUEST, { text: "Помогите с бронью, пожалуйста" })).json.ticket.id as string;
await call("/favorite", VGUEST, { id: LV, on: true });
void M;

/** Всё, что принадлежит жертвам. Злоумышленник не должен изменить ни байта */
const victimState = async () =>
  JSON.stringify([
    await ctx.store.getListing(LV),
    await ctx.store.getBooking(B1),
    await ctx.store.getBooking(B2),
    await ctx.store.getBooking(B3),
    await ctx.store.getThread(T),
    await ctx.store.listChatMessages(T),
    await ctx.store.listReviews(LV),
    await ctx.store.getUser(VHOST),
    await ctx.store.getUser(VGUEST),
    await ctx.store.kvList(`ticket:${VGUEST}:`),
    await ctx.store.getStaff(),
  ]);

// --- API1: чужие объекты ----------------------------------------------------------------------
const bola: [string, object][] = [
  ["/host/listing", { id: LV }],
  ["/host/save", { id: LV, form: { ...form, priceWeekday: 1 } }],
  ["/host/photos", { id: LV, order: [] }],
  ["/host/photos-request", { id: LV }],
  ["/host/photo-upload", { id: LV, data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000)]).toString("base64") }],
  ["/host/submit", { id: LV }],
  ["/host/delete", { id: LV }],
  ["/host/pause", { id: LV, paused: true }],
  ["/host/calendar", { id: LV, close: [d(30)], open: [] }],
  ["/host/decide", { id: B1, accept: true }],
  ["/host/decide", { id: B1, accept: false }],
  ["/host/noshow", { id: B2 }],
  ["/booking/cancel", { id: B2 }],
  ["/booking/cancel", { id: B1 }],
  ["/booking/hide", { id: B3 }],
  ["/chat/thread", { id: T }],
  ["/chat/send", { id: T, text: "я злоумышленник" }],
  ["/chat/delete", { id: T, messageId: msgId }],
  ["/chat/hide", { id: T }],
  ["/review", { bookingId: B3, stars: 1, text: "плохо" }],
  ["/review", { bookingId: B2, stars: 1 }],
  ["/host/review/dispute", { listingId: LV, id: R, text: "не согласен с этим отзывом" }],
  ["/admin/support/reply", { userId: VGUEST, id: TK, text: "ответ злоумышленника" }],
];
for (const [path, body] of bola) {
  const before = await victimState();
  const r = await call(path, EVIL, body);
  const after = await victimState();
  const leaked = path === "/chat/thread" && r.status === 200;
  expect(`API1 чужое: ${path} ${JSON.stringify(body).slice(0, 60)} → ${r.status}, изменилось чужое: ${before !== after}`, before === after && !leaked);
}
// /host/listing и /chat/thread не должны отдавать чужое
expect("API1: чужая анкета хозяина не читается", (await call("/host/listing", EVIL, { id: LV })).status === 404);
expect("API1: чужие брони не видны", !JSON.stringify((await call("/host/bookings", EVIL)).json).includes(B1));
expect("API1: чужие обращения не видны", !JSON.stringify((await call("/support/my", EVIL)).json).includes(TK));

// --- API2: подделка входа ---------------------------------------------------------------------
const good = signedInit(token, EVIL, "Злой");
const swapped = good.replace(encodeURIComponent(`"id":${EVIL}`), encodeURIComponent(`"id":${OWNER}`));
expect("API2: подмена id в подписанных данных", (await raw("/me", { initData: swapped })).status === 401);
expect("API2: без подписи", (await raw("/me", { initData: good.replace(/&hash=[0-9a-f]+/, "") })).status === 401);
expect("API2: два hash", (await raw("/me", { initData: `${good}&hash=00` })).status === 401);
expect("API2: подписано чужим токеном", (await raw("/me", { initData: signedInit("other-token", OWNER) })).status === 401);
const oldAuth = (() => {
  const p: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400), user: JSON.stringify({ id: OWNER }) };
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("\n")).digest("hex");
  return Object.entries({ ...p, hash }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
})();
expect("API2: старая подпись (3 дня)", (await raw("/me", { initData: oldAuth })).status === 401);
expect("API2: demoUser без подписи (не демо)", (await raw("/me", { demoUser: OWNER })).status === 401);
expect("API2: код через /demo/code в боевом режиме закрыт", (await call("/demo/code", EVIL, { code: "owner-code-1" })).status === 404);
expect("API2: вебхук без секрета", (await handleWebhook(ctx, undefined, {})).status === 401);
expect("API2: вебхук с неверным секретом", (await handleWebhook(ctx, "hook-secreT", {})).status === 401);
// перебор кода команды через бота
for (let i = 0; i < 12; i++) await bot({ update_type: "message_created", message: { sender: { user_id: EVIL2 }, body: { text: `/admin guess${i}aaaa` } } });
await bot({ update_type: "message_created", message: { sender: { user_id: EVIL2 }, body: { text: "/admin owner-code-1" } } });
expect("API2: после 5 неверных кодов верный тоже не принимается в этот час", !(await ctx.store.getAdmins()).includes(EVIL2));

// --- API3: лишние поля (подмена свойств) -----------------------------------------------------
const ma = (await call("/host/save", EVIL, { id: LE, form: { ...form, address: "ул. Злая, 13", ownerId: VHOST, status: "active", checked: true, botChecked: true, rating: { sum: 50, count: 10 }, approvedPrice: 1, publishedAt: 1, createdAt: 1, closed: [d(1)], photos: [{ url: "javascript:alert(1)" }], id: "hacked" } })).json.listing;
expect("API3: в анкете не меняются владелец, оценка, проверка, фото, id", ma.ownerId === EVIL && !ma.rating && ma.id === LE && !ma.photos.some((p: any) => p.url.startsWith("javascript")) && ma.publishedAt !== 1);
await call("/phone", EVIL, { phone: "+79271110666", consent: true, phoneVerified: true, blocked: false, hostStatus: "approved" });
expect("API3: «номер подтверждён» не ставится руками", !(await ctx.store.getUser(EVIL))?.phoneVerified);
const fake = (await call("/book", EVIL, { id: LV, checkIn: d(40), checkOut: d(43), guests: 1, total: 1, nights: 1, status: "confirmed", ownerId: EVIL, guestId: VGUEST })).json.booking;
expect("API3: в брони сумма, статус и гость — с сервера", fake?.total === 3000 * 3 || fake?.total > 3000) ;
const fb = fake ? await ctx.store.getBooking(fake.id) : undefined;
expect("API3: бронь не подтверждена сама и записана на злоумышленника", fb?.status === "requested" && fb?.guestId === EVIL && fb?.ownerId === VHOST);
const rv = await call("/review", EVIL, { bookingId: fake?.id, stars: 100 });
expect("API3: отзыв без проживания не принят", rv.status !== 200);
// лишние данные в ответах
const pub = JSON.stringify((await call("/listing", EVIL, { id: LV })).json);
expect("API3: в публичном объявлении нет квартиры, владельца, телефона, закрытых дат", !pub.includes("домофон") && !pub.includes(`"ownerId"`) && !pub.includes("79270000500") && !pub.includes(`"closed"`));
const bv = JSON.stringify((await call("/my/bookings", EVIL)).json);
expect("API3: в неподтверждённой брони нет адреса квартиры и телефона хозяина", !bv.includes("домофон") && !bv.includes("79270000500"));
const srch = JSON.stringify((await call("/search", EVIL, {})).json);
expect("API3: в поиске нет квартиры и телефонов", !srch.includes("домофон") && !srch.includes("7927000"));

// --- API5: админские пути без прав ----------------------------------------------------------
const ownerOnly = ["/admin/restore", "/admin/users", "/admin/user/block", "/admin/user/delete", "/admin/staff", "/admin/listing/delete", "/admin/listing/purge", "/admin/booking/cancel", "/admin/modcode", "/admin/staff/remove", "/admin/audit/delete", "/admin/audit"];
const staffOnly = ["/admin/applications", "/admin/application", "/admin/support", "/admin/support/reply", "/admin/reviews", "/admin/review", "/admin/pending", "/admin/complaint", "/admin/complaints/clear", "/admin/moderate", "/admin/block", "/admin/listings", "/admin/bookings", "/admin/stats"];
for (const p of [...ownerOnly, ...staffOnly]) {
  const before = await victimState();
  const r = await call(p, EVIL, { id: LV, userId: VGUEST, listingId: LV, ok: true, keep: false, blocked: true, action: "ban", rotate: true });
  expect(`API5: обычный человек → ${p}: ${r.status}`, r.status === 403 && before === (await victimState()));
}
for (const p of ownerOnly) {
  const r = await call(p, MOD, { id: VHOST, blocked: true, rotate: true });
  expect(`API5: модератор → ${p} (только главный): ${r.status}`, r.status === 403);
}
expect("API5: модератор не банит через жалобу", (await call("/admin/complaint", MOD, { id: "x", action: "ban" })).status === 403);
// кнопки бота от чужого
await bot({ update_type: "message_callback", callback: { callback_id: "c", user: { user_id: EVIL }, payload: `bk:ok:${B1}` } });
expect("API5: кнопка «Принять» в чужом запросе не работает", (await ctx.store.getBooking(B1))?.status === "requested");
await bot({ update_type: "message_callback", callback: { callback_id: "c", user: { user_id: EVIL }, payload: `mod:no:${LV}:fraud` } });
expect("API5: кнопка модерации от не-модератора", (await ctx.store.getListing(LV))?.status === "active");
await bot({ update_type: "message_callback", callback: { callback_id: "c", user: { user_id: EVIL }, payload: `rv:${B3}:1` } });
expect("API5: кнопка оценки чужой брони", (await ctx.store.listReviews(LV)).length === 1);

// --- логика брони -------------------------------------------------------------------------
expect("логика: бронь своего объявления", (await call("/book", EVIL, { id: LE, checkIn: d(5), checkOut: d(6), guests: 1 })).status === 400);
expect("логика: прошлые даты", (await call("/book", EVIL2, { id: LV, checkIn: d(-3), checkOut: d(-1), guests: 1 })).status !== 200);
expect("логика: выезд раньше заезда", (await call("/book", EVIL2, { id: LV, checkIn: d(9), checkOut: d(8), guests: 1 })).status !== 200);
expect("логика: несуществующая дата", (await call("/book", EVIL2, { id: LV, checkIn: "2026-02-30", checkOut: "2026-03-02", guests: 1 })).status !== 200);
expect("логика: 400 ночей", (await call("/book", EVIL2, { id: LV, checkIn: d(1), checkOut: d(401), guests: 1 })).status !== 200);
expect("логика: гостей больше, чем можно", (await call("/book", EVIL2, { id: LV, checkIn: d(60), checkOut: d(61), guests: 99 })).status !== 200);
expect("логика: занятые даты", (await call("/book", EVIL2, { id: LV, checkIn: d(10), checkOut: d(11), guests: 1 })).status !== 200);
expect("логика: отрицательная цена", (await call("/host/save", EVIL, { id: LE, form: { ...form, address: "ул. Злая, 13", priceWeekday: -100 } })).json.listing.priceWeekday >= 0);
expect("логика: город не из списка", (await call("/host/save", EVIL, { id: LE, form: { ...form, address: "ул. Злая, 13", locality: "<script>" } })).json.listing.locality !== "<script>");

// --- гонки: одновременные запросы ---------------------------------------------------------
{
  const guests = Array.from({ length: 12 }, (_, i) => 800 + i);
  for (const g of guests) await call("/phone", g, { phone: `+7927222${String(g).padStart(4, "0")}`, consent: true });
  const rs = await Promise.all(guests.map((g) => call("/book", g, { id: LV, checkIn: d(70), checkOut: d(72), guests: 1 })));
  expect(`гонка: 12 броней на одни даты одновременно → прошла ${rs.filter((r) => r.status === 200).length}`, rs.filter((r) => r.status === 200).length === 1);
}
{
  const b = "racebk01";
  await ctx.store.saveBooking({ id: b, listingId: LV, ownerId: VHOST, guestId: EVIL2, guestName: "x", guestPhone: null, checkIn: d(-4), checkOut: d(-2), guests: 1, nights: 2, total: 6000, comment: "", status: "confirmed", createdAt: Date.now(), decideBy: Date.now() } as any);
  const before = (await ctx.store.getListing(LV))?.rating?.count ?? 0;
  await Promise.all(Array.from({ length: 6 }, () => call("/review", EVIL2, { bookingId: b, stars: 5 })));
  const after = (await ctx.store.getListing(LV))?.rating?.count ?? 0;
  expect(`гонка: 6 оценок одной брони одновременно → засчитано ${after - before}`, after - before <= 1);
}
{
  const b = "racebk02";
  const G = 820;
  await call("/phone", G, { phone: "+79272220820", consent: true });
  await ctx.store.saveBooking({ id: b, listingId: LV, ownerId: VHOST, guestId: G, guestName: "x", guestPhone: null, checkIn: d(-1), checkOut: d(1), guests: 1, nights: 2, total: 6000, comment: "", status: "confirmed", createdAt: Date.now(), decideBy: Date.now() } as any);
  await Promise.all(Array.from({ length: 4 }, () => call("/host/noshow", VHOST, { id: b })));
  expect(`гонка: 4 «не приехал» одновременно → нарушений ${(await ctx.store.getUser(G))?.strikes}`, ((await ctx.store.getUser(G))?.strikes ?? 0) <= 1);
}
{
  const G = 821;
  await call("/phone", G, { phone: "+79272220821", consent: true });
  const before = (await ctx.store.getStats([LV]))[LV].favs;
  await Promise.all(Array.from({ length: 6 }, () => call("/favorite", G, { id: LV, on: true })));
  const after = (await ctx.store.getStats([LV]))[LV].favs;
  expect(`гонка: 6 «в избранное» одновременно → счётчик +${after - before}`, after - before <= 1);
}
{
  const G = 822;
  await call("/phone", G, { phone: "+79272220822", consent: true });
  const r = (await call("/book", G, { id: LV, checkIn: d(80), checkOut: d(81), guests: 1 })).json.booking.id as string;
  await Promise.all([
    call("/host/decide", VHOST, { id: r, accept: true }),
    bot({ update_type: "message_callback", callback: { callback_id: "c", user: { user_id: VHOST }, payload: `bk:no:${r}` } }),
    call("/booking/cancel", G, { id: r }),
  ]);
  const st = (await ctx.store.getBooking(r))?.status;
  expect(`гонка: принять + отклонить + отменить одновременно → один итог (${st})`, ["confirmed", "declined", "cancelled"].includes(st ?? ""));
}

// --- перегрузка -----------------------------------------------------------------------------
{
  const big = Array.from({ length: 50_000 }, (_, i) => addDays(today, i % 500));
  const r = await call("/host/calendar", EVIL, { id: LE, close: big, open: [] });
  expect(`перегрузка: 50 000 дат в календаре → сохранено ${r.json.closed?.length}`, (r.json.closed?.length ?? 0) <= 400);
  let n = 0;
  for (let i = 0; i < 25; i++) if ((await call("/host/save", EVIL, { form: { ...form, address: `ул. Спам, ${i}` } })).status === 200) n++;
  expect(`перегрузка: объявлений у одного хозяина не больше 20 (создано ещё ${n})`, n <= 19);
  let s = 0;
  for (let i = 0; i < 12; i++) if ((await call("/support/send", EVIL, { text: `спам обращение номер ${i}` })).status === 200) s++;
  expect(`перегрузка: обращений в поддержку за час ≤ 5 (прошло ${s})`, s <= 5);
  let c = 0;
  for (let i = 0; i < 10; i++) if ((await call("/complaint", EVIL, { id: LV, reason: "fake", text: `жалоба ${i}` })).status === 200) c++;
  expect(`перегрузка: жалоб за час ≤ 5 (прошло ${c})`, c <= 5);
  const long = await call("/chat/send", EVIL, { id: (await call("/chat/open", EVIL, { listingId: LV })).json.thread.id, text: "а".repeat(100_000) });
  expect("перегрузка: сообщение 100 000 знаков обрезано", (long.json.text?.length ?? 0) <= 1000);
}

// --- XSS: код в тексте хранится как текст и не исполняется (экран показывает его буквами) -----------
{
  const x = await call("/host/save", EVIL, { id: LE, form: { ...form, address: `ул. <img src=x onerror=alert(1)>`, description: `<script>alert(1)</script> Отличная квартира у парка и набережной`, flat: "<svg onload=alert(1)>" } });
  expect("XSS: в адресе и квартире вырезаны < >", !/[<>]/.test(x.json.listing.address) && !/[<>]/.test(x.json.listing.flat ?? ""));
}

// --- обход скрытия контактов -------------------------------------------------------------------
const bypass = [
  "8 927 123 45 67",
  "+7(927)1234567",
  "8 9 2 7 1 2 3 4 5 6 7",
  "８９２７１２３４５６７",
  "89 27 12 34 567",
  "8927l234567",
  "t.me/ivan_rent",
  "t . me / ivan_rent",
  "т.ме/ivan_rent",
  "@ivan_rent",
  "wa.me/79271234567",
  "пишите в whatsapp",
  "в ватсап",
  "вотсап",
  "в телегу",
  "в тг",
  "в tg",
  "viber",
  "vk.com/id123",
  "ВК id123",
  "инст ivan.rent",
  "ivan@mail.ru",
  "ivan собака mail точка ru",
  "карта 2202 2063 1234 5676",
  "2202206312345676",
  "по сбп на номер",
  "скиньте на карту",
  "авито",
];
for (const s of bypass) {
  const { masked } = maskContacts(s);
  expect(`контакты: «${s}» скрыт`, masked);
}

// --- и наоборот: обычный текст не должен скрываться ---------------------------------------------
const normal = [
  "Уютная квартира в центре, рядом остановка и магазины. Интернет, телевизор, вкусный кофе в соседней кофейне.",
  "Заезд с 14:00, выезд до 12:00. Цена 2500 за ночь, в пятницу и субботу 3000.",
  "Можно с детьми, есть детская кроватка. Тихий двор, парковка во дворе.",
  "Даты с 29.11 по 02.12, нас двое, приедем около 18:00",
  "Цены 1500, 2000, 2500, 3000 рублей в зависимости от сезона",
  "Квартира на 9 этаже, лифт работает, 10 минут до набережной",
  "Install, instance, вкладка. Отвезу вещи на тележке.",
  "Сделали ремонт в 2025 году, новая мебель, 45 кв.м.",
  "Подойдёт для командировки, есть стол, Wi-Fi, утюг",
  "Здравствуйте! Можно заехать пораньше, около 12? Поезд в 11:40",
];
for (const s of normal) expect(`ложное скрытие: «${s.slice(0, 40)}…» не тронут`, !maskContacts(s).masked);

// «удалить мои данные» с чужим id удаляет только себя
{
  const before = await victimState();
  await call("/me/delete", EVIL2, { id: VGUEST, userId: VGUEST });
  expect("API1: «удалить мои данные» с чужим id не трогает жертву", before === (await victimState()));
}

console.log(`\nПроверено атак: ${passed + holes.length}, отбито: ${passed}, дыр: ${holes.length}`);
for (const h of holes) console.log(`ДЫРА  ${h}`);
process.exit(0);
