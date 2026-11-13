import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuditEntry, Booking, BookingStatus, ChatMessage, ChatThread, Complaint, Listing, ListingStatus, Review, StaffMember, User } from "../shared/types.ts";

/** Куда уходит ответ на сообщение бота: «ответить» на уведомление о вопросе = написать в эту переписку */
export interface ReplyTarget {
  threadId: string;
  as: "guest" | "owner";
}

// Хранилище. Сейчас — JSON-файл (разработка и показ). В облаке нужна YDB: там createBookingIfFree
// делается одной транзакцией, иначе две брони на одни даты могут проскочить одновременно.
// Код сервера работает только через этот интерфейс, поэтому замена хранилища его не затронет.

export interface Store {
  getUser(id: number): Promise<User | undefined>;
  saveUser(u: User): Promise<void>;

  getListing(id: string): Promise<Listing | undefined>;
  saveListing(l: Listing): Promise<void>;
  /** стереть объявление из базы насовсем (брони и жалобы остаются для истории) */
  purgeListing(id: string): Promise<void>;
  /** счётчики объявления: просмотры и сколько людей добавили в избранное */
  bumpStat(listingId: string, field: "views" | "favs", delta: number): Promise<void>;
  getStats(ids: string[]): Promise<Record<string, { views: number; favs: number }>>;
  listListings(q?: { ownerId?: number; status?: ListingStatus[] }): Promise<Listing[]>;

  getBooking(id: string): Promise<Booking | undefined>;
  saveBooking(b: Booking): Promise<void>;
  listBookings(q?: { listingId?: string; guestId?: number; ownerId?: number; status?: BookingStatus[] }): Promise<Booking[]>;
  /**
   * Атомарно: проверить, что даты свободны, и сохранить бронь.
   * isFree получает свежие брони объявления и само объявление; false — бронь не сохраняется
   */
  createBookingIfFree(b: Booking, isFree: (listing: Listing, bookings: Booking[]) => boolean): Promise<boolean>;

  saveReview(r: Review): Promise<void>;
  listReviews(listingId: string): Promise<Review[]>;
  saveComplaint(c: Complaint): Promise<void>;
  listComplaints(q?: { open?: boolean; listingId?: string }): Promise<Complaint[]>;

  getThread(id: string): Promise<ChatThread | undefined>;
  findThread(listingId: string, guestId: number): Promise<ChatThread | undefined>;
  saveThread(t: ChatThread): Promise<void>;
  /** переписки человека — и как гостя, и как хозяина */
  listThreads(userId: number): Promise<ChatThread[]>;
  addChatMessage(m: ChatMessage): Promise<void>;
  listChatMessages(threadId: string, limit?: number): Promise<ChatMessage[]>;
  /** пометить сообщение удалённым; возвращает его (или undefined, если нет такого) */
  markChatMessageDeleted(threadId: string, id: string, at: number): Promise<ChatMessage | undefined>;
  getReplyTarget(mid: string): Promise<ReplyTarget | undefined>;
  setReplyTarget(mid: string, t: ReplyTarget): Promise<void>;

  /** команда площадки: главный (Сергей) и модераторы. getAdmins — их id для рассылки */
  getStaff(): Promise<StaffMember[]>;
  saveStaff(list: StaffMember[]): Promise<void>;
  getAdmins(): Promise<number[]>;

  findUserByPhone(phone: string): Promise<User | undefined>;
  /** все люди с этим номером (для проверки: номер у нескольких аккаунтов, у заблокированного) */
  listUsersByPhone(phone: string): Promise<User[]>;
  /** люди с заявкой «хочу сдавать» в нужном статусе */
  listHostApplicants(status: "pending" | "approved" | "rejected"): Promise<User[]>;

  /**
   * Фото объявления, загруженное прямо из приложения (уже сжатое на телефоне, без геометок).
   * Возвращает адрес картинки. Локально — файл и /api/photos/…, в облаке — Object Storage
   */
  savePhoto(jpeg: Buffer): Promise<string>;
  readPhoto(name: string): Promise<Buffer | undefined>;
  /** поиск людей для админки: по номеру, имени или MAX id */
  searchUsers(q: string, limit?: number): Promise<User[]>;
  countUsers(): Promise<number>;

  /** журнал действий команды: кто, что и с чем сделал */
  addAudit(e: AuditEntry): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;

  /** сообщения бота по объекту (брони или объявлению) — чтобы потом поправить кнопки */
  getMessageIds(key: string): Promise<string[]>;
  addMessageId(key: string, mid: string): Promise<void>;
  /** было ли событие за последние ttlMs (и отметить его) — от двойных приветствий */
  seenRecently(key: string, ttlMs: number): Promise<boolean>;

  /** мелкие записи по ключу: входы в админку (login:…, code:…) и ключи устройств (sess:…). undefined — удалить */
  kvGet<T>(key: string): Promise<T | undefined>;
  kvSet(key: string, value: unknown): Promise<void>;
  kvList<T>(prefix: string): Promise<[string, T][]>;
}

interface Db {
  users: Record<string, User>;
  listings: Record<string, Listing>;
  bookings: Record<string, Booking>;
  reviews: Record<string, Review>;
  complaints: Record<string, Complaint>;
  threads: Record<string, ChatThread>;
  chat: Record<string, ChatMessage[]>;
  replies: Record<string, ReplyTarget>;
  staff: StaffMember[];
  audit: AuditEntry[];
  /** старый формат: просто id админов (до ролей) */
  admins?: number[];
  messages: Record<string, string[]>;
  marks: Record<string, number>;
  kv: Record<string, unknown>;
}

/** Только свои записи: getListing("__proto__") не должен вернуть служебный объект JavaScript */
const own = <T>(rec: Record<string, T>, id: string | number): T | undefined => (Object.hasOwn(rec, String(id)) ? rec[String(id)] : undefined);

export function fileStore(path: string): Store {
  let db: Db;
  try {
    db = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    db = { users: {}, listings: {}, bookings: {}, reviews: {}, complaints: {}, threads: {}, chat: {}, replies: {}, staff: [], audit: [], messages: {}, marks: {}, kv: {} };
  }
  // База от прошлой версии — без новых разделов и полей
  db.reviews ??= {};
  db.complaints ??= {};
  db.threads ??= {};
  db.chat ??= {};
  db.replies ??= {};
  for (const l of Object.values(db.listings)) l.cancelDays ??= 0;
  db.audit ??= [];
  db.kv ??= {};
  // Админы из старой версии становятся главными (это Сергей и Арслан, вошедшие по коду)
  db.staff ??= (db.admins ?? []).map((id) => ({ id, role: "owner" as const, addedBy: null, addedAt: Date.now() }));
  delete db.admins;
  // Запись через временный файл: при сбое не останется полусломанный JSON
  const flush = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(db, null, 1));
    renameSync(`${path}.tmp`, path);
  };
  const bookingsOf = (listingId: string) => Object.values(db.bookings).filter((b) => b.listingId === listingId);

  return {
    async getUser(id) {
      return own(db.users, id);
    },
    async saveUser(u) {
      db.users[u.id] = u;
      flush();
    },
    async getListing(id) {
      return own(db.listings, id);
    },
    async saveListing(l) {
      db.listings[l.id] = l;
      flush();
    },
    async purgeListing(id) {
      delete db.listings[id];
      flush();
    },
    async bumpStat(id, field, delta) {
      const k = `stat:${id}`;
      const s = (db.kv[k] as { views: number; favs: number } | undefined) ?? { views: 0, favs: 0 };
      s[field] = Math.max(0, s[field] + delta);
      db.kv[k] = s;
      flush();
    },
    async getStats(ids) {
      return Object.fromEntries(ids.map((id) => [id, (db.kv[`stat:${id}`] as { views: number; favs: number } | undefined) ?? { views: 0, favs: 0 }]));
    },
    async listListings(q) {
      return Object.values(db.listings)
        .filter((l) => (q?.ownerId == null || l.ownerId === q.ownerId) && (!q?.status || q.status.includes(l.status)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async getBooking(id) {
      return own(db.bookings, id);
    },
    async saveBooking(b) {
      db.bookings[b.id] = b;
      flush();
    },
    async listBookings(q) {
      return Object.values(db.bookings)
        .filter(
          (b) =>
            (q?.listingId == null || b.listingId === q.listingId) &&
            (q?.guestId == null || b.guestId === q.guestId) &&
            (q?.ownerId == null || b.ownerId === q.ownerId) &&
            (!q?.status || q.status.includes(b.status)),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async createBookingIfFree(b, isFree) {
      // В одном процессе Node между проверкой и записью ничего не вклинится — синхронный участок
      const l = db.listings[b.listingId];
      if (!l || !isFree(l, bookingsOf(b.listingId))) return false;
      db.bookings[b.id] = b;
      flush();
      return true;
    },
    async saveReview(r) {
      db.reviews[r.id] = r;
      flush();
    },
    async listReviews(listingId) {
      return Object.values(db.reviews)
        .filter((r) => r.listingId === listingId)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async saveComplaint(c) {
      db.complaints[c.id] = c;
      flush();
    },
    async listComplaints(q) {
      return Object.values(db.complaints)
        .filter((c) => (q?.open == null || !c.resolved === q.open) && (q?.listingId == null || c.listingId === q.listingId))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async getThread(id) {
      return own(db.threads, id);
    },
    async findThread(listingId, guestId) {
      return Object.values(db.threads).find((t) => t.listingId === listingId && t.guestId === guestId);
    },
    async saveThread(t) {
      db.threads[t.id] = t;
      flush();
    },
    async listThreads(userId) {
      return Object.values(db.threads)
        .filter((t) => t.guestId === userId || t.ownerId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async addChatMessage(m) {
      (db.chat[m.threadId] ??= []).push(m);
      flush();
    },
    async listChatMessages(threadId, limit = 200) {
      return (db.chat[threadId] ?? []).slice(-limit);
    },
    async markChatMessageDeleted(threadId, id, at) {
      const m = (db.chat[threadId] ?? []).find((x) => x.id === id);
      if (!m) return undefined;
      m.deletedAt ??= at;
      flush();
      return m;
    },
    async getReplyTarget(mid) {
      return db.replies[mid];
    },
    async setReplyTarget(mid, t) {
      db.replies[mid] = t;
      flush();
    },
    async getStaff() {
      return db.staff;
    },
    async saveStaff(list) {
      db.staff = list;
      flush();
    },
    async getAdmins() {
      return db.staff.map((m) => m.id);
    },
    async findUserByPhone(phone) {
      return Object.values(db.users).find((u) => u.phone === phone);
    },
    async listUsersByPhone(phone) {
      return Object.values(db.users).filter((u) => u.phone === phone);
    },
    async listHostApplicants(status) {
      return Object.values(db.users)
        .filter((u) => u.hostStatus === status)
        .sort((a, b) => (a.hostApp?.at ?? 0) - (b.hostApp?.at ?? 0));
    },
    async savePhoto(jpeg) {
      const dir = join(dirname(path), "photos");
      mkdirSync(dir, { recursive: true });
      const name = `${randomUUID()}.jpg`;
      writeFileSync(join(dir, name), jpeg);
      return `/api/photos/${name}`;
    },
    async readPhoto(name) {
      // Только имена вида <uuid>.jpg — никаких путей вроде ../../
      if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) return undefined;
      const f = join(dirname(path), "photos", name);
      return existsSync(f) ? readFileSync(f) : undefined;
    },
    async searchUsers(q, limit = 50) {
      const needle = q.trim().toLowerCase();
      const digits = needle.replace(/\D/g, "");
      return Object.values(db.users)
        .filter((u) => !needle || String(u.id) === needle || (digits.length >= 4 && (u.phone ?? "").includes(digits)) || (u.name ?? "").toLowerCase().includes(needle))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
    async countUsers() {
      return Object.keys(db.users).length;
    },
    async addAudit(e) {
      db.audit.push(e);
      // Журнал не разрастается бесконечно: последние 2000 действий
      if (db.audit.length > 2000) db.audit = db.audit.slice(-2000);
      flush();
    },
    async listAudit(limit = 100) {
      return db.audit.slice(-limit).reverse();
    },
    async getMessageIds(key) {
      return db.messages[key] ?? [];
    },
    async addMessageId(key, mid) {
      (db.messages[key] ??= []).push(mid);
      flush();
    },
    async seenRecently(key, ttlMs) {
      const at = db.marks[key];
      if (at != null && Date.now() - at < ttlMs) return true;
      db.marks[key] = Date.now();
      flush();
      return false;
    },
    async kvGet<T>(key: string) {
      return db.kv[key] as T | undefined;
    },
    async kvSet(key, value) {
      if (value === undefined) delete db.kv[key];
      else db.kv[key] = value;
      flush();
    },
    async kvList<T>(prefix: string) {
      return Object.entries(db.kv).filter(([k]) => k.startsWith(prefix)) as [string, T][];
    },
  };
}
