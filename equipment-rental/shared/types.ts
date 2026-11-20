// Аренда техники «Домашний эксперт»: каталог, бронь по дням, доставка по городу.
// Оплата — за сутки плюс доставка 500 ₽ по Самаре (решение Сергея, 20.11.2026).

export const DELIVERY_PRICE = 500;
/** Насколько вперёд можно бронировать и на сколько дней сразу */
export const DAYS_AHEAD = 120;
export const MAX_DAYS = 30;

export interface Item {
  id: string;
  title: string;
  /** одна строка под названием: для чего техника */
  short: string;
  /** характеристики и условия списком */
  specs: string[];
  /** цена за сутки, ₽; null — «цена по звонку» (пока Сергей не назвал) */
  priceDay: number | null;
  /** значок, пока нет фото */
  /** раздел каталога (shared/catalog.ts → CATEGORIES) */
  category: "clean" | "tools";
  icon: "vacuum" | "fan" | "steam" | "window" | "ozone" | "hammer" | "drill" | "grinder";
  /** [большое, миниатюра] — пути от корня мини-приложения */
  photos: string[];
  /** подпись автора фото, если лицензия её требует (CC BY / BY-SA) */
  credit?: string;
}

export type BookingStatus = "requested" | "confirmed" | "declined" | "cancelled" | "expired";

export interface Booking {
  id: string;
  itemId: string;
  clientId: number;
  clientName: string | null;
  phone: string;
  /** первый и последний день аренды включительно */
  from: string;
  to: string;
  days: number;
  delivery: boolean;
  address: string;
  comment: string;
  /** цена за сутки на момент заявки (null — по звонку) */
  priceDay: number | null;
  /** сутки × цена + доставка; null — если цена по звонку */
  total: number | null;
  /** скидка по акции, % (0 или нет — без скидки) */
  discount?: number;
  /** проверочная заявка владельца самому себе: видна и мешает только ему, другим владельцам не приходит */
  test?: boolean;
  status: BookingStatus;
  createdAt: number;
  /** до какого времени владелец отвечает, иначе заявка отменяется сама */
  decideBy: number;
  reminded?: boolean;
  /** владелец убрал из своего списка (аренда закончилась) */
  hidden?: boolean;
}

export interface User {
  id: number;
  name: string | null;
  phone: string | null;
  consentAt: number | null;
  createdAt: number;
  /** когда открыл подарок-акцию (shared/promo.ts) */
  promoAt?: number | null;
}
