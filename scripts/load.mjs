// Нагрузка на сервер: сколько запросов в секунду выдерживает и как растёт время записи в базу.
// 1) Запросы к работающему локальному API (npm run api): поиск, карточка, «я», мои брони — параллельно.
// 2) Хранилище-файл на большой базе: сколько стоит одна запись (сейчас вся база переписывается целиком).
// Запуск: node scripts/load.mjs [параллельно=50] [всего=2000]
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../server/store.ts";

const [conc = "50", total = "2000"] = process.argv.slice(2);
const API = process.env.API ?? "http://localhost:8788/api";
const C = Number(conc);
const N = Number(total);

async function hit(path, body = {}) {
  const t = performance.now();
  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await r.text();
  return { ms: performance.now() - t, ok: r.ok };
}

const pct = (xs, p) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))].toFixed(1);

// --- 1. API
try {
  const first = await (await fetch(API + "/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  const id = first.cards?.[0]?.id;
  const mix = [() => hit("/search", { guests: 2 }), () => hit("/listing", { id }), () => hit("/me"), () => hit("/my/bookings"), () => hit("/chat/list")];
  const times = [];
  let fails = 0;
  let i = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: C }, async () => {
      while (i < N) {
        const r = await mix[i++ % mix.length]();
        times.push(r.ms);
        if (!r.ok) fails++;
      }
    }),
  );
  const sec = (performance.now() - t0) / 1000;
  console.log(`API: ${N} запросов, ${C} одновременно → ${(N / sec).toFixed(0)} в секунду; ответ p50 ${pct(times, 0.5)} мс, p95 ${pct(times, 0.95)} мс, ошибок ${fails}`);
} catch (e) {
  console.log(`API не отвечает (${e.message}). Запустите npm run api и повторите.`);
}

// --- 2. Хранилище-файл на большой базе (сразу пишем готовый файл, иначе подготовка сама шла бы часами)
const dir = mkdtempSync(join(tmpdir(), "arenda-load-"));
const now = Date.now();
const listings = {};
for (let n = 0; n < 3000; n++) {
  listings[`l${n}`] = {
    id: `l${n}`, ownerId: 1000 + (n % 500), status: "active", type: "flat", locality: "Самара", district: "", address: `ул. Тестовая, ${n}`,
    rooms: 1, area: 30, floor: 2, guests: 2, beds: 1, priceWeekday: 2000, priceWeekend: 2500, deposit: 0, minNights: 1,
    checkIn: "14:00", checkOut: "12:00", cancelDays: 0, description: "Тестовое объявление для нагрузки ".repeat(4),
    rules: { pets: false, smoking: false, kids: true, parties: false }, amenities: ["Wi-Fi"], photos: [{ url: `/p/${n}.jpg` }, { url: `/q/${n}.jpg` }, { url: `/r/${n}.jpg` }],
    closed: [], createdAt: now, updatedAt: now,
  };
}
const bookings = {};
for (let n = 0; n < 20000; n++) {
  bookings[`b${n}`] = { id: `b${n}`, listingId: `l${n % 3000}`, ownerId: 1000, guestId: 5000 + n, guestName: "Гость", guestPhone: "+79270000000", checkIn: "2026-12-01", checkOut: "2026-12-02", guests: 1, nights: 1, total: 2000, comment: "", status: "cancelled", createdAt: now, decideBy: now };
}
writeFileSync(join(dir, "db.json"), JSON.stringify({ users: {}, listings, bookings, reviews: {}, complaints: {}, threads: {}, chat: {}, replies: {}, staff: [], audit: [], messages: {}, marks: {}, kv: {} }));
const store = fileStore(join(dir, "db.json"));
const t1 = performance.now();
for (let n = 0; n < 50; n++) await store.saveBooking({ ...(await store.getBooking("b1")), comment: String(n) });
console.log(`\nФайл-база: 3000 объявлений и 20 000 броней — одна запись ${((performance.now() - t1) / 50).toFixed(1)} мс (переписывается вся база)`);
const t2 = performance.now();
for (let n = 0; n < 20; n++) await store.listListings({ status: ["active"] });
console.log(`Поиск по всем объявлениям в памяти: ${((performance.now() - t2) / 20).toFixed(1)} мс`);
