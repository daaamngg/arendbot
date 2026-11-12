// Гонка на настоящей YDB: 10 человек одновременно бронируют одни и те же даты одного жилья.
// Должна пройти ровно одна бронь — остальные получают «занято», даже если запросы пришли в разные копии сервера.
// Запуск: YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) node scripts/ydb-race-test.ts <YDB_CONNECTION>
// После проверки тестовые записи удаляются.
import { checkRange } from "../shared/dates.ts";
import type { Booking, Listing } from "../shared/types.ts";
import { docStore } from "../server/doc-store.ts";
import { ydbTable } from "../server/ydb-table.ts";

const conn = process.argv[2];
const table = await ydbTable(conn);
const store = docStore(table);
const now = Date.now();
const L = `race-${now.toString(36)}`;
const listing = {
  id: L, ownerId: 1, status: "active", type: "flat", locality: "Самара", district: "", address: "тест", rooms: 1, area: 30, floor: 1,
  guests: 2, beds: 1, priceWeekday: 2000, priceWeekend: 2000, deposit: 0, minNights: 1, checkIn: "14:00", checkOut: "12:00",
  cancelDays: 0, description: "тест", rules: { pets: false, smoking: false, kids: true, parties: false }, amenities: [], photos: [],
  closed: [], createdAt: now, updatedAt: now,
} as unknown as Listing;
await store.saveListing(listing);
const day = new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
const next = new Date(now + 32 * 86_400_000).toISOString().slice(0, 10);

const tries = Array.from({ length: 10 }, (_, i) => {
  const b = { id: `${L}-b${i}`, listingId: L, ownerId: 1, guestId: 1000 + i, guestName: "Тест", guestPhone: "+70000000000", checkIn: day, checkOut: next, guests: 1, nights: 2, total: 4000, comment: "", status: "requested", createdAt: now, decideBy: now + 3600e3 } as Booking;
  return store.createBookingIfFree(b, (l, bookings) => checkRange(l, bookings, day, next, now) === null);
});
const results = await Promise.allSettled(tries);
const ok = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
const busy = results.filter((r) => r.status === "fulfilled" && r.value === false).length;
const err = results.filter((r) => r.status === "rejected").length;
console.log(`10 одновременных броней на одни даты: прошла ${ok}, «занято» ${busy}, ошибок ${err}`);
console.log(ok === 1 && err === 0 ? "OK: двойной брони нет" : "ПРОБЛЕМА");
if (err) console.log(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason).slice(0, 200)));

// Уборка тестовых записей
for (let i = 0; i < 10; i++) await table.del("booking", `${L}-b${i}`);
await table.del("listing", L);
console.log("тестовые записи удалены");
process.exit(0);
