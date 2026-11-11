import type { BookingStatus, Listing, ListingCard, PublicListing } from "../../../shared/types.ts";
import { initData } from "./max.ts";

// Все запросы к серверу. Адрес API — VITE_API_URL (облако), в разработке — /api через прокси Vite.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(data?.error ?? `HTTP ${status}`);
  }
}

/**
 * Запрос к серверу. Не висит вечно: через 10 секунд обрывается (на фото — 30).
 * Если сеть мигнула или сервер на секунду недоступен — один повтор. Ошибки сервера (4xx) не повторяем
 */
// Демо и разработка (браузер без MAX): у каждого браузера свой тестовый человек — номер хранится в браузере.
// В MAX не используется: там человек определяется подписью MAX
const demoUser = (() => {
  if (initData()) return undefined;
  try {
    let v = localStorage.getItem("arenda-demo-user");
    if (!v) {
      v = String(900_000_000 + Math.floor(Math.random() * 99_999_999));
      localStorage.setItem("arenda-demo-user", v);
    }
    return Number(v);
  } catch {
    return undefined;
  }
})();

async function post<T>(path: string, body: object = {}, opts: { timeout?: number } = {}): Promise<T> {
  const attempt = async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 10_000);
    try {
      return await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, initData: initData(), ...(demoUser ? { demoUser } : {}) }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res: Response;
  try {
    res = await attempt();
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 800));
      res = await attempt();
    }
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    try {
      res = await attempt();
    } catch {
      throw new ApiError(0, { error: "network" });
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface Me {
  user: { id: number; name: string | null; phone: string | null; consent: boolean };
  admin: boolean;
  owner: boolean;
  /** демо или разработка: код команды можно ввести прямо в приложении */
  demo: boolean;
  unread: number;
  /** может ли сдавать: заявка не подана / ждёт / одобрена / отклонена */
  host: "none" | "pending" | "approved" | "rejected";
  hostNote: string | null;
  bookingBanned: boolean;
  localities: string[];
  districts: Record<string, string[]>;
  amenities: string[];
}

export interface BookingView {
  id: string;
  listingId: string;
  title: string;
  locality: string;
  photo: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  status: BookingStatus;
  cancelledBy: "guest" | "owner" | null;
  decideBy: number;
  comment?: string;
  guestName?: string | null;
  address: string | null;
  lateCancel: boolean;
  cancelDays: number;
  canReview: boolean;
  deposit: number;
  checkInTime: string | null;
  phone: string | null;
}

export interface HostApplicationRow {
  id: number;
  phone: string | null;
  name: string;
  city: string;
  about: string;
  at: number;
  /** подсказки бота: что настораживает, что в пользу */
  hints: { flags: string[]; good: string[] };
}

export interface AdminBookingRow {
  id: string;
  listingId: string;
  title: string;
  locality: string;
  address: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  total: number;
  status: BookingStatus;
  createdAt: number;
  decideBy: number;
  guestName: string | null;
  guestPhone: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
}

export interface HostListingRow {
  id: string;
  title: string;
  locality: string;
  status: Listing["status"];
  moderatorNote: string | null;
  photo: string | null;
  priceFrom: number;
  requests: number;
}

export interface SearchQuery {
  locality?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  priceMax?: number;
  rooms?: number;
  pets?: boolean;
  kids?: boolean;
  amenities?: string[];
  sort?: "price" | "rating" | "new";
}

export interface ThreadView {
  id: string;
  listingId: string;
  title: string;
  locality: string;
  photo: string | null;
  role: "guest" | "owner";
  otherName: string;
  unread: number;
  lastText: string;
  updatedAt: number;
}

export interface ChatMsg {
  id: string;
  from: "guest" | "owner";
  text: string;
  createdAt: number;
  /** автор удалил: текста нет, показываем «Сообщение удалено» */
  deleted: boolean;
}

export interface AdminListing {
  id: string;
  title: string;
  locality: string;
  address: string;
  status: Listing["status"];
  ownerId: number;
  photo: string | null;
  checked: boolean;
  botChecked: boolean;
  updatedAt: number;
}

export interface AdminUser {
  id: number;
  name: string | null;
  phone: string | null;
  blocked: boolean;
  createdAt: number;
  role: "owner" | "moderator" | null;
  listings: number;
  bookings: number;
}

export interface StaffRow {
  id: number;
  role: "owner" | "moderator";
  name: string | null;
  phone: string | null;
  addedAt: number;
}

export interface AdminStats {
  users: number;
  listings: Record<string, number>;
  bookings: Record<string, number>;
  bookingsWeek: number;
  confirmedSum: number;
  openComplaints: number;
  pendingHosts: number;
}

export interface AuditRow {
  at: number;
  by: number;
  byName?: string;
  action: string;
  target: string;
  note?: string;
}

export interface ComplaintRow {
  id: string;
  listingId: string;
  title: string;
  reasonTitle: string;
  text: string;
  createdAt: number;
  ownerId: number | null;
}

export const api = {
  me: () => post<Me>("/me"),
  phone: (phone: string) => post<{ ok: true }>("/phone", { phone, consent: true }),
  search: (q: SearchQuery) => post<{ cards: ListingCard[] }>("/search", q),
  listing: (id: string) => post<{ listing: PublicListing; own: boolean }>("/listing", { id }),
  quote: (id: string, checkIn: string, checkOut: string) => post<{ nights?: number; total?: number; problem?: string }>("/quote", { id, checkIn, checkOut }),
  // key — метка попытки: если ответ потерялся и запрос ушёл повторно, сервер вернёт ту же бронь
  book: (p: { id: string; checkIn: string; checkOut: string; guests: number; comment: string; key: string }) => post<{ booking: BookingView }>("/book", p, { timeout: 20_000 }),
  myBookings: () => post<{ bookings: BookingView[] }>("/my/bookings"),
  cancel: (id: string) => post<{ ok: true }>("/booking/cancel", { id }),
  favorite: (id: string, on: boolean) => post<{ favorite: boolean }>("/favorite", { id, on }),
  favorites: () => post<{ cards: ListingCard[] }>("/favorites"),
  review: (bookingId: string, stars: number, text: string) => post<{ ok: true }>("/review", { bookingId, stars, text }),
  complaint: (id: string, reason: string, text: string) => post<{ ok: true }>("/complaint", { id, reason, text }),
  demoCode: (code: string) => post<{ role: "owner" | "moderator" }>("/demo/code", { code }),
  modCode: (rotate = false) => post<{ code: string }>("/admin/modcode", { rotate }),
  adminDeleteListing: (id: string, note: string) => post<{ ok: true }>("/admin/listing/delete", { id, note }),
  adminCancelBooking: (id: string, note: string) => post<{ ok: true }>("/admin/booking/cancel", { id, note }),
  chatHide: (id: string) => post<{ ok: true }>("/chat/hide", { id }),
  chatDelete: (id: string, messageId: string) => post<{ ok: true }>("/chat/delete", { id, messageId }),
  chatOpen: (listingId: string) => post<{ thread: ThreadView; messages: ChatMsg[] }>("/chat/open", { listingId }),
  chatThread: (id: string) => post<{ thread: ThreadView; messages: ChatMsg[] }>("/chat/thread", { id }),
  chatSend: (id: string, text: string, key: string) => post<{ text: string; masked: boolean }>("/chat/send", { id, text, key }),
  chatList: () => post<{ threads: ThreadView[] }>("/chat/list"),

  hostListings: () => post<{ listings: HostListingRow[] }>("/host/listings"),
  hostListing: (id: string) => post<{ listing: Listing; missing: string[] }>("/host/listing", { id }),
  hostSave: (id: string | null, form: Partial<Listing>) => post<{ listing: Listing; missing: string[] }>("/host/save", { id, form }),
  photosRequest: (id: string) => post<{ sent: true }>("/host/photos-request", { id }),
  photoUpload: (id: string, data: string) => post<{ listing: Listing; missing: string[] }>("/host/photo-upload", { id, data }, { timeout: 30_000 }),
  hostApply: (p: { name: string; city: string; about: string }) => post<{ host: "pending" }>("/host/apply", p),
  noshow: (id: string) => post<{ ok: true }>("/host/noshow", { id }),
  hideBooking: (id: string) => post<{ ok: true }>("/booking/hide", { id }),
  photosOrder: (id: string, order: number[]) => post<{ listing: Listing; missing: string[] }>("/host/photos", { id, order }),
  submit: (id: string) => post<{ listing: Listing; live: boolean }>("/host/submit", { id }),
  deleteListing: (id: string) => post<{ ok: true }>("/host/delete", { id }),
  pause: (id: string, paused: boolean) => post<{ listing: Listing }>("/host/pause", { id, paused }),
  calendar: (id: string, close: string[], open: string[]) => post<{ closed: string[]; booked: string[] }>("/host/calendar", { id, close, open }),
  hostBookings: () => post<{ bookings: BookingView[] }>("/host/bookings"),
  decide: (id: string, accept: boolean) => post<{ message: string; booking: BookingView }>("/host/decide", { id, accept }),

  pending: () => post<{ listings: (Listing & { title: string; held: string[] })[]; complaints: ComplaintRow[] }>("/admin/pending"),
  moderate: (id: string, ok: boolean, reason?: string) => post<{ listing: Listing }>("/admin/moderate", { id, ok, reason }),
  resolveComplaint: (id: string, action: "hide" | "ban" | "ok") => post<{ ok: true }>("/admin/complaint", { id, action }),
  adminListings: (status: string, q: string) => post<{ listings: AdminListing[] }>("/admin/listings", { status: status || undefined, q }),
  adminHide: (id: string, note: string) => post<{ listing: Listing }>("/admin/block", { id, note }),
  adminRestore: (id: string) => post<{ listing: Listing }>("/admin/restore", { id }),
  adminUsers: (q: string) => post<{ users: AdminUser[] }>("/admin/users", { q }),
  adminBlockUser: (id: number, blocked: boolean, note?: string) => post<{ ok: true }>("/admin/user/block", { id, blocked, note }),
  staff: () => post<{ staff: StaffRow[]; owner: boolean }>("/admin/staff"),
  staffRemove: (id: number) => post<{ ok: true }>("/admin/staff/remove", { id }),
  stats: () => post<AdminStats>("/admin/stats"),
  applications: () => post<{ applications: HostApplicationRow[] }>("/admin/applications"),
  adminBookings: () => post<{ bookings: AdminBookingRow[] }>("/admin/bookings"),
  decideApplication: (id: number, ok: boolean, note?: string) => post<{ ok: true }>("/admin/application", { id, ok, note }),
  auditLog: () => post<{ entries: AuditRow[] }>("/admin/audit"),
};

/** Текст ошибки сервера для человека */
export function errorText(e: unknown): string {
  const d = e instanceof ApiError ? e.data : null;
  const map: Record<string, string> = {
    busy: "На эти даты уже занято. Выберите другие.",
    "already requested": "Вы уже отправили запрос на это жильё. Дождитесь ответа хозяина.",
    "phone required": "Сначала оставьте номер телефона.",
    "too many": "Слишком часто. Попробуйте через пару минут.",
    "too many guests": "Столько гостей это жильё не вмещает.",
    incomplete: d?.missing ? `Не хватает: ${d.missing.join(", ")}.` : "Заполните анкету до конца.",
    "cannot cancel": "Эту бронь уже нельзя отменить.",
    contacts: "Уберите из описания телефоны, ссылки и мессенджеры. Гость получит ваш номер, когда вы подтвердите бронь.",
    "user not found": "Человек с таким номером ещё не открывал приложение. Попросите его открыть бота и оставить номер.",
    "already staff": "Этот человек уже в команде.",
    "last owner": "Нельзя убрать последнего главного.",
    owner: "Главного заблокировать нельзя.",
    "owner blocked": "Хозяин заблокирован, сначала разблокируйте его во вкладке «Люди».",
    "bad phone": "Проверьте номер: +7 и 10 цифр.",
    network: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
    "not host": "Сначала подайте заявку на размещение и дождитесь одобрения.",
    "already applied": "Заявка уже подана.",
    "booking banned": "Бронирование для вас закрыто: два раза бронь не состоялась по вашей вине. Если это ошибка, напишите в чат бота.",
    "too many requests": "У вас уже три запроса ждут ответа. Дождитесь ответов или отмените лишние.",
    "too many photos": "Уже 15 фото, больше не помещается.",
    "bad image": "Не получилось обработать фото. Попробуйте другое.",
    "active booking": "Сначала отмените бронь, потом её можно убрать из списка.",
    "too early": "Отметить можно в день заезда или позже.",
    "has bookings": "По этому объявлению есть подтверждённые брони. Сначала отмените их, потом удалите объявление.",
    "bad status": "Сейчас это сделать нельзя.",
    "bad code": "Код не подходит.",
    forbidden: "Это может сделать только главный.",
    "bad initData": "Приложение было открыто слишком долго. Закройте его и откройте бота заново.",
    "open from MAX": "Откройте приложение из бота в MAX.",
    "not found": "Не найдено: возможно, уже удалено или снято.",
    "server error": "Сервер не ответил. Попробуйте ещё раз через минуту.",
  };
  if (d?.problem && d.problem !== "busy") {
    return (
      {
        past: "Эта дата уже прошла.",
        too_short: "Слишком мало ночей для этого жилья.",
        too_long: "Посуточно можно снять не больше чем на 30 ночей.",
        bad_dates: "Проверьте даты: выезд должен быть позже заезда.",
        too_far: "Бронировать можно не дальше чем на полгода вперёд.",
      } as Record<string, string>
    )[d.problem] ?? "Эти даты не подходят.";
  }
  return map[d?.error] ?? "Не получилось. Проверьте интернет и попробуйте ещё раз.";
}
