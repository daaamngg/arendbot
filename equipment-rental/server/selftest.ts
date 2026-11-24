import { addDays, todaySamara } from "../shared/dates.ts";
import { memoryTable } from "./docs.ts";
import { decideDeadline, handleApi, processUpdate, sweep, type Ctx } from "./handlers.ts";
import { maxApi } from "./max-api.ts";
import { signedInit } from "./selftest-init.ts";

// Самопроверка без сети: npm run selftest. Клиенты — через настоящий initData, владелец — по коду /admin
const TOKEN = "test-token";
const sent: string[] = [];
const ctx: Ctx = {
  db: memoryTable(),
  max: maxApi({ token: TOKEN, dryRun: true, log: (s) => sent.push(s) }),
  config: { botToken: TOKEN, adminCode: "code-123", webhookSecret: "s", allowBrowser: false, decideHours: 3 },
  log: () => {},
};
let passed = 0;
let failed = 0;
const check = (name: string, cond: unknown) => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`✗ ${name}`);
  }
};
const as = (uid: number) => (path: string, body: Record<string, unknown> = {}) => handleApi(ctx, path, { ...body, initData: signedInit(TOKEN, uid, `U${uid}`) });
const A = as(101);
const B = as(102);
const OWNER = as(500);
const d = (n: number) => addDays(todaySamara(), n);
const j = (r: { json: unknown }) => r.json as any;

// Без MAX — нельзя
check("без initData 401", (await handleApi(ctx, "/me", {})).status === 401);
check("чужая подпись 401", (await handleApi(ctx, "/me", { initData: signedInit("other", 101) })).status === 401);

// Каталог
const items = j(await A("/items")).items;
check("13 единиц оборудования", items.length === 13);
check("новые цены оборудования", items.find((i: any) => i.id === "perforator")?.priceDay === 700 && items.find((i: any) => i.id === "drill")?.priceDay === 400 && items.find((i: any) => i.id === "grinder")?.priceDay === 500 && items.find((i: any) => i.id === "grinder-cordless")?.priceDay === 800);

// Заявка: без телефона нельзя
const book = (who: typeof A, from: number, to: number, extra: Record<string, unknown> = {}) =>
  who("/book", { itemId: "grinder", from: d(from), to: d(to), delivery: true, address: "ул. Кирова, 1", comment: "", ...extra });
check("без телефона нельзя", (await book(A, 2, 3)).status === 400);
check("телефон без согласия нельзя", (await A("/phone", { phone: "+79990001122" })).status === 400);
check("телефон", (await A("/phone", { phone: "+79990001122", consent: true })).status === 200);
await B("/phone", { phone: "+79990003344", consent: true });

// Проверки дат и адреса
check("прошлое нельзя", (await book(A, -2, -1)).status === 400);
check("конец раньше начала", (await book(A, 5, 3)).status === 400);
check("больше 30 суток нельзя", (await book(A, 1, 40)).status === 400);
check("доставка без адреса нельзя", (await book(A, 2, 3, { address: "" })).status === 400);
check("неизвестная техника", (await book(A, 2, 3, { itemId: "tank" })).status >= 400);

// Нормальная заявка и конфликт дней
const r1 = await book(A, 2, 4);
check("заявка создана", r1.status === 200);
const b1 = j(r1).booking;
check("3 суток включительно", b1?.days === 3);
check("сумма по цене каталога", b1?.total === 2000);
check("пересечение занято", (await book(B, 4, 6)).status === 409);
check("соседние дни свободны", (await book(B, 5, 6)).status === 200);
const busy = j(await A("/item", { id: "grinder" })).busy;
check("дни заняты в календаре", busy.includes(d(2)) && busy.includes(d(6)) && !busy.includes(d(7)));

// Владелец: до кода нет прав
check("без кода нет прав", (await OWNER("/owner/bookings")).status === 403);
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 500 }, body: { text: "/admin wrong" } } });
check("неверный код", (await OWNER("/owner/bookings")).status === 403);
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 500 }, body: { text: "/admin code-123" } } });
check("владелец по коду", j(await OWNER("/me")).owner === true);
check("владельцу видны заявки", j(await OWNER("/owner/bookings")).bookings.length === 2);

// Цена: сумма считается для новых заявок
check("клиент не меняет цену", (await A("/owner/price", { id: "drill", priceDay: 1 })).status === 403);
check("цена сохранена", j(await OWNER("/owner/price", { id: "drill", priceDay: 6000 })).item?.priceDay === 6000);
const r3 = j(await book(A, 10, 11, { itemId: "drill" })).booking;
check("сумма = 2 × 6000 + 500", r3?.total === 12500);
const r4 = j(await book(B, 20, 20, { itemId: "drill", delivery: false, address: "" })).booking;
check("самовывоз без доставки", r4?.total === 6000);

// Решение владельца: дважды не принимается, клиент не может решать
check("клиент не решает", (await A("/owner/decide", { id: b1.id, accept: true })).status === 403);
check("принято", (await OWNER("/owner/decide", { id: b1.id, accept: true })).status === 200);
await OWNER("/owner/decide", { id: b1.id, accept: false });
const st = (id: string) => ctx.db.get<any>("booking", id).then((b) => b?.status);
check("повторное решение не меняет", (await st(b1.id)) === "confirmed");
// Кнопка в чате от чужого — без прав
await processUpdate(ctx, { update_type: "message_callback", callback: { user: { user_id: 101 }, payload: `bk:no:${b1.id}`, callback_id: "x" } });
check("чужая кнопка не работает", (await st(b1.id)) === "confirmed");
await processUpdate(ctx, { update_type: "message_callback", callback: { user: { user_id: 500 }, payload: `bk:no:${r3.id}`, callback_id: "y" } });
check("отклонено кнопкой в чате", (await st(r3.id)) === "declined");

// Отмена: только своё
check("чужую не отменить", (await B("/cancel", { id: b1.id })).status >= 400);
check("своя отмена", (await A("/cancel", { id: b1.id })).status === 200);
check("дни освободились", !j(await A("/item", { id: "grinder" })).busy.includes(d(2)));

// Закрытые владельцем дни
check("клиент не закрывает дни", (await A("/owner/calendar", { itemId: "sc2", close: [d(3)], open: [] })).status === 403);
const cal = j(await OWNER("/owner/calendar", { itemId: "sc2", close: [d(3), d(4)], open: [] }));
check("дни закрыты", cal.closed?.length === 2);
check("на закрытые нельзя", (await book(A, 3, 3, { itemId: "sc2" })).status === 409);

// Срок ответа: днём 3 часа, ночью до 11:00 по Самаре (UTC+4)
const noon = Date.UTC(2026, 10, 20, 8, 0); // 12:00 Самара
check("днём +3 часа", decideDeadline(noon, 3) === noon + 3 * 3600_000);
const night = Date.UTC(2026, 10, 20, 19, 0); // 23:00 Самара
check("ночью до 11:00", new Date(decideDeadline(night, 3)).getUTCHours() === 7);

// Таймер: просроченная заявка закрывается
ctx.now = () => Date.now() + 2 * 86400_000;
await sweep(ctx);
check("просрочена", (await st(r4.id)) === "expired");
ctx.now = undefined;

// Акция: личный таймер с момента открытия, не перезапускается; скидка только на первую аренду от 2 суток
const C = as(103);
await C("/phone", { phone: "+79990005566", consent: true });
check("подарок ещё не открыт", j(await C("/me")).promoAt === null);
const p1 = j(await C("/promo/open")).promoAt;
ctx.now = () => Date.now() + 3600_000;
check("время открытия не сбрасывается", j(await C("/promo/open")).promoAt === p1);
ctx.now = undefined;
const spin1 = j(await C("/spin"));
check("при стартовой скидке спин даёт 5% до её конца", spin1.spinPercent === 5 && spin1.spinExpiresAt === p1 + 86400_000);
check("повторный спин в тот же день запрещён", (await C("/spin")).status === 409);
const c1 = j(await book(C, 30, 30, { itemId: "drill", delivery: false, address: "" })).booking;
check("1 сутки — только спин 5%", c1?.discount === 5 && c1?.total === 5700);
await C("/cancel", { id: c1.id });
const c2 = j(await book(C, 32, 33, { itemId: "drill", delivery: true })).booking;
check("первая аренда от 2 суток −20%", c2?.discount === 20 && c2?.total === 9600 + 500);
check("скидка видна владельцу", sent.some((s) => s.includes("Акция: скидка 20%")));
check("подарок использован", j(await C("/me")).promoUsed === true);
const c3 = j(await book(C, 40, 41, { itemId: "drill", delivery: false, address: "" })).booking;
check("после первой аренды остаётся скидка спина", c3?.discount === 5);
const D = as(104);
await D("/phone", { phone: "+79990007788", consent: true });
await D("/promo/open");
// Подарок открыт сутки и минуту назад (подпись initData сдвигать нельзя — сдвигаем время открытия)
const du = await ctx.db.get<any>("user", "104");
await ctx.db.put({ kind: "user", id: "104", data: { ...du, promoAt: Date.now() - 86400_000 - 60_000 } });
const d1 = j(await book(D, 50, 52, { itemId: "drill", delivery: false, address: "" })).booking;
check("через сутки сгорела", d1?.discount === 0);
const firstSpins = await Promise.all([D("/spin"), D("/spin")]);
check("два одновременных спина — только один приз", firstSpins.filter((r) => r.status === 200).length === 1 && firstSpins.filter((r) => r.status === 409).length === 1);
const firstSpin = j(firstSpins.find((r) => r.status === 200)!);
check("без стартовой акции приз 5, 10 или 15% на сутки", [5, 10, 15].includes(firstSpin.spinPercent) && firstSpin.spinExpiresAt - firstSpin.spinAt === 86400_000);
const dUser = await ctx.db.get<any>("user", "104");
await ctx.db.put({ kind: "user", id: "104", data: { ...dUser, spinAt: Date.now() - 86400_000 - 1 } });
check("через 24 часа можно крутить снова", (await D("/spin")).status === 200);

// Проверочная заявка владельца: видна только ему, дни для клиентов не занимает, другим владельцам не приходит
const O2 = as(501);
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 501 }, body: { text: "/admin code-123" } } });
await OWNER("/phone", { phone: "+79990009900", consent: true });
const tb = j(await book(OWNER, 60, 61, { itemId: "wv1" })).booking;
check("заявка владельца — проверочная", tb?.test === true);
check("второй владелец её не видит", !j(await O2("/owner/bookings")).bookings.some((b: any) => b.id === tb.id));
check("автор её видит", j(await OWNER("/owner/bookings")).bookings.some((b: any) => b.id === tb.id));
check("клиенту дни свободны", !j(await A("/item", { id: "wv1" })).busy.includes(d(60)));
check("второй владелец не решает чужую проверку", (await O2("/owner/decide", { id: tb.id, accept: true })).status === 404);
await processUpdate(ctx, { update_type: "message_created", message: { sender: { user_id: 501 }, body: { text: "/выйти" } } });
check("/выйти снимает владельца", j(await O2("/me")).owner === false && j(await OWNER("/me")).owner === true);

// Уведомления: заявка с кнопками ушла владельцу
check("кнопки владельцу", sent.some((s) => s.includes("bk:ok:")));

console.log(`\n${failed ? "✗" : "✓"} ${passed} проверок прошло${failed ? `, ${failed} упало` : ""}`);
process.exit(failed ? 1 : 0);
