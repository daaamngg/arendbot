// Посмотреть облачную базу (только чтение): люди, объявления, брони, проверка номера.
// YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) YDB_CONNECTION=... node scripts/cloud-inspect.ts
import { docStore } from "../server/doc-store.ts";
import { ydbTable } from "../server/ydb-table.ts";
const store = docStore(await ydbTable(process.env.YDB_CONNECTION!), { photoUrl: (n) => n });
const users = await store.searchUsers("", 500);
const mask = (p: string | null) => (p ? `…${p.slice(-2)}` : "нет");
console.log("люди:", users.length);
for (const u of users) console.log(" ", u.id, u.name, "тел", mask(u.phone), u.phoneVerified ? "подтв." : "", u.blocked ? "БЛОК" : "", u.deletedAt ? "удалён" : "", u.id >= 900_000_000 ? "ТЕСТ" : "");
console.log("staff:", JSON.stringify((await store.getStaff()).map((m) => [m.id, m.role])));
for (const l of await store.listListings()) console.log("объявление", l.id, l.ownerId, l.status, l.locality, l.address);
const bs = await store.listBookings();
console.log("брони:", bs.length);
for (const b of bs) console.log(" ", b.id, b.listingId, b.guestId, b.status, b.checkIn, new Date(b.createdAt).toISOString().slice(0, 10));
console.log("contactcheck:last", JSON.stringify(await store.kvGet("contactcheck:last")));
console.log("жалобы:", (await store.listComplaints()).length, "переписки:", (await store.listThreads(0)).length);
process.exit(0);
