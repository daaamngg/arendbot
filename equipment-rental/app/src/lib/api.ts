import type { Booking, Item } from "../../../shared/types.ts";
import { initData } from "./max.ts";

// Запросы к серверу. Адрес API — VITE_API_URL (облако), в разработке — /api через прокси Vite.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(data?.error ?? `HTTP ${status}`);
  }
}

// Разработка в обычном браузере: у браузера свой тестовый человек. В MAX — подпись MAX
const demoUser = (() => {
  if (initData()) return undefined;
  try {
    // Разработка: ?demo=9xxxxxxxx — войти тестовым человеком с этим номером (для снимков экрана)
    const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get("demo") : null;
    if (forced) return forced;
    let v = localStorage.getItem("tehnika-demo-user");
    if (!v) localStorage.setItem("tehnika-demo-user", (v = String(900_000_000 + Math.floor(Math.random() * 99_999_999))));
    return Number(v);
  } catch {
    return undefined;
  }
})();

/** Запрос не висит вечно: через 10 секунд обрывается; при сбое сети — один повтор */
async function post<T>(path: string, body: object = {}): Promise<T> {
  const attempt = async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      return await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData: initData(), demoUser }), signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  let res: Response;
  try {
    res = await attempt();
    if (res.status >= 500) res = await attempt();
  } catch {
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

export type BookingView = Booking & { title: string };
export interface Me {
  user: { id: number; name: string | null; phone: string | null };
  owner: boolean;
  demo: boolean;
  promoAt: number | null;
  promoUsed: boolean;
  spinAt: number | null;
  spinPercent: number | null;
  spinExpiresAt: number | null;
}

export const api = {
  me: () => post<Me>("/me"),
  promoOpen: () => post<{ promoAt: number }>("/promo/open"),
  spin: () => post<{ spinAt: number; spinPercent: number; spinExpiresAt: number }>("/spin"),
  spinPreview: () => post<{ spinPercent: number }>("/spin/preview"),
  items: () => post<{ items: Item[]; delivery: number }>("/items"),
  item: (id: string) => post<{ item: Item; busy: string[]; delivery: number }>("/item", { id }),
  phone: (phone: string) => post<{ ok: true }>("/phone", { phone, consent: true }),
  book: (b: { itemId: string; from: string; to: string; delivery: boolean; address: string; comment: string }) => post<{ booking: BookingView }>("/book", b),
  my: () => post<{ bookings: BookingView[] }>("/my"),
  cancel: (id: string) => post<{ ok: true }>("/cancel", { id }),
  ownerBookings: () => post<{ bookings: BookingView[] }>("/owner/bookings"),
  decide: (id: string, accept: boolean) => post<{ message: string }>("/owner/decide", { id, accept }),
  hide: (id: string) => post<{ ok: true }>("/owner/hide", { id }),
  calendar: (itemId: string, close: string[], open: string[]) => post<{ closed: string[]; booked: string[] }>("/owner/calendar", { itemId, close, open }),
  price: (id: string, priceDay: number | null) => post<{ item: Item }>("/owner/price", { id, priceDay }),
};

const ERRORS: Record<string, string> = {
  busy: "Эти дни уже заняты. Выберите другие.",
  "bad dates": "Проверьте даты.",
  "too long": "Не больше 30 суток за раз. Для долгой аренды позвоните.",
  "too many requests": "У вас уже три заявки ждут ответа.",
  "address required": "Укажите адрес доставки.",
  "phone required": "Нужен номер телефона.",
  "bad phone": "Проверьте номер: +7 и 10 цифр.",
  "cannot cancel": "Эту аренду уже нельзя отменить. Позвоните.",
  "too many": "Слишком часто. Попробуйте через минуту.",
  network: "Нет связи. Проверьте интернет.",
  "open from MAX": "Откройте приложение из бота в MAX.",
  "bad initData": "Приложение было открыто слишком долго. Откройте бота заново.",
};
export const errorText = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.data?.error] ?? "Что-то пошло не так. Попробуйте ещё раз.") : "Что-то пошло не так.");
