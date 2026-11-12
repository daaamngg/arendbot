import { randomUUID } from "node:crypto";
import type { AuditEntry, Booking, ChatMessage, ChatThread, Complaint, Listing, Review, StaffMember, User } from "../shared/types.ts";
import type { ReplyTarget, Store } from "./store.ts";

// Хранилище для облака: та же логика, что у файла, но поверх «таблицы документов».
// Таблица одна: (вид, id) → JSON, плюс до четырёх полей для поиска g1…g4 (у каждого свой индекс в YDB).
// Так не нужно 15 таблиц и миграций, а запросы всё равно идут по индексу, без чтения всей базы
// (в YDB платят за прочитанные строки — полный перебор на каждом обновлении экрана съел бы бесплатный лимит).
//
// Какие поля поиска у каждого вида:
//   user      g1 = телефон,           g2 = статус заявки хозяина
//   listing   g1 = id хозяина,        g2 = статус
//   booking   g1 = id объявления,     g2 = id гостя,  g3 = id хозяина,  g4 = статус
//   thread    g1 = объявление:гость,  g2 = id гостя,  g3 = id хозяина
//   chat      id = переписка:время:id, g1 = id переписки
//   review    g1 = id объявления
//   complaint g1 = id объявления,     g2 = «open» / «closed»
//   audit     id = время:случайное (по порядку)
//   photo     id = <uuid>.jpg, data = base64 (пока в базе; потом можно в Object Storage)
//   kv, reply, msgs, mark, staff — по ключу

export type GField = "g1" | "g2" | "g3" | "g4";

export interface DocRow {
  kind: string;
  id: string;
  g1?: string;
  g2?: string;
  g3?: string;
  g4?: string;
  data: unknown;
}

/** То, что умеет любая «таблица документов»: память (тесты) или YDB (облако) */
export interface DocTx {
  get<T>(kind: string, id: string): Promise<T | undefined>;
  find<T>(kind: string, field: GField, value: string): Promise<T[]>;
  put(row: DocRow): Promise<void>;
}

export interface DocTable extends DocTx {
  del(kind: string, id: string): Promise<void>;
  /** все документы вида — только для редких дел (админка, подсчёт) */
  all<T>(kind: string): Promise<T[]>;
  /** документы вида с id, начинающимся на prefix, по порядку id */
  prefix<T>(kind: string, prefix: string): Promise<[string, T][]>;
  /** чтение и запись одним действием: никто не вклинится между проверкой и записью */
  tx<T>(fn: (t: DocTx) => Promise<T>): Promise<T>;
}

const s = (v: unknown) => (v == null ? "" : String(v));

const userRow = (u: User): DocRow => ({ kind: "user", id: s(u.id), g1: s(u.phone), g2: s(u.hostStatus), data: u });
const listingRow = (l: Listing): DocRow => ({ kind: "listing", id: l.id, g1: s(l.ownerId), g2: l.status, data: l });
const bookingRow = (b: Booking): DocRow => ({ kind: "booking", id: b.id, g1: b.listingId, g2: s(b.guestId), g3: s(b.ownerId), g4: b.status, data: b });
const threadRow = (t: ChatThread): DocRow => ({ kind: "thread", id: t.id, g1: `${t.listingId}:${t.guestId}`, g2: s(t.guestId), g3: s(t.ownerId), data: t });
// Сообщения одной миллисекунды остаются по порядку отправки: время + счётчик
let chatSeq = 0;
const chatId = (m: ChatMessage) => {
  chatSeq = (chatSeq + 1) % 1e6;
  return `${m.threadId}:${String(m.createdAt).padStart(15, "0")}:${String(chatSeq).padStart(6, "0")}:${m.id}`;
};
const chatRow = (m: ChatMessage, id = chatId(m)): DocRow => ({ kind: "chat", id, g1: m.threadId, data: m });

const byDesc = <T>(key: (x: T) => number) => (a: T, b: T) => key(b) - key(a);

let seq = 0;

/** photoUrl — по какому адресу отдавать загруженное фото (в облаке — адрес функции) */
/**
 * photoUrl — по какому адресу отдавать загруженное фото.
 * photos — внешнее хранилище фото (в облаке — Object Storage). Без него фото лежат в самой таблице:
 * в YDB так делать дорого (одно фото ≈ 100 единиц запроса из бесплатного миллиона), поэтому в облаке — бакет
 */
export function docStore(db: DocTable, opts: { photoUrl?: (name: string) => string; photos?: { save(name: string, jpeg: Buffer): Promise<string> } } = {}): Store {
  const photoUrl = opts.photoUrl ?? ((name: string) => `/api/photos/${name}`);
  // Команда нужна почти в каждом запросе — держим 3 секунды (только против всплеска запросов). Дольше нельзя:
  // в облаке несколько копий сервера, и после кода боту вкладка «Админ» появлялась бы с задержкой
  let staffCache: { at: number; list: StaffMember[] } | null = null;
  const getStaff = async () => {
    if (staffCache && Date.now() - staffCache.at < 3_000) return staffCache.list;
    const list = (await db.get<StaffMember[]>("staff", "all")) ?? [];
    staffCache = { at: Date.now(), list };
    return list;
  };
  return {
    getUser: (id) => db.get<User>("user", s(id)),
    saveUser: (u) => db.put(userRow(u)),

    getListing: (id) => db.get<Listing>("listing", id),
    saveListing: (l) => db.put(listingRow(l)),
    async listListings(q) {
      let list: Listing[];
      if (q?.ownerId != null) list = await db.find<Listing>("listing", "g1", s(q.ownerId));
      else if (q?.status) list = (await Promise.all(q.status.map((st) => db.find<Listing>("listing", "g2", st)))).flat();
      else list = await db.all<Listing>("listing");
      return list.filter((l) => !q?.status || q.status.includes(l.status)).sort(byDesc((l) => l.updatedAt));
    },

    getBooking: (id) => db.get<Booking>("booking", id),
    saveBooking: (b) => db.put(bookingRow(b)),
    async listBookings(q) {
      let list: Booking[];
      if (q?.listingId != null) list = await db.find<Booking>("booking", "g1", q.listingId);
      else if (q?.guestId != null) list = await db.find<Booking>("booking", "g2", s(q.guestId));
      else if (q?.ownerId != null) list = await db.find<Booking>("booking", "g3", s(q.ownerId));
      else if (q?.status) list = (await Promise.all(q.status.map((st) => db.find<Booking>("booking", "g4", st)))).flat();
      else list = await db.all<Booking>("booking");
      return list
        .filter(
          (b) =>
            (q?.listingId == null || b.listingId === q.listingId) &&
            (q?.guestId == null || b.guestId === q.guestId) &&
            (q?.ownerId == null || b.ownerId === q.ownerId) &&
            (!q?.status || q.status.includes(b.status)),
        )
        .sort(byDesc((b) => b.createdAt));
    },
    createBookingIfFree(b, isFree) {
      // В облаке два запроса на одни даты могут прийти в разные копии сервера одновременно.
      // Поэтому проверка и запись — в одной транзакции: вторая увидит первую бронь или будет повторена
      return db.tx(async (t) => {
        const l = await t.get<Listing>("listing", b.listingId);
        if (!l) return false;
        const fresh = await t.find<Booking>("booking", "g1", b.listingId);
        if (!isFree(l, fresh)) return false;
        await t.put(bookingRow(b));
        return true;
      });
    },

    saveReview: (r) => db.put({ kind: "review", id: r.id, g1: r.listingId, data: r }),
    async listReviews(listingId) {
      return (await db.find<Review>("review", "g1", listingId)).sort(byDesc((r) => r.createdAt));
    },
    saveComplaint: (c) => db.put({ kind: "complaint", id: c.id, g1: c.listingId, g2: c.resolved ? "closed" : "open", data: c }),
    async listComplaints(q) {
      const list =
        q?.listingId != null
          ? await db.find<Complaint>("complaint", "g1", q.listingId)
          : q?.open != null
            ? await db.find<Complaint>("complaint", "g2", q.open ? "open" : "closed")
            : await db.all<Complaint>("complaint");
      return list.filter((c) => q?.open == null || !c.resolved === q.open).sort(byDesc((c) => c.createdAt));
    },

    getThread: (id) => db.get<ChatThread>("thread", id),
    async findThread(listingId, guestId) {
      return (await db.find<ChatThread>("thread", "g1", `${listingId}:${guestId}`))[0];
    },
    saveThread: (t) => db.put(threadRow(t)),
    async listThreads(userId) {
      const [asGuest, asOwner] = await Promise.all([db.find<ChatThread>("thread", "g2", s(userId)), db.find<ChatThread>("thread", "g3", s(userId))]);
      const seen = new Set<string>();
      return [...asGuest, ...asOwner].filter((t) => !seen.has(t.id) && seen.add(t.id)).sort(byDesc((t) => t.updatedAt));
    },
    addChatMessage: (m) => db.put(chatRow(m)),
    async listChatMessages(threadId, limit = 200) {
      return (await db.prefix<ChatMessage>("chat", `${threadId}:`)).map(([, m]) => m).slice(-limit);
    },
    async markChatMessageDeleted(threadId, id, at) {
      // Перезаписываем ту же строку (тот же ключ), а не создаём новую
      const row = (await db.prefix<ChatMessage>("chat", `${threadId}:`)).find(([, x]) => x.id === id);
      if (!row) return undefined;
      const [key, m] = row;
      m.deletedAt ??= at;
      await db.put(chatRow(m, key));
      return m;
    },
    getReplyTarget: (mid) => db.get<ReplyTarget>("reply", mid),
    setReplyTarget: (mid, t) => db.put({ kind: "reply", id: mid, data: t }),

    getStaff,
    async saveStaff(list) {
      staffCache = null;
      await db.put({ kind: "staff", id: "all", data: list });
    },
    async getAdmins() {
      return (await getStaff()).map((m) => m.id);
    },
    listUsersByPhone: (phone) => db.find<User>("user", "g1", phone),
    async findUserByPhone(phone) {
      return (await db.find<User>("user", "g1", phone))[0];
    },
    async listHostApplicants(status) {
      return (await db.find<User>("user", "g2", status)).sort((a, b) => (a.hostApp?.at ?? 0) - (b.hostApp?.at ?? 0));
    },

    async savePhoto(jpeg) {
      const name = `${randomUUID()}.jpg`;
      if (opts.photos) return opts.photos.save(name, jpeg);
      await db.put({ kind: "photo", id: name, data: jpeg.toString("base64") });
      return photoUrl(name);
    },
    async readPhoto(name) {
      if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) return undefined;
      const b64 = await db.get<string>("photo", name);
      return b64 ? Buffer.from(b64, "base64") : undefined;
    },
    async searchUsers(q, limit = 50) {
      // Админка, редко: перебор людей допустим
      const needle = q.trim().toLowerCase();
      const digits = needle.replace(/\D/g, "");
      return (await db.all<User>("user"))
        .filter((u) => !needle || String(u.id) === needle || (digits.length >= 4 && (u.phone ?? "").includes(digits)) || (u.name ?? "").toLowerCase().includes(needle))
        .sort(byDesc((u) => u.createdAt))
        .slice(0, limit);
    },
    async countUsers() {
      return (await db.all<User>("user")).length;
    },

    async addAudit(e) {
      // Время + счётчик: записи одной миллисекунды остаются по порядку (+ случайный хвост от совпадений между копиями сервера)
      seq = (seq + 1) % 1e6;
      await db.put({ kind: "audit", id: `${String(e.at).padStart(15, "0")}:${String(seq).padStart(6, "0")}:${randomUUID().slice(0, 4)}`, data: e });
    },
    async listAudit(limit = 100) {
      return (await db.prefix<AuditEntry>("audit", "")).map(([, e]) => e).slice(-limit).reverse();
    },
    async getMessageIds(key) {
      return (await db.get<string[]>("msgs", key)) ?? [];
    },
    async addMessageId(key, mid) {
      await db.tx(async (t) => {
        const list = (await t.get<string[]>("msgs", key)) ?? [];
        await t.put({ kind: "msgs", id: key, data: [...list, mid] });
      });
    },
    seenRecently(key, ttlMs) {
      return db.tx(async (t) => {
        const at = await t.get<number>("mark", key);
        if (at != null && Date.now() - at < ttlMs) return true;
        await t.put({ kind: "mark", id: key, data: Date.now() });
        return false;
      });
    },
    kvGet: <T>(key: string) => db.get<T>("kv", key),
    async kvSet(key, value) {
      if (value === undefined) await db.del("kv", key);
      else await db.put({ kind: "kv", id: key, data: value });
    },
    kvList: <T>(prefix: string) => db.prefix<T>("kv", prefix),
  };
}

/** Таблица в памяти — для самопроверки облачного хранилища без облака */
export function memoryTable(): DocTable {
  const rows = new Map<string, DocRow>();
  const key = (kind: string, id: string) => `${kind}\u0000${id}`;
  // Копия на входе и выходе — как настоящая база: изменение объекта в коде не меняет сохранённое
  const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  let chain: Promise<unknown> = Promise.resolve();
  const t: DocTable = {
    async get<T>(kind: string, id: string) {
      return clone(rows.get(key(kind, id))?.data as T | undefined);
    },
    async find<T>(kind: string, field: GField, value: string) {
      return [...rows.values()].filter((r) => r.kind === kind && r[field] === value).map((r) => clone(r.data as T));
    },
    async put(row) {
      rows.set(key(row.kind, row.id), clone(row));
    },
    async del(kind, id) {
      rows.delete(key(kind, id));
    },
    async all<T>(kind: string) {
      return [...rows.values()].filter((r) => r.kind === kind).map((r) => clone(r.data as T));
    },
    async prefix<T>(kind: string, p: string) {
      return [...rows.values()]
        .filter((r) => r.kind === kind && r.id.startsWith(p))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((r) => [r.id, clone(r.data as T)] as [string, T]);
    },
    tx<T>(fn: (x: DocTx) => Promise<T>) {
      // Транзакции по очереди — в памяти этого достаточно
      const run = chain.then(() => fn(t));
      chain = run.catch(() => {});
      return run;
    },
  };
  return t;
}
